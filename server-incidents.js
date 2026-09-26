import express from 'express';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {deliveryFinanceFetch,startEmbeddedDeliveryFinance,stopEmbeddedDeliveryFinance} from './server-delivery-finance.js';
import {decodeVerifiedDataUrl} from './file-signature-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '14mb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
const INCIDENT_STATUSES = new Set(['submitted','triaged','investigating','awaiting_information','resolved','dismissed','escalated']);
const RELATED_TYPES = new Set(['order','delivery','merchant','courier','service_job','service_provider','supplier','payment','other']);
const IMAGE_MIMES = new Set(['image/jpeg','image/png','image/webp']);
const PDF_MIME = 'application/pdf';
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_PDF_BYTES = 3_000_000;
let deliveryFinanceApp=null;
let deliveryFinanceReady=false;
let shuttingDown = false;

function clean(v,max=1200){ return String(v??'').trim().slice(0,max); }
function authHeader(req){ return req.headers.authorization || ''; }
async function downstreamFetch(path,options={}){
  return deliveryFinanceFetch(path,options);
}
export function isIncidentOwnedPath(path=''){
  const pathname=String(path||'').split('?')[0];
  return pathname==='/incidents.css'
    ||pathname==='/incidents-ui.js'
    ||pathname==='/api/incidents'
    ||pathname.startsWith('/api/incidents/')
    ||pathname==='/api/admin/incidents'
    ||pathname.startsWith('/api/admin/incidents/');
}
export async function incidentsFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  if(isIncidentOwnedPath(pathname)){
    throw Object.assign(new Error('Incident-owned paths require in-process Incident dispatch'),{
      status:500,code:'INCIDENT_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const downstream=await downstreamFetch('/health',{headers:options.headers||{}});
      const ok=deliveryFinanceReady&&downstream.ok;
      return new Response(JSON.stringify({ok,db:true,upstream:ok,version:'0.8.4-incidents'}),{
        status:ok?200:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,upstream:false,version:'0.8.4-incidents'}),{
        status:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  return downstreamFetch(path,options);
}
async function identity(req){
  const r=await downstreamFetch('/api/me',{headers:{Authorization:authHeader(req)}});
  const b=await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});
  return b;
}
async function requireAdmin(req){ const me=await identity(req); if(Number(me.account.id)!==1) throw Object.assign(new Error('Admin access required'),{status:403}); return me; }
function isAdmin(me){ return Number(me?.account?.id)===1; }
function decodeDataUrl(dataUrl){
  return decodeVerifiedDataUrl(dataUrl,{
    allowedMimes:[...IMAGE_MIMES,PDF_MIME],
    label:'Attachment'
  });
}
function validateAttachments(raw){
  const files=Array.isArray(raw)?raw:[];
  if(files.length>6) throw Object.assign(new Error('Maximum 5 images and 1 PDF per incident'),{status:400});
  let images=0,pdfs=0,totalBytes=0;
  return files.map((f,index)=>{
    const {mime,bytes}=decodeDataUrl(f?.data_url);
    let kind;
    if(IMAGE_MIMES.has(mime)){kind='image';images++;if(bytes.length>MAX_IMAGE_BYTES)throw Object.assign(new Error(`Image ${index+1} exceeds 1.5 MB`),{status:413});}
    else if(mime===PDF_MIME){kind='pdf';pdfs++;if(bytes.length>MAX_PDF_BYTES)throw Object.assign(new Error('PDF exceeds 3 MB'),{status:413});}
    else throw Object.assign(new Error('Only JPEG, PNG, WebP images and PDF are allowed'),{status:400});
    totalBytes+=bytes.length;
    return {kind,mime,file_name:clean(f?.file_name||`${kind}-${index+1}`,180),byte_size:bytes.length,data_url:String(f.data_url)};
  }).map(x=>{if(images>5)throw Object.assign(new Error('Maximum 5 images per incident'),{status:400});if(pdfs>1)throw Object.assign(new Error('Maximum 1 PDF per incident'),{status:400});if(totalBytes>10_000_000)throw Object.assign(new Error('Total incident evidence exceeds 10 MB'),{status:413});return x});
}

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      related_type TEXT NOT NULL DEFAULT 'other',
      related_id BIGINT,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      assigned_admin_account_id BIGINT REFERENCES accounts(id),
      resolution_summary TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      CHECK(status IN ('submitted','triaged','investigating','awaiting_information','resolved','dismissed','escalated')),
      CHECK(related_type IN ('order','delivery','merchant','courier','service_job','service_provider','supplier','payment','other'))
    );
    CREATE INDEX IF NOT EXISTS incident_reports_reporter_idx ON incident_reports(reporter_account_id,submitted_at DESC);
    CREATE INDEX IF NOT EXISTS incident_reports_status_idx ON incident_reports(status,submitted_at DESC);

    CREATE TABLE IF NOT EXISTS incident_attachments (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('image','pdf')),
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK(byte_size>=0),
      evidence_data_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS incident_attachments_incident_idx ON incident_attachments(incident_id,id);

    CREATE TABLE IF NOT EXISTS incident_actions (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
      actor_account_id BIGINT NOT NULL REFERENCES accounts(id),
      action_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS incident_actions_incident_idx ON incident_actions(incident_id,created_at,id);
  `);
}

async function incidentSummary(id){
  const r=await pool.query(`SELECT i.*,a.display_name reporter_name,a.email reporter_email,aa.display_name assigned_admin_name,(SELECT COUNT(*)::int FROM incident_attachments x WHERE x.incident_id=i.id) attachment_count FROM incident_reports i JOIN accounts a ON a.id=i.reporter_account_id LEFT JOIN accounts aa ON aa.id=i.assigned_admin_account_id WHERE i.id=$1`,[id]);
  return r.rows[0]||null;
}
async function authorizeIncident(req,id){
  const me=await identity(req),incident=await incidentSummary(id);
  if(!incident) throw Object.assign(new Error('Incident not found'),{status:404});
  if(Number(incident.reporter_account_id)!==Number(me.account.id)&&!isAdmin(me)) throw Object.assign(new Error('Not allowed to view this incident'),{status:403});
  return {me,incident};
}

app.get('/health',async(req,res)=>{
  const r=await incidentsFetch('/health',{headers:req.headers});
  const payload=await r.json().catch(()=>({ok:false,db:false,upstream:false,version:'0.8.4-incidents'}));
  res.status(r.status).json(payload);
});
app.get('/incidents.css',(_req,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','incidents.css'),'utf8')));
app.get('/incidents-ui.js',(_req,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','incidents-ui.js'),'utf8')));
async function root(req,res){
  const r=await incidentsFetch(req.path,{headers:req.headers});
  const html=await r.text();
  res.status(r.status).type('html').send(html);
}
app.get('/',root);app.get('/index.html',root);

app.post('/api/incidents',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await identity(req);
    const category=clean(req.body?.category,80),description=clean(req.body?.description,5000),relatedType=clean(req.body?.related_type||'other',40),relatedId=req.body?.related_id==null||req.body.related_id===''?null:Number(req.body.related_id);
    if(!category||description.length<10) throw Object.assign(new Error('Category and a clear description are required'),{status:400});
    if(!RELATED_TYPES.has(relatedType)) throw Object.assign(new Error('Unknown related incident type'),{status:400});
    if(relatedId!=null&&(!Number.isInteger(relatedId)||relatedId<1)) throw Object.assign(new Error('Related record ID must be a positive integer'),{status:400});
    const attachments=validateAttachments(req.body?.attachments);
    await client.query('BEGIN');
    const q=await client.query(`INSERT INTO incident_reports(reporter_account_id,related_type,related_id,category,description,status) VALUES($1,$2,$3,$4,$5,'submitted') RETURNING *`,[me.account.id,relatedType,relatedId,category,description]);
    const incident=q.rows[0];
    for(const f of attachments) await client.query(`INSERT INTO incident_attachments(incident_id,kind,mime_type,file_name,byte_size,evidence_data_url) VALUES($1,$2,$3,$4,$5,$6)`,[incident.id,f.kind,f.mime,f.file_name,f.byte_size,f.data_url]);
    await client.query(`INSERT INTO incident_actions(incident_id,actor_account_id,action_type,to_status,note) VALUES($1,$2,'submitted','submitted','Incident submitted')`,[incident.id,me.account.id]);
    await client.query('COMMIT');
    res.status(201).json(await incidentSummary(incident.id));
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});

app.get('/api/incidents/mine',async(req,res,next)=>{
  try{const me=await identity(req);const{rows}=await pool.query(`SELECT i.id,i.related_type,i.related_id,i.category,i.description,i.status,i.resolution_summary,i.submitted_at,i.updated_at,i.resolved_at,(SELECT COUNT(*)::int FROM incident_attachments x WHERE x.incident_id=i.id) attachment_count FROM incident_reports i WHERE i.reporter_account_id=$1 ORDER BY i.submitted_at DESC LIMIT 200`,[me.account.id]);res.json(rows);}catch(e){next(e)}
});

app.get('/api/incidents/:id',async(req,res,next)=>{
  try{const{incident}=await authorizeIncident(req,Number(req.params.id));const [attachments,actions]=await Promise.all([pool.query(`SELECT id,kind,mime_type,file_name,byte_size,created_at FROM incident_attachments WHERE incident_id=$1 ORDER BY id`,[incident.id]),pool.query(`SELECT x.id,x.action_type,x.from_status,x.to_status,x.note,x.created_at,a.display_name actor_name FROM incident_actions x JOIN accounts a ON a.id=x.actor_account_id WHERE x.incident_id=$1 ORDER BY x.created_at,x.id`,[incident.id])]);res.json({...incident,attachments:attachments.rows,actions:actions.rows});}catch(e){next(e)}
});

app.get('/api/incidents/:id/attachments/:attachmentId',async(req,res,next)=>{
  try{const{incident}=await authorizeIncident(req,Number(req.params.id));const a=await pool.query(`SELECT * FROM incident_attachments WHERE id=$1 AND incident_id=$2`,[Number(req.params.attachmentId),incident.id]);if(!a.rowCount)return res.status(404).json({error:'Attachment not found'});const row=a.rows[0];res.json({id:row.id,kind:row.kind,mime_type:row.mime_type,file_name:row.file_name,byte_size:row.byte_size,data_url:row.evidence_data_url});}catch(e){next(e)}
});

app.post('/api/incidents/:id/note',body,async(req,res,next)=>{
  try{const{me,incident}=await authorizeIncident(req,Number(req.params.id));const note=clean(req.body?.note,3000);if(!note)return res.status(400).json({error:'Note is required'});await pool.query(`INSERT INTO incident_actions(incident_id,actor_account_id,action_type,from_status,to_status,note) VALUES($1,$2,$3,$4,$4,$5)`,[incident.id,me.account.id,isAdmin(me)?'admin_note':'reporter_note',incident.status,note]);await pool.query(`UPDATE incident_reports SET updated_at=NOW() WHERE id=$1`,[incident.id]);res.json({ok:true});}catch(e){next(e)}
});

app.get('/api/admin/incidents',async(req,res,next)=>{
  try{await requireAdmin(req);const status=clean(req.query.status,40);const values=[];let where='';if(status){if(!INCIDENT_STATUSES.has(status))return res.status(400).json({error:'Unknown status'});values.push(status);where='WHERE i.status=$1';}const{rows}=await pool.query(`SELECT i.id,i.related_type,i.related_id,i.category,i.description,i.status,i.assigned_admin_account_id,i.resolution_summary,i.submitted_at,i.updated_at,a.display_name reporter_name,a.email reporter_email,(SELECT COUNT(*)::int FROM incident_attachments x WHERE x.incident_id=i.id) attachment_count FROM incident_reports i JOIN accounts a ON a.id=i.reporter_account_id ${where} ORDER BY CASE i.status WHEN 'escalated' THEN 0 WHEN 'submitted' THEN 1 WHEN 'triaged' THEN 2 WHEN 'investigating' THEN 3 WHEN 'awaiting_information' THEN 4 ELSE 5 END,i.updated_at DESC LIMIT 300`,values);res.json(rows);}catch(e){next(e)}
});

app.patch('/api/admin/incidents/:id',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireAdmin(req),id=Number(req.params.id),status=clean(req.body?.status,40),note=clean(req.body?.note,3000),resolution=clean(req.body?.resolution_summary,4000);
    if(!INCIDENT_STATUSES.has(status)) throw Object.assign(new Error('Unknown incident status'),{status:400});
    await client.query('BEGIN');
    const q=await client.query(`SELECT * FROM incident_reports WHERE id=$1 FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Incident not found'),{status:404});const before=q.rows[0];
    await client.query(`UPDATE incident_reports SET status=$1,assigned_admin_account_id=COALESCE(assigned_admin_account_id,$2),resolution_summary=CASE WHEN $3<>'' THEN $3 ELSE resolution_summary END,resolved_at=CASE WHEN $1 IN ('resolved','dismissed') THEN COALESCE(resolved_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=$4`,[status,me.account.id,resolution,id]);
    await client.query(`INSERT INTO incident_actions(incident_id,actor_account_id,action_type,from_status,to_status,note) VALUES($1,$2,'admin_status',$3,$4,$5)`,[id,me.account.id,before.status,status,note]);
    await client.query('COMMIT');res.json(await incidentSummary(id));
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});

function proxy(req,res,next){
  if(!deliveryFinanceApp)return res.status(503).json({error:'Delivery Finance runtime is not ready'});
  return deliveryFinanceApp(req,res,next);
}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})});

let embeddedStartPromise=null;
export async function startEmbeddedIncidents(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      deliveryFinanceApp=await startEmbeddedDeliveryFinance();
      deliveryFinanceReady=true;
      await initDb();
      console.log('Business & Life incidents mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopIncidents(){
  if(shuttingDown)return;
  shuttingDown=true;
  deliveryFinanceReady=false;
  deliveryFinanceApp=null;
  await stopEmbeddedDeliveryFinance().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedIncidents(){await stopIncidents()}

async function shutdown(sig){
  console.log(`Received ${sig}`);
  await stopIncidents();
  process.exit(0);
}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedIncidents()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life incident gateway listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
