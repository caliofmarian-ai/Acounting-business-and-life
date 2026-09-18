import express from 'express';
import pg from 'pg';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureLegalSchema,seedRepositoryLegalDrafts,resolveLegalGate,getCurrentLegalDocument,
  recordLegalAcceptance,legalAcceptanceHistory,legalAdminOverview,createLegalVersion,
  reviewLegalVersion,activateLegalVersion,withdrawLegalVersion
} from './legal-core.js';
import {
  requireAdminPermission,getAdminAssignments,appendAdminAudit
} from './admin-authorization.js';
import { emitNotificationEvent,normalizeNotificationLocale } from './notification-core.js';

const {Pool}=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const upstreamPort=Number(process.env.INTERNAL_NOTIFICATIONS_PORT||4407);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const body=express.json({limit:'30mb'});
const TOKEN_SECRET=process.env.TOKEN_SECRET||'';
let child;let shuttingDown=false;

const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||crypto.randomUUID(),120);
async function upstream(path,options={}){return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
async function preferredLocale(accountId){const q=await pool.query(`SELECT preferred_locale FROM accounts WHERE id=$1`,[accountId]);return normalizeNotificationLocale(q.rows[0]?.preferred_locale)}
function requestIp(req){return clean((String(req.headers['x-forwarded-for']||'').split(',')[0]||req.socket?.remoteAddress||''),200)}
function deviceEvidence(req){return clean([req.headers['user-agent'],req.headers['sec-ch-ua-platform']].filter(Boolean).join('|'),600)}
async function activeAdminContext(accountId){
  const rows=await getAdminAssignments(pool,accountId);
  return rows[0]?{role:'admin',adminAssignmentId:Number(rows[0].id),territoryId:rows[0].territory_id?Number(rows[0].territory_id):null}:{role:'admin',adminAssignmentId:null,territoryId:null};
}
async function legalGateFor(req,{actionCode,role,businessId=null,territoryId=null,adminAssignmentId=null}){
  const me=await identity(req),locale=await preferredLocale(me.account.id);
  const gate=await resolveLegalGate(pool,Number(me.account.id),{actionCode,role,territoryId,businessId,adminAssignmentId,preferredLocale:locale});
  return{me,gate};
}
function blocked(res,gate){return res.status(428).json({error:'Current legal documents must be accepted before this action',code:'LEGAL_ACCEPTANCE_REQUIRED',legal_gate:gate})}
async function forwardJson(req,res){
  const r=await upstream(req.originalUrl,{method:req.method,headers:{Authorization:authHeader(req),'Content-Type':'application/json',...(req.headers['x-bl-admin-assertion']?{'x-bl-admin-assertion':String(req.headers['x-bl-admin-assertion'])}:{})},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body??{})});
  const text=await r.text();res.status(r.status);const ct=r.headers.get('content-type');if(ct)res.type(ct);res.send(text);
}
async function legalGuard(req,res,next,{actionCode,role,businessId=null,territoryId=null,adminAssignmentId=null}){
  try{const{gate}=await legalGateFor(req,{actionCode,role,businessId,territoryId,adminAssignmentId});if(gate.blocked)return blocked(res,gate);next()}catch(e){next(e)}
}
async function affectedRecipients(documentCode){
  let rows=[];
  if(['platform_terms','privacy_notice','code_of_conduct','location_tracking_notice','marketing_consent'].includes(documentCode)){
    ({rows}=await pool.query(`SELECT id account_id FROM accounts WHERE status='active' ORDER BY id`).catch(()=>({rows:[]})));
  }else if(documentCode==='merchant_agreement'){
    ({rows}=await pool.query(`SELECT DISTINCT account_id FROM profiles WHERE role='merchant' AND enabled=TRUE`));
  }else if(documentCode==='supplier_agreement'){
    ({rows}=await pool.query(`SELECT DISTINCT account_id FROM profiles WHERE role='supplier' AND enabled=TRUE`));
  }else if(documentCode==='courier_agreement'){
    ({rows}=await pool.query(`SELECT DISTINCT account_id FROM profiles WHERE role='courier' AND enabled=TRUE`));
  }else if(documentCode==='service_provider_agreement'){
    ({rows}=await pool.query(`SELECT DISTINCT account_id FROM profiles WHERE role='service_provider' AND enabled=TRUE`));
  }else if(['admin_confidentiality','conflict_of_interest'].includes(documentCode)){
    ({rows}=await pool.query(`SELECT DISTINCT account_id FROM platform_admin_assignments WHERE status='active'`));
  }
  return rows.map(x=>({accountId:Number(x.account_id),roleHint:''})).filter(x=>x.accountId>0);
}
async function emitReconsent(version,documentCode){
  const recipients=await affectedRecipients(documentCode);if(!recipients.length)return;
  await emitNotificationEvent(pool,{
    eventKey:`legal:${documentCode}:${version.id}:activated`,
    eventCode:'legal.reconsent_required',sourceService:'legal',entityType:'legal_document_version',entityId:String(version.id),
    category:'legal',priority:'high',mandatory:true,emailDefault:false,pushDefault:true,
    data:{document_title:documentCode,version_label:version.version_label},
    recipients
  }).catch(e=>console.error('Legal activation notification:',e.message));
}

