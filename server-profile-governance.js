import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.INTERNAL_AUTH_HARDENING_PORT || 4007);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const body = express.json({ limit: '2800kb' });
const INVITE_ROLES = new Set(['merchant','supplier','courier']);
const GOVERNED_ROLES = new Set(['merchant','supplier','courier','service_provider']);
const APPLICATION_STATES = new Set(['application_started','requirements_pending','submitted','under_review','approved','rejected','suspended','revoked']);
let child;
let shuttingDown = false;

const clean=(v,max=700)=>String(v??'').trim().slice(0,max);
const email=v=>clean(v,160).toLowerCase();
const authHeader=req=>req.headers.authorization||'';
const randomToken=()=>crypto.randomBytes(30).toString('base64url');
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
async function upstream(path,options={}){return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
async function requireAdmin(req){const me=await identity(req);if(Number(me.account.id)!==1)throw Object.assign(new Error('Bootstrap Super Admin access required'),{status:403});return me}
function validTerritoryType(v){return ['country','region','province','city','municipality','district','barangay','custom_cell'].includes(v)}
function validTerritoryStatus(v){return ['planned','onboarding','active','paused','suspended','closed'].includes(v)}
async function activeAuthorization(accountId,role,territoryId=null){const args=[accountId,role];let q=`SELECT * FROM profile_authorizations WHERE account_id=$1 AND role=$2 AND status='active'`;if(territoryId!=null){args.push(territoryId);q+=` AND (territory_id=$3 OR territory_id IS NULL)`}q+=` ORDER BY territory_id NULLS LAST,id DESC LIMIT 1`;const r=await pool.query(q,args);return r.rows[0]||null}
async function applicationFor(accountId,role){const r=await pool.query(`SELECT pa.*,t.name territory_name,t.status territory_status FROM profile_applications pa LEFT JOIN territories t ON t.id=pa.territory_id WHERE pa.account_id=$1 AND pa.role=$2 ORDER BY pa.created_at DESC LIMIT 1`,[accountId,role]);return r.rows[0]||null}
async function audit(actorId,eventCode,targetAccountId=null,role='',territoryId=null,detail={}){await pool.query(`INSERT INTO profile_governance_events(actor_account_id,event_code,target_account_id,role,territory_id,detail_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[actorId,clean(eventCode,100),targetAccountId,clean(role,40),territoryId,JSON.stringify(detail)]).catch(()=>{})}

async function initDb(){await pool.query(`
  CREATE TABLE IF NOT EXISTS territories (
    id BIGSERIAL PRIMARY KEY,
    country_code TEXT NOT NULL DEFAULT 'PH',
    parent_id BIGINT REFERENCES territories(id) ON DELETE RESTRICT,
    territory_type TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'planned',
    created_by_account_id BIGINT REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(territory_type IN ('country','region','province','city','municipality','district','barangay','custom_cell')),
    CHECK(status IN ('planned','onboarding','active','paused','suspended','closed'))
  );
  CREATE INDEX IF NOT EXISTS territories_country_status_idx ON territories(country_code,status,name);

  CREATE TABLE IF NOT EXISTS profile_invitations (
    id BIGSERIAL PRIMARY KEY,
    target_email TEXT NOT NULL,
    role TEXT NOT NULL,
    territory_id BIGINT NOT NULL REFERENCES territories(id),
    token_hash TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'invited',
    invited_by_account_id BIGINT NOT NULL REFERENCES accounts(id),
    accepted_by_account_id BIGINT REFERENCES accounts(id),
    note TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(role IN ('merchant','supplier','courier')),
    CHECK(status IN ('invited','accepted','revoked','expired'))
  );
  CREATE INDEX IF NOT EXISTS profile_invitations_email_idx ON profile_invitations(LOWER(target_email),status,expires_at);

  CREATE TABLE IF NOT EXISTS profile_applications (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    territory_id BIGINT NOT NULL REFERENCES territories(id),
    invitation_id BIGINT REFERENCES profile_invitations(id),
    status TEXT NOT NULL DEFAULT 'application_started',
    proposed_business_name TEXT NOT NULL DEFAULT '',
    applicant_note TEXT NOT NULL DEFAULT '',
    responsibility_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    application_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ,
    reviewed_by_account_id BIGINT REFERENCES accounts(id),
    reviewed_at TIMESTAMPTZ,
    decision_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(role IN ('merchant','supplier','courier','service_provider')),
    CHECK(status IN ('application_started','requirements_pending','submitted','under_review','approved','rejected','suspended','revoked'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS profile_applications_live_unique ON profile_applications(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked');
  CREATE INDEX IF NOT EXISTS profile_applications_review_idx ON profile_applications(status,territory_id,created_at);

  CREATE TABLE IF NOT EXISTS profile_application_documents (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES profile_applications(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    evidence_data_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS profile_authorizations (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    territory_id BIGINT REFERENCES territories(id),
    application_id BIGINT REFERENCES profile_applications(id),
    status TEXT NOT NULL DEFAULT 'active',
    approved_by_account_id BIGINT REFERENCES accounts(id),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(role IN ('merchant','supplier','courier','service_provider')),
    CHECK(status IN ('active','suspended','revoked','expired'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS profile_authorizations_scope_unique ON profile_authorizations(account_id,role,COALESCE(territory_id,0));

  CREATE TABLE IF NOT EXISTS service_category_authorizations (
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    territory_id BIGINT NOT NULL REFERENCES territories(id),
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by_account_id BIGINT REFERENCES accounts(id),
    approved_at TIMESTAMPTZ,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(account_id,category_id,territory_id),
    CHECK(status IN ('pending','active','rejected','suspended','revoked'))
  );

  CREATE TABLE IF NOT EXISTS profile_governance_events (
    id BIGSERIAL PRIMARY KEY,
    actor_account_id BIGINT REFERENCES accounts(id),
    event_code TEXT NOT NULL,
    target_account_id BIGINT REFERENCES accounts(id),
    role TEXT NOT NULL DEFAULT '',
    territory_id BIGINT REFERENCES territories(id),
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS profile_governance_events_target_idx ON profile_governance_events(target_account_id,created_at DESC);

  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS territory_id BIGINT REFERENCES territories(id);

  INSERT INTO profile_authorizations(account_id,role,territory_id,status,approved_by_account_id,approved_at,reason)
  SELECT p.account_id,p.role,NULL,'active',1,NOW(),'Bootstrap migration: existing Project Owner profile'
  FROM profiles p WHERE p.account_id=1 AND p.enabled=TRUE AND p.role IN ('merchant','supplier','courier','service_provider')
  ON CONFLICT(account_id,role,COALESCE(territory_id,0)) DO NOTHING;

  UPDATE profiles p SET enabled=FALSE,status='requirements_pending',visibility='private',updated_at=NOW()
  WHERE p.account_id<>1 AND p.role IN ('merchant','supplier','courier','service_provider')
    AND NOT EXISTS(SELECT 1 FROM profile_authorizations a WHERE a.account_id=p.account_id AND a.role=p.role AND a.status='active');
`)}

async function profileState(me){const id=Number(me.account.id);const [apps,auths,invites,cats]=await Promise.all([
  pool.query(`SELECT pa.id,pa.role,pa.territory_id,t.name territory_name,pa.status,pa.proposed_business_name,pa.applicant_note,pa.responsibility_acknowledged,pa.application_data,pa.submitted_at,pa.reviewed_at,pa.decision_reason,pa.created_at FROM profile_applications pa JOIN territories t ON t.id=pa.territory_id WHERE pa.account_id=$1 ORDER BY pa.created_at DESC`,[id]),
  pool.query(`SELECT a.id,a.role,a.territory_id,t.name territory_name,a.status,a.approved_at,a.expires_at,a.reason FROM profile_authorizations a LEFT JOIN territories t ON t.id=a.territory_id WHERE a.account_id=$1 ORDER BY a.created_at DESC`,[id]),
  pool.query(`SELECT i.id,i.role,i.territory_id,t.name territory_name,i.status,i.note,i.expires_at,i.created_at FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE LOWER(i.target_email)=LOWER($1) AND i.status='invited' AND i.expires_at>NOW() ORDER BY i.created_at DESC`,[me.account.email||'']),
  pool.query(`SELECT sa.category_id,c.code,c.name,c.credential_gate,sa.territory_id,t.name territory_name,sa.status,sa.reason FROM service_category_authorizations sa JOIN service_categories c ON c.id=sa.category_id JOIN territories t ON t.id=sa.territory_id WHERE sa.account_id=$1 ORDER BY c.sort_order,c.name`,[id])
]);return{applications:apps.rows,authorizations:auths.rows,invitations:invites.rows,service_categories:cats.rows}}

app.get('/health',async(_q,res)=>{try{await pool.query('SELECT 1');const r=await upstream('/health');res.status(r.ok?200:503).json({ok:r.ok,db:true,auth_hardening:r.ok,version:'0.8.6-profile-governance'})}catch{res.status(503).json({ok:false,db:false,auth_hardening:false,version:'0.8.6-profile-governance'})}})
app.get('/profile-governance.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','profile-governance.css'),'utf8')))
app.get('/profile-governance-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','profile-governance-ui.js'),'utf8')))
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/profile-governance.css" />\n</head>').replace('</body>','  <script type="module" src="/profile-governance-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

app.get('/api/governance/state',async(req,res,next)=>{try{const me=await identity(req);res.json(await profileState(me))}catch(e){next(e)}})
app.get('/api/governance/territories',async(req,res,next)=>{try{await identity(req);const{rows}=await pool.query(`SELECT id,country_code,parent_id,territory_type,name,code,status FROM territories WHERE country_code='PH' AND status IN ('onboarding','active') ORDER BY name`);res.json(rows)}catch(e){next(e)}})

app.post('/api/governance/invitations/:id/accept',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM profile_invitations WHERE id=$1 AND status='invited' AND expires_at>NOW() FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Invitation is not available'),{status:404});const inv=q.rows[0];if(email(inv.target_email)!==email(me.account.email))throw Object.assign(new Error('This invitation belongs to a different email address'),{status:403});await client.query(`UPDATE profile_invitations SET status='accepted',accepted_by_account_id=$1,accepted_at=NOW() WHERE id=$2`,[me.account.id,id]);const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,invitation_id,status) VALUES($1,$2,$3,$4,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET invitation_id=EXCLUDED.invitation_id,updated_at=NOW() RETURNING *`,[me.account.id,inv.role,inv.territory_id,id]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id,inv.role]);await client.query('COMMIT');await audit(me.account.id,'invitation_accepted',me.account.id,inv.role,inv.territory_id,{invitation_id:id});res.json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.post('/api/governance/service-provider/start',body,async(req,res,next)=>{try{const me=await identity(req),territoryId=Number(req.body?.territory_id);const t=await pool.query(`SELECT id FROM territories WHERE id=$1 AND country_code='PH' AND status IN ('onboarding','active')`,[territoryId]);if(!t.rowCount)return res.status(409).json({error:'Choose an available operating territory'});const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,status) VALUES($1,'service_provider',$2,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET updated_at=NOW() RETURNING *`,[me.account.id,territoryId]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,'service_provider',FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id]);await client.query('COMMIT');await audit(me.account.id,'service_application_started',me.account.id,'service_provider',territoryId);res.status(201).json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.put('/api/governance/applications/:id',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),appRow=await pool.query(`SELECT * FROM profile_applications WHERE id=$1 AND account_id=$2`,[id,me.account.id]);if(!appRow.rowCount)return res.status(404).json({error:'Application not found'});const current=appRow.rows[0];if(!['application_started','requirements_pending','rejected'].includes(current.status))return res.status(409).json({error:'Application can no longer be edited in its current state'});const data=req.body?.application_data&&typeof req.body.application_data==='object'?req.body.application_data:{};const{rows}=await pool.query(`UPDATE profile_applications SET proposed_business_name=$1,applicant_note=$2,responsibility_acknowledged=$3,application_data=$4::jsonb,status='requirements_pending',updated_at=NOW() WHERE id=$5 RETURNING *`,[clean(req.body?.proposed_business_name,180),clean(req.body?.applicant_note,1600),Boolean(req.body?.responsibility_acknowledged),JSON.stringify(data),id]);res.json(rows[0])}catch(e){next(e)}})

function validEvidence(data){const x=String(data||'');if(!x)return false;if(x.length>2_800_000)return false;return /^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(x)}
app.post('/api/governance/applications/:id/documents',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id);const a=await pool.query(`SELECT 1 FROM profile_applications WHERE id=$1 AND account_id=$2 AND status IN ('application_started','requirements_pending','rejected')`,[id,me.account.id]);if(!a.rowCount)return res.status(409).json({error:'Application is not editable'});if(!validEvidence(req.body?.evidence_data_url))return res.status(400).json({error:'Evidence must be a PDF, PNG, JPEG or WebP within the preview size limit'});const count=await pool.query(`SELECT COUNT(*)::int n FROM profile_application_documents WHERE application_id=$1`,[id]);if(Number(count.rows[0].n)>=8)return res.status(409).json({error:'Application evidence limit reached'});const{rows}=await pool.query(`INSERT INTO profile_application_documents(application_id,document_type,label,evidence_data_url) VALUES($1,$2,$3,$4) RETURNING id,document_type,label,created_at`,[id,clean(req.body?.document_type,80)||'supporting_document',clean(req.body?.label,180),String(req.body.evidence_data_url)]);res.status(201).json(rows[0])}catch(e){next(e)}})

app.post('/api/governance/applications/:id/submit',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id);const a=await pool.query(`SELECT * FROM profile_applications WHERE id=$1 AND account_id=$2`,[id,me.account.id]);if(!a.rowCount)return res.status(404).json({error:'Application not found'});const x=a.rows[0];if(!x.responsibility_acknowledged)return res.status(409).json({error:'Acknowledge the role responsibility declaration before submitting'});if(x.role==='merchant'&&!clean(x.proposed_business_name,180))return res.status(409).json({error:'Merchant application needs a business/store name'});if(x.role==='service_provider'){const ids=Array.isArray(x.application_data?.requested_category_ids)?x.application_data.requested_category_ids.map(Number).filter(Number.isInteger):[];if(!ids.length)return res.status(409).json({error:'Choose at least one Local Services category'});}const{rows}=await pool.query(`UPDATE profile_applications SET status='submitted',submitted_at=NOW(),decision_reason='',updated_at=NOW() WHERE id=$1 AND status IN ('application_started','requirements_pending','rejected') RETURNING *`,[id]);if(!rows.length)return res.status(409).json({error:'Application cannot be submitted from its current state'});await audit(me.account.id,'application_submitted',me.account.id,x.role,x.territory_id,{application_id:id});res.json(rows[0])}catch(e){next(e)}})

app.get('/api/governance/admin/overview',async(req,res,next)=>{try{await requireAdmin(req);const[territories,apps,invites,auths]=await Promise.all([
  pool.query(`SELECT t.*,p.name parent_name FROM territories t LEFT JOIN territories p ON p.id=t.parent_id WHERE t.country_code='PH' ORDER BY t.created_at DESC`),
  pool.query(`SELECT pa.*,a.display_name,a.email,t.name territory_name,(SELECT COUNT(*)::int FROM profile_application_documents d WHERE d.application_id=pa.id) document_count FROM profile_applications pa JOIN accounts a ON a.id=pa.account_id JOIN territories t ON t.id=pa.territory_id ORDER BY CASE pa.status WHEN 'submitted' THEN 1 WHEN 'under_review' THEN 2 ELSE 9 END,pa.updated_at DESC LIMIT 250`),
  pool.query(`SELECT i.id,i.target_email,i.role,i.status,i.note,i.expires_at,i.created_at,t.name territory_name FROM profile_invitations i JOIN territories t ON t.id=i.territory_id ORDER BY i.created_at DESC LIMIT 250`),
  pool.query(`SELECT a.id,a.account_id,ac.display_name,ac.email,a.role,a.status,a.territory_id,t.name territory_name,a.approved_at,a.reason FROM profile_authorizations a JOIN accounts ac ON ac.id=a.account_id LEFT JOIN territories t ON t.id=a.territory_id ORDER BY a.updated_at DESC LIMIT 250`)
]);res.json({territories:territories.rows,applications:apps.rows,invitations:invites.rows,authorizations:auths.rows})}catch(e){next(e)}})

app.post('/api/governance/admin/territories',body,async(req,res,next)=>{try{const me=await requireAdmin(req),type=clean(req.body?.territory_type,40),status=clean(req.body?.status,30)||'onboarding',name=clean(req.body?.name,180);if(!name||!validTerritoryType(type)||!validTerritoryStatus(status))return res.status(400).json({error:'Valid territory name, type and status are required'});const parent=req.body?.parent_id?Number(req.body.parent_id):null;if(parent){const p=await pool.query(`SELECT 1 FROM territories WHERE id=$1 AND country_code='PH'`,[parent]);if(!p.rowCount)return res.status(404).json({error:'Parent territory not found'})}const code=clean(req.body?.code,80)||null;const{rows}=await pool.query(`INSERT INTO territories(country_code,parent_id,territory_type,name,code,status,created_by_account_id) VALUES('PH',$1,$2,$3,$4,$5,$6) RETURNING *`,[parent,type,name,code,status,me.account.id]);await audit(me.account.id,'territory_created',null,'',rows[0].id,{name,type,status});res.status(201).json(rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'Territory code already exists'});next(e)}})

app.post('/api/governance/admin/invitations',body,async(req,res,next)=>{try{const me=await requireAdmin(req),role=clean(req.body?.role,40),target=email(req.body?.target_email),territoryId=Number(req.body?.territory_id);if(!INVITE_ROLES.has(role)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target))return res.status(400).json({error:'Valid invite role and email are required'});const t=await pool.query(`SELECT id,name,status FROM territories WHERE id=$1 AND country_code='PH' AND status IN ('onboarding','active')`,[territoryId]);if(!t.rowCount)return res.status(409).json({error:'Invitation requires an onboarding or active PH territory'});await pool.query(`UPDATE profile_invitations SET status='revoked',revoked_at=NOW() WHERE LOWER(target_email)=$1 AND role=$2 AND territory_id=$3 AND status='invited'`,[target,role,territoryId]);const raw=randomToken();const days=Math.max(1,Math.min(30,Number(req.body?.expires_days)||7));const{rows}=await pool.query(`INSERT INTO profile_invitations(target_email,role,territory_id,token_hash,status,invited_by_account_id,note,expires_at) VALUES($1,$2,$3,$4,'invited',$5,$6,NOW()+($7*INTERVAL '1 day')) RETURNING id,target_email,role,territory_id,status,note,expires_at,created_at`,[target,role,territoryId,hash(raw),me.account.id,clean(req.body?.note,700),days]);await audit(me.account.id,'invitation_created',null,role,territoryId,{invitation_id:rows[0].id,target_email_hash:hash(target)});res.status(201).json({...rows[0],invite_token:raw})}catch(e){next(e)}})

app.get('/api/governance/invite/:token',async(req,res,next)=>{try{const me=await identity(req),tokenHash=hash(clean(req.params.token,300));const q=await pool.query(`SELECT i.id,i.target_email,i.role,i.territory_id,i.status,i.note,i.expires_at,t.name territory_name FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE i.token_hash=$1 AND i.status='invited' AND i.expires_at>NOW()`,[tokenHash]);if(!q.rowCount)return res.status(404).json({error:'Invitation is invalid or expired'});if(email(q.rows[0].target_email)!==email(me.account.email))return res.status(403).json({error:'Sign in with the invited email address'});res.json(q.rows[0])}catch(e){next(e)}})
app.post('/api/governance/invite/:token/accept',body,async(req,res,next)=>{try{const me=await identity(req),tokenHash=hash(clean(req.params.token,300)),q=await pool.query(`SELECT id FROM profile_invitations WHERE token_hash=$1 AND status='invited' AND expires_at>NOW()`,[tokenHash]);if(!q.rowCount)return res.status(404).json({error:'Invitation is invalid or expired'});req.params.id=String(q.rows[0].id);const fake={...req,params:{id:String(q.rows[0].id)}};const inv=await pool.query(`SELECT * FROM profile_invitations WHERE id=$1`,[q.rows[0].id]);if(email(inv.rows[0].target_email)!==email(me.account.email))return res.status(403).json({error:'Sign in with the invited email address'});const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE profile_invitations SET status='accepted',accepted_by_account_id=$1,accepted_at=NOW() WHERE id=$2`,[me.account.id,q.rows[0].id]);const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,invitation_id,status) VALUES($1,$2,$3,$4,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET invitation_id=EXCLUDED.invitation_id,updated_at=NOW() RETURNING *`,[me.account.id,inv.rows[0].role,inv.rows[0].territory_id,q.rows[0].id]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id,inv.rows[0].role]);await client.query('COMMIT');await audit(me.account.id,'invitation_accepted',me.account.id,inv.rows[0].role,inv.rows[0].territory_id,{invitation_id:q.rows[0].id});res.json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.get('/api/governance/admin/applications/:id',async(req,res,next)=>{try{await requireAdmin(req);const id=Number(req.params.id);const a=await pool.query(`SELECT pa.*,ac.display_name,ac.email,t.name territory_name FROM profile_applications pa JOIN accounts ac ON ac.id=pa.account_id JOIN territories t ON t.id=pa.territory_id WHERE pa.id=$1`,[id]);if(!a.rowCount)return res.status(404).json({error:'Application not found'});const[docs,services,credentials]=await Promise.all([pool.query(`SELECT id,document_type,label,created_at FROM profile_application_documents WHERE application_id=$1 ORDER BY created_at`,[id]),pool.query(`SELECT s.category_id,c.code,c.name,c.credential_gate,s.service_label FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 ORDER BY c.sort_order,c.name`,[a.rows[0].account_id]),pool.query(`SELECT id,credential_type,title,issuing_body,verification_status,expiry_date FROM profile_credentials WHERE account_id=$1 ORDER BY created_at DESC`,[a.rows[0].account_id])]);res.json({...a.rows[0],documents:docs.rows,existing_services:services.rows,credentials:credentials.rows})}catch(e){next(e)}})
app.get('/api/governance/admin/application-documents/:id',async(req,res,next)=>{try{await requireAdmin(req);const q=await pool.query(`SELECT document_type,label,evidence_data_url FROM profile_application_documents WHERE id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Document not found'});res.json(q.rows[0])}catch(e){next(e)}})

async function ensureApprovedProfile(client,appRow,adminId,approvedCategoryIds=[]){const accountId=Number(appRow.account_id),role=appRow.role,territoryId=Number(appRow.territory_id);await client.query(`INSERT INTO profile_authorizations(account_id,role,territory_id,application_id,status,approved_by_account_id,approved_at,reason) VALUES($1,$2,$3,$4,'active',$5,NOW(),'Approved') ON CONFLICT(account_id,role,COALESCE(territory_id,0)) DO UPDATE SET application_id=EXCLUDED.application_id,status='active',approved_by_account_id=EXCLUDED.approved_by_account_id,approved_at=NOW(),reason='Approved',updated_at=NOW()`,[accountId,role,territoryId,appRow.id,adminId]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,TRUE,'private','active') ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active',visibility=CASE WHEN profiles.visibility='public' THEN 'public' ELSE 'private' END,updated_at=NOW()`,[accountId,role]);if(role==='merchant'){const existing=await client.query(`SELECT 1 FROM business_memberships WHERE account_id=$1 AND active=TRUE LIMIT 1`,[accountId]);if(!existing.rowCount){const name=clean(appRow.proposed_business_name,180)||'My Business';const b=await client.query(`INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',$2) RETURNING id`,[name,territoryId]);await client.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)`,[b.rows[0].id,accountId]);}}
if(role==='supplier')await client.query(`INSERT INTO supplier_profiles(account_id,supplier_name) SELECT id,COALESCE(NULLIF($2,''),display_name) FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`,[accountId,clean(appRow.proposed_business_name,180)]);
if(role==='courier')await client.query(`INSERT INTO courier_profiles(account_id,display_name,eligibility_status) SELECT id,display_name,'pending' FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO UPDATE SET eligibility_status=CASE WHEN courier_profiles.eligibility_status='not_requested' THEN 'pending' ELSE courier_profiles.eligibility_status END`,[accountId]);
if(role==='service_provider'){
  await client.query(`INSERT INTO service_provider_profiles(account_id,display_name,professional_headline,about,service_area,years_experience) SELECT id,display_name,$2,$3,$4,$5 FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO UPDATE SET professional_headline=EXCLUDED.professional_headline,about=EXCLUDED.about,service_area=EXCLUDED.service_area,years_experience=EXCLUDED.years_experience,updated_at=NOW()`,[accountId,clean(appRow.application_data?.professional_headline,160),clean(appRow.application_data?.about,1800),clean(appRow.application_data?.service_area,300),Number.isFinite(Number(appRow.application_data?.years_experience))?Number(appRow.application_data.years_experience):null]);
  const requested=Array.isArray(appRow.application_data?.requested_category_ids)?appRow.application_data.requested_category_ids.map(Number).filter(Number.isInteger):[];const allow=new Set((Array.isArray(approvedCategoryIds)?approvedCategoryIds:[]).map(Number));for(const categoryId of requested){const c=await client.query(`SELECT id,name,credential_gate FROM service_categories WHERE id=$1 AND active=TRUE`,[categoryId]);if(!c.rowCount)continue;let ok=allow.has(categoryId);let reason='Not approved in this review';if(ok&&c.rows[0].credential_gate){const verified=await client.query(`SELECT 1 FROM profile_credentials WHERE account_id=$1 AND verification_status='verified' AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE) LIMIT 1`,[accountId]);if(!verified.rowCount){ok=false;reason='Credential-gated category requires verified evidence before activation'}}await client.query(`INSERT INTO service_category_authorizations(account_id,category_id,territory_id,status,approved_by_account_id,approved_at,reason) VALUES($1,$2,$3,$4,$5,CASE WHEN $4='active' THEN NOW() END,$6) ON CONFLICT(account_id,category_id,territory_id) DO UPDATE SET status=EXCLUDED.status,approved_by_account_id=EXCLUDED.approved_by_account_id,approved_at=EXCLUDED.approved_at,reason=EXCLUDED.reason,updated_at=NOW()`,[accountId,categoryId,territoryId,ok?'active':'pending',adminId,ok?'Approved':reason]);if(ok)await client.query(`INSERT INTO service_provider_services(account_id,category_id,service_label,active) VALUES($1,$2,$3,TRUE) ON CONFLICT(account_id,category_id,service_label) DO UPDATE SET active=TRUE`,[accountId,categoryId,c.rows[0].name]);}
}}

app.post('/api/governance/admin/applications/:id/review',body,async(req,res,next)=>{try{const me=await requireAdmin(req),id=Number(req.params.id),decision=clean(req.body?.decision,30);if(!['approve','reject','under_review'].includes(decision))return res.status(400).json({error:'Choose approve, reject or under_review'});const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM profile_applications WHERE id=$1 FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Application not found'),{status:404});const a=q.rows[0];if(!['submitted','under_review'].includes(a.status))throw Object.assign(new Error('Application is not awaiting review'),{status:409});if(decision==='under_review'){await client.query(`UPDATE profile_applications SET status='under_review',reviewed_by_account_id=$1,decision_reason=$2,updated_at=NOW() WHERE id=$3`,[me.account.id,clean(req.body?.reason,1000),id]);}
else if(decision==='reject'){await client.query(`UPDATE profile_applications SET status='rejected',reviewed_by_account_id=$1,reviewed_at=NOW(),decision_reason=$2,updated_at=NOW() WHERE id=$3`,[me.account.id,clean(req.body?.reason,1000)||'Requirements not approved',id]);await client.query(`UPDATE profiles SET enabled=FALSE,status='rejected',visibility='private',updated_at=NOW() WHERE account_id=$1 AND role=$2`,[a.account_id,a.role]);}
else{await ensureApprovedProfile(client,a,me.account.id,req.body?.approved_category_ids);await client.query(`UPDATE profile_applications SET status='approved',reviewed_by_account_id=$1,reviewed_at=NOW(),decision_reason=$2,updated_at=NOW() WHERE id=$3`,[me.account.id,clean(req.body?.reason,1000)||'Approved',id]);}
await client.query('COMMIT');await audit(me.account.id,`application_${decision}`,a.account_id,a.role,a.territory_id,{application_id:id,reason:clean(req.body?.reason,300)});res.json(await applicationFor(a.account_id,a.role))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.post('/api/governance/admin/authorizations/:id/status',body,async(req,res,next)=>{try{const me=await requireAdmin(req),id=Number(req.params.id),status=clean(req.body?.status,30);if(!['active','suspended','revoked'].includes(status))return res.status(400).json({error:'Choose active, suspended or revoked'});const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM profile_authorizations WHERE id=$1 FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Authorization not found'),{status:404});const a=q.rows[0];await client.query(`UPDATE profile_authorizations SET status=$1,reason=$2,updated_at=NOW() WHERE id=$3`,[status,clean(req.body?.reason,1000),id]);if(status==='active')await client.query(`UPDATE profiles SET enabled=TRUE,status='active',updated_at=NOW() WHERE account_id=$1 AND role=$2`,[a.account_id,a.role]);else{await client.query(`UPDATE profiles SET enabled=FALSE,status=$1,visibility='private',updated_at=NOW() WHERE account_id=$2 AND role=$3`,[status,a.account_id,a.role]);if(a.role==='merchant')await client.query(`UPDATE merchant_storefronts ms SET publication_status='paused',updated_at=NOW() FROM business_memberships bm WHERE bm.business_id=ms.business_id AND bm.account_id=$1`,[a.account_id]);if(a.role==='courier')await client.query(`UPDATE courier_profiles SET available=FALSE,eligibility_status=CASE WHEN eligibility_status='approved' THEN 'suspended' ELSE eligibility_status END,updated_at=NOW() WHERE account_id=$1`,[a.account_id]);}await client.query('COMMIT');await audit(me.account.id,`authorization_${status}`,a.account_id,a.role,a.territory_id,{authorization_id:id,reason:clean(req.body?.reason,300)});res.json({ok:true,status})}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

async function forwardJson(req,res,path=req.originalUrl,bodyValue=req.body){const r=await upstream(path,{method:req.method,headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(bodyValue??{})});const b=await r.json().catch(()=>({}));res.status(r.status).json(b)}
app.put('/api/profiles/:role',body,async(req,res,next)=>{try{const role=clean(req.params.role,40);if(role==='customer')return forwardJson(req,res);if(!GOVERNED_ROLES.has(role))return forwardJson(req,res);const me=await identity(req);if(req.body?.enabled===false){return forwardJson(req,res)}const auth=await activeAuthorization(me.account.id,role);if(!auth)return res.status(403).json({error:role==='service_provider'?'Submit and obtain approval for your Local Services application first.':'This profile is invitation-only and requires Admin approval.'});return forwardJson(req,res)}catch(e){next(e)}})
app.put('/api/service-provider/services',body,async(req,res,next)=>{try{const me=await identity(req),auth=await activeAuthorization(me.account.id,'service_provider');if(!auth)return res.status(403).json({error:'Service Provider approval required'});const allowed=await pool.query(`SELECT category_id FROM service_category_authorizations WHERE account_id=$1 AND status='active'`,[me.account.id]);const set=new Set(allowed.rows.map(x=>Number(x.category_id)));const requested=Array.isArray(req.body?.services)?req.body.services:[];const filtered=requested.filter(x=>set.has(Number(x.category_id)));if(filtered.length!==requested.length)return res.status(403).json({error:'One or more selected service categories are not approved for this profile'});return forwardJson(req,res,req.originalUrl,{...req.body,services:filtered})}catch(e){next(e)}})

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${upstreamPort}`};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Governance upstream unavailable'})});req.pipe(up)}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected governance error'})})

function start(){child=spawn(process.execPath,['server-auth-hardening.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Auth hardening child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<220;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Auth hardening child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life profile governance gateway listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