async function initDb(){
  await ensureLegalSchema(pool);
  await seedRepositoryLegalDrafts(pool,__dirname);
}

// public/read APIs
app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const childAlive=Boolean(child&&!child.killed&&child.exitCode==null);res.status(childAlive?200:503).json({ok:childAlive,db:true,notifications:childAlive,legal:true,version:'0.12-legal-consent'})}catch{res.status(503).json({ok:false,db:false,notifications:false,legal:false,version:'0.12-legal-consent'})}});
app.get('/legal.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','legal.css'),'utf8')));
app.get('/legal-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','legal-ui.js'),'utf8')));
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/legal.css" />\n</head>').replace('</body>','  <script type="module" src="/legal-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root);

app.get('/api/legal/status',async(req,res,next)=>{try{
  const me=await identity(req),actionCode=clean(req.query.action,100),role=clean(req.query.role||me.account.active_role||'customer',40),territoryId=req.query.territory_id?Number(req.query.territory_id):null,businessId=req.query.business_id?Number(req.query.business_id):null,adminAssignmentId=req.query.admin_assignment_id?Number(req.query.admin_assignment_id):null;
  if(!actionCode)return res.status(400).json({error:'action query parameter is required'});
  const locale=await preferredLocale(me.account.id);res.json(await resolveLegalGate(pool,me.account.id,{actionCode,role,territoryId,businessId,adminAssignmentId,preferredLocale:locale}));
}catch(e){next(e)}});
app.get('/api/legal/documents/:code/current',async(req,res,next)=>{try{const me=await identity(req),locale=normalizeNotificationLocale(req.query.locale||await preferredLocale(me.account.id));const doc=await getCurrentLegalDocument(pool,clean(req.params.code,100),locale);if(!doc)return res.status(404).json({error:'Legal document not found'});res.json(doc)}catch(e){next(e)}});
app.get('/api/legal/history',async(req,res,next)=>{try{const me=await identity(req);res.json(await legalAcceptanceHistory(pool,me.account.id))}catch(e){next(e)}});

app.post('/api/legal/accept',body,async(req,res,next)=>{try{
  const me=await identity(req),row=await recordLegalAcceptance(pool,{
    accountId:Number(me.account.id),versionId:Number(req.body?.version_id),state:'accepted',
    role:clean(req.body?.role_context||me.account.active_role,40),businessId:req.body?.business_id?Number(req.body.business_id):null,
    adminAssignmentId:req.body?.admin_assignment_id?Number(req.body.admin_assignment_id):null,
    territoryId:req.body?.territory_id?Number(req.body.territory_id):null,
    actionCode:clean(req.body?.action_code,100),purpose:clean(req.body?.purpose,300),
    contentSha256:clean(req.body?.content_sha256,64),ip:requestIp(req),device:deviceEvidence(req),
    correlationId:correlation(req),metadataSecret:TOKEN_SECRET
  });res.status(201).json(row)
}catch(e){next(e)}});
app.post('/api/legal/withdraw',body,async(req,res,next)=>{try{
  const me=await identity(req),row=await recordLegalAcceptance(pool,{
    accountId:Number(me.account.id),versionId:Number(req.body?.version_id),state:'withdrawn',
    role:clean(req.body?.role_context||me.account.active_role,40),businessId:req.body?.business_id?Number(req.body.business_id):null,
    adminAssignmentId:req.body?.admin_assignment_id?Number(req.body.admin_assignment_id):null,
    territoryId:req.body?.territory_id?Number(req.body.territory_id):null,actionCode:clean(req.body?.action_code,100),
    purpose:clean(req.body?.purpose||'optional_consent_withdrawal',300),contentSha256:'',ip:requestIp(req),device:deviceEvidence(req),
    correlationId:correlation(req),metadataSecret:TOKEN_SECRET
  });res.status(201).json(row)
}catch(e){next(e)}});

// Legal Admin governance. Draft repository content is visible here but is never auto-approved.
app.get('/api/legal/admin/overview',async(req,res,next)=>{try{const me=await identity(req);await requireAdminPermission(pool,me.account.id,'legal.view');res.json(await legalAdminOverview(pool))}catch(e){next(e)}});
app.get('/api/legal/admin/versions/:id/content',async(req,res,next)=>{try{const me=await identity(req);await requireAdminPermission(pool,me.account.id,'legal.view');const q=await pool.query(`SELECT v.*,d.code,d.title FROM legal_document_versions v JOIN legal_documents d ON d.id=v.document_id WHERE v.id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Legal version not found'});res.json(q.rows[0])}catch(e){next(e)}});

app.post('/api/legal/admin/versions',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'legal.manage');
  const row=await createLegalVersion(pool,{documentCode:req.body?.document_code,versionLabel:req.body?.version_label,locale:req.body?.locale||'en-PH',content:req.body?.content_markdown,authoritative:Boolean(req.body?.authoritative),effectiveAt:req.body?.effective_at||null,sourceRef:req.body?.source_ref||'',createdBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'legal.manage',targetType:'legal_document_version',targetId:String(row.id),eventCode:'legal_draft_created',after:{version_label:row.version_label,locale:row.locale,content_sha256:row.content_sha256},reason:req.body?.reason,correlationId:correlation(req)});
  res.status(201).json(row)
}catch(e){next(e)}});

app.post('/api/legal/admin/versions/:id/review',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'legal.manage');
  const row=await reviewLegalVersion(pool,Number(req.params.id),{actorAccountId:me.account.id,reviewType:req.body?.review_type||'legal',approved:req.body?.approved!==false,reference:req.body?.legal_review_reference||'',reason:req.body?.reason||''});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'legal.manage',targetType:'legal_document_version',targetId:String(row.id),eventCode:req.body?.review_type==='translation'?'legal_translation_reviewed':'legal_review_recorded',after:{status:row.status,legal_review_status:row.legal_review_status,translation_review_status:row.translation_review_status},reason:req.body?.reason,correlationId:correlation(req)});
  res.json(row)
}catch(e){next(e)}});

app.post('/api/legal/admin/versions/:id/activate',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'legal.manage');
  const row=await activateLegalVersion(pool,Number(req.params.id),{actorAccountId:me.account.id,reason:req.body?.reason||'',effectiveAt:req.body?.effective_at||null,correlationId:correlation(req)});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'legal.manage',targetType:'legal_document_version',targetId:String(row.id),eventCode:'legal_version_activated',after:{document_code:row.document_code,version_label:row.version_label,locale:row.locale,content_sha256:row.content_sha256},reason:req.body?.reason,correlationId:correlation(req)});
  await emitReconsent(row,row.document_code);res.json(row)
}catch(e){next(e)}});

app.post('/api/legal/admin/versions/:id/withdraw',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'legal.manage');
  const row=await withdrawLegalVersion(pool,Number(req.params.id),{actorAccountId:me.account.id,reason:req.body?.reason||'',correlationId:correlation(req)});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'legal.manage',targetType:'legal_document_version',targetId:String(row.id),eventCode:'legal_version_withdrawn',after:{status:row.status},reason:req.body?.reason,correlationId:correlation(req)});
  res.json(row)
}catch(e){next(e)}});

// protected actions. No active legally-reviewed version => review_pending only, not a false acceptance gate.
app.post('/api/orders',body,async(req,res,next)=>{try{const out=await legalGateFor(req,{actionCode:'order.create',role:'customer'});if(out.gate.blocked)return blocked(res,out.gate);return forwardJson(req,res)}catch(e){next(e)}});
app.post('/api/governance/applications/:id/submit',body,async(req,res,next)=>{try{const a=await pool.query(`SELECT role,territory_id FROM profile_applications WHERE id=$1`,[Number(req.params.id)]);if(!a.rowCount)return forwardJson(req,res);const out=await legalGateFor(req,{actionCode:'profile.submit',role:a.rows[0].role,territoryId:a.rows[0].territory_id});if(out.gate.blocked)return blocked(res,out.gate);return forwardJson(req,res)}catch(e){next(e)}});
app.post('/api/delivery/quote',body,async(req,res,next)=>{try{const out=await legalGateFor(req,{actionCode:'location.share',role:'customer'});if(out.gate.blocked)return blocked(res,out.gate);return forwardJson(req,res)}catch(e){next(e)}});
app.post('/api/courier/deliveries/:id/location',body,async(req,res,next)=>{try{const out=await legalGateFor(req,{actionCode:'location.share',role:'courier'});if(out.gate.blocked)return blocked(res,out.gate);return forwardJson(req,res)}catch(e){next(e)}});
app.put('/api/notifications/preferences',body,async(req,res,next)=>{try{if(req.body?.category==='marketing'&&(req.body?.email_enabled||req.body?.push_enabled||req.body?.in_app_enabled)){const me=await identity(req),role=clean(me.account.active_role||'*',40),out=await legalGateFor(req,{actionCode:'marketing.opt_in',role});if(out.gate.blocked)return blocked(res,out.gate)}return forwardJson(req,res)}catch(e){next(e)}});

// All existing Admin actions can become gated by reviewed Admin confidentiality documents, while legal governance itself stays reachable.
app.use('/api/admin',async(req,res,next)=>{try{const me=await identity(req),ctx=await activeAdminContext(me.account.id),out=await legalGateFor(req,{actionCode:'admin.access',role:'admin',territoryId:ctx.territoryId,adminAssignmentId:ctx.adminAssignmentId});if(out.gate.blocked)return blocked(res,out.gate);next()}catch(e){next(e)}});

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${upstreamPort}`};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Legal gateway upstream unavailable'})});req.pipe(up)}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected legal/consent error'})});

function start(){child=spawn(process.execPath,['server-notifications.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Notification child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<340;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Notification child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life legal/consent gateway listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
