import express from 'express';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';
import { requireAdminPermission,appendAdminAudit } from './admin-authorization.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const internalMarketplacePort = Number(process.env.INTERNAL_MARKETPLACE_PORT || 3407);
const internalOrdersPort = Number(process.env.INTERNAL_ORDERS_PORT || 3307);
const internalAuthPort = Number(process.env.INTERNAL_AUTH_PORT || 3207);
const internalAccountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const body = express.json({ limit: '2500kb' });
let child;
let shuttingDown = false;

function clean(v,max=600){return String(v??'').trim().slice(0,max)}
function authHeader(req){return req.headers.authorization||''}
function numberOrNull(v){if(v===''||v==null)return null;const x=Number(v);return Number.isFinite(x)?x:null}
async function childFetch(path,options={}){return fetch(`http://127.0.0.1:${internalMarketplacePort}${path}`,options)}
async function identity(req){const r=await childFetch('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
async function requireProvider(req){const me=await identity(req);if(!enabled(me,'service_provider'))throw Object.assign(new Error('Service Provider profile required'),{status:403});return me}
async function requireCustomer(req){const me=await identity(req);if(!enabled(me,'customer'))throw Object.assign(new Error('Customer profile required'),{status:403});return me}
function validateEvidence(data){const x=String(data||'');if(!x)return '';if(x.length>1_900_000)throw Object.assign(new Error('Document is too large for this preview. Keep it under about 1.4 MB.'),{status:413});if(!/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(x))throw Object.assign(new Error('Evidence must be PDF, PNG, JPEG or WebP'),{status:400});return x}
function validateImage(data){const x=String(data||'');if(!x)return '';if(x.length>450_000)throw Object.assign(new Error('Image is too large'),{status:413});if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x))throw Object.assign(new Error('Image must be PNG, JPEG or WebP'),{status:400});return x}

async function initDb(){await ensureMonetizationSchema(pool);await pool.query(`
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS profile_image_data_url TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS languages TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS availability_text TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS pricing_model TEXT NOT NULL DEFAULT 'quotation';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS price_from NUMERIC(12,2);
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS price_to NUMERIC(12,2);
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS same_day_available BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_public_summary TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_private_data_url TEXT NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS service_categories (
    id BIGSERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    credential_gate BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS service_provider_services (
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES service_categories(id),
    service_label TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(account_id,category_id,service_label)
  );
  CREATE TABLE IF NOT EXISTS profile_credentials (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL,
    title TEXT NOT NULL,
    issuing_body TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    issue_date DATE,
    expiry_date DATE,
    evidence_data_url TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'submitted',
    verified_by_account_id BIGINT REFERENCES accounts(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (credential_type IN ('prc_license','tesda_nc_coc','diploma_vocational','training_certificate','experience_certificate','other')),
    CHECK (verification_status IN ('unverified','submitted','verified','rejected','expired'))
  );
  CREATE INDEX IF NOT EXISTS profile_credentials_account_idx ON profile_credentials(account_id,verification_status);

  CREATE TABLE IF NOT EXISTS service_portfolio (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category_id BIGINT REFERENCES service_categories(id),
    image_data_url TEXT NOT NULL DEFAULT '',
    approximate_date DATE,
    linked_job_id BIGINT,
    customer_publication_consent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS service_jobs (
    id BIGSERIAL PRIMARY KEY,
    customer_account_id BIGINT NOT NULL REFERENCES accounts(id),
    provider_account_id BIGINT NOT NULL REFERENCES accounts(id),
    category_id BIGINT REFERENCES service_categories(id),
    service_label TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    service_location TEXT NOT NULL DEFAULT '',
    requested_window TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'requested',
    quote_amount NUMERIC(12,2),
    quote_note TEXT NOT NULL DEFAULT '',
    scheduled_at TIMESTAMPTZ,
    final_price NUMERIC(12,2),
    currency_code TEXT NOT NULL DEFAULT 'PHP',
    provider_completed_at TIMESTAMPTZ,
    customer_confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('requested','provider_reviewing','quoted','accepted','scheduled','in_progress','completed','cancelled','disputed'))
  );
  CREATE INDEX IF NOT EXISTS service_jobs_provider_idx ON service_jobs(provider_account_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS service_jobs_customer_idx ON service_jobs(customer_account_id,status,created_at DESC);

  CREATE TABLE IF NOT EXISTS service_reviews (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT UNIQUE NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
    reviewer_account_id BIGINT NOT NULL REFERENCES accounts(id),
    provider_account_id BIGINT NOT NULL REFERENCES accounts(id),
    workmanship INTEGER NOT NULL CHECK (workmanship BETWEEN 1 AND 5),
    reliability INTEGER NOT NULL CHECK (reliability BETWEEN 1 AND 5),
    communication INTEGER NOT NULL CHECK (communication BETWEEN 1 AND 5),
    professionalism INTEGER NOT NULL CHECK (professionalism BETWEEN 1 AND 5),
    property_care INTEGER NOT NULL CHECK (property_care BETWEEN 1 AND 5),
    price_transparency INTEGER NOT NULL CHECK (price_transparency BETWEEN 1 AND 5),
    overall INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 5),
    review_text TEXT NOT NULL DEFAULT '',
    moderation_status TEXT NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (moderation_status IN ('published','hidden_pending_review','removed'))
  );

  INSERT INTO service_categories(code,name,credential_gate,sort_order) VALUES
    ('electrical','Electrical',TRUE,10),('plumbing','Plumbing',FALSE,20),('carpentry','Carpentry / Joinery',FALSE,30),
    ('furniture','Furniture work',FALSE,40),('painting','Painting / Decorating',FALSE,50),('roofing','Roofing / Sheet metal',FALSE,60),
    ('masonry','Masonry',FALSE,70),('welding','Welding / Metalwork',FALSE,80),('appliance_repair','Appliance repair',FALSE,90),
    ('aircon','Air-conditioning / Refrigeration',FALSE,100),('cleaning','Cleaning',FALSE,110),('gardening','Gardening / Landscaping',FALSE,120),
    ('tailoring','Tailoring',FALSE,130),('computer_repair','Computer repair',FALSE,140),('phone_repair','Phone repair',FALSE,150),
    ('handyman','General handyman',FALSE,160)
  ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,credential_gate=EXCLUDED.credential_gate,sort_order=EXCLUDED.sort_order;
`)}

async function rating(accountId){const r=await pool.query(`SELECT COUNT(*)::int review_count,ROUND(AVG(overall)::numeric,2) rating FROM service_reviews WHERE provider_account_id=$1 AND moderation_status='published'`,[accountId]);return{review_count:Number(r.rows[0]?.review_count||0),rating:r.rows[0]?.rating==null?null:Number(r.rows[0].rating)}}
async function publicProvider(accountId){const q=await pool.query(`SELECT a.id account_id,a.display_name,p.professional_headline,p.about,p.service_area,p.years_experience,p.languages,p.availability_text,p.pricing_model,p.price_from,p.price_to,p.same_day_available,p.public_reputation_enabled,p.profile_image_data_url,pr.visibility FROM accounts a JOIN service_provider_profiles p ON p.account_id=a.id JOIN profiles pr ON pr.account_id=a.id AND pr.role='service_provider' AND pr.enabled=TRUE WHERE a.id=$1 AND pr.visibility='public'`,[accountId]);if(!q.rowCount)return null;const [services,credentials,portfolio,rate]=await Promise.all([pool.query(`SELECT c.code,c.name,s.service_label FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.active=TRUE ORDER BY c.sort_order,c.name,s.service_label`,[accountId]),pool.query(`SELECT credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status FROM profile_credentials WHERE account_id=$1 AND verification_status IN ('verified','submitted','unverified','expired') ORDER BY verification_status='verified' DESC,created_at DESC`,[accountId]),pool.query(`SELECT p.id,p.title,p.description,p.image_data_url,p.approximate_date,p.linked_job_id,c.name category FROM service_portfolio p LEFT JOIN service_categories c ON c.id=p.category_id WHERE p.account_id=$1 AND (p.linked_job_id IS NULL OR p.customer_publication_consent=TRUE) ORDER BY p.created_at DESC LIMIT 20`,[accountId]),rating(accountId)]);const base=q.rows[0];return{...base,services:services.rows,credentials:credentials.rows,portfolio:portfolio.rows,...(base.public_reputation_enabled?rate:{rating:null,review_count:0})}}
async function privateProfile(accountId){const p=await pool.query(`SELECT * FROM service_provider_profiles WHERE account_id=$1`,[accountId]);const [services,credentials,portfolio,rate,reviews]=await Promise.all([pool.query(`SELECT s.category_id,c.code,c.name,c.credential_gate,s.service_label,s.active FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 ORDER BY c.sort_order,c.name`,[accountId]),pool.query(`SELECT id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at FROM profile_credentials WHERE account_id=$1 ORDER BY created_at DESC`,[accountId]),pool.query(`SELECT p.*,c.name category FROM service_portfolio p LEFT JOIN service_categories c ON c.id=p.category_id WHERE p.account_id=$1 ORDER BY p.created_at DESC`,[accountId]),rating(accountId),pool.query(`SELECT r.id,r.job_id,r.overall,r.workmanship,r.reliability,r.communication,r.professionalism,r.property_care,r.price_transparency,r.review_text,r.created_at,a.display_name reviewer_name,j.service_label FROM service_reviews r JOIN accounts a ON a.id=r.reviewer_account_id JOIN service_jobs j ON j.id=r.job_id WHERE r.provider_account_id=$1 AND r.moderation_status='published' ORDER BY r.created_at DESC LIMIT 50`,[accountId])]);return{profile:p.rows[0]||null,services:services.rows,credentials:credentials.rows,portfolio:portfolio.rows,reviews:reviews.rows,...rate}}

app.get('/health',async(_q,r)=>{try{await pool.query('SELECT 1');const c=await childFetch('/health');r.status(c.ok?200:503).json({ok:c.ok,db:true,marketplace:c.ok,version:'0.8.1-services'})}catch{r.status(503).json({ok:false,db:false,marketplace:false,version:'0.8.1-services'})}})
app.get('/services.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','services.css'),'utf8')))
app.get('/services-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','services-ui.js'),'utf8')))
async function root(req,res){const r=await childFetch(req.path,{headers:{...req.headers,host:`127.0.0.1:${internalMarketplacePort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/services.css" />\n</head>').replace('</body>','  <script type="module" src="/services-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

app.get('/api/services/categories',async(req,res,next)=>{try{await identity(req);const{rows}=await pool.query(`SELECT id,code,name,credential_gate FROM service_categories WHERE active=TRUE ORDER BY sort_order,name`);res.json(rows)}catch(e){next(e)}})
app.get('/api/services/providers',async(req,res,next)=>{try{await requireCustomer(req);const category=clean(req.query.category,80);const args=[];let clause='';if(category){args.push(category);clause=` AND EXISTS(SELECT 1 FROM service_provider_services ss JOIN service_categories c ON c.id=ss.category_id WHERE ss.account_id=a.id AND ss.active=TRUE AND c.code=$1)`}const{rows}=await pool.query(`SELECT a.id account_id,a.display_name,p.professional_headline,p.about,p.service_area,p.years_experience,p.languages,p.availability_text,p.pricing_model,p.price_from,p.price_to,p.same_day_available,p.public_reputation_enabled,p.profile_image_data_url FROM accounts a JOIN service_provider_profiles p ON p.account_id=a.id JOIN profiles pr ON pr.account_id=a.id AND pr.role='service_provider' AND pr.enabled=TRUE AND pr.visibility='public' WHERE 1=1${clause} ORDER BY p.same_day_available DESC,a.display_name`,args);const out=[];for(const row of rows){const svc=await pool.query(`SELECT c.code,c.name,s.service_label FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.active=TRUE ORDER BY c.sort_order LIMIT 8`,[row.account_id]);const cred=await pool.query(`SELECT title,credential_type FROM profile_credentials WHERE account_id=$1 AND verification_status='verified' ORDER BY created_at DESC LIMIT 3`,[row.account_id]);const rate=row.public_reputation_enabled?await rating(row.account_id):{rating:null,review_count:0};out.push({...row,services:svc.rows,verified_credentials:cred.rows,...rate})}res.json(out)}catch(e){next(e)}})
app.get('/api/services/providers/:accountId',async(req,res,next)=>{try{await requireCustomer(req);const p=await publicProvider(Number(req.params.accountId));if(!p)return res.status(404).json({error:'Public Service Provider profile not found'});res.json(p)}catch(e){next(e)}})

app.get('/api/service-provider/me',async(req,res,next)=>{try{const me=await requireProvider(req);res.json(await privateProfile(Number(me.account.id)))}catch(e){next(e)}})
app.put('/api/service-provider/me',body,async(req,res,next)=>{try{const me=await requireProvider(req),id=Number(me.account.id);const image=req.body?.profile_image_data_url===undefined?null:validateImage(req.body.profile_image_data_url);const cv=req.body?.cv_private_data_url===undefined?null:validateEvidence(req.body.cv_private_data_url);await pool.query(`UPDATE service_provider_profiles SET display_name=$1,professional_headline=$2,about=$3,service_area=$4,years_experience=$5,languages=$6,availability_text=$7,pricing_model=$8,price_from=$9,price_to=$10,same_day_available=$11,public_reputation_enabled=$12,profile_image_data_url=COALESCE($13,profile_image_data_url),cv_public_summary=$14,cv_private_data_url=COALESCE($15,cv_private_data_url),updated_at=NOW() WHERE account_id=$16`,[clean(req.body?.display_name,120)||me.account.display_name,clean(req.body?.professional_headline,160),clean(req.body?.about,1800),clean(req.body?.service_area,300),numberOrNull(req.body?.years_experience),clean(req.body?.languages,300),clean(req.body?.availability_text,500),['quotation','fixed','hourly','daily','mixed'].includes(req.body?.pricing_model)?req.body.pricing_model:'quotation',numberOrNull(req.body?.price_from),numberOrNull(req.body?.price_to),Boolean(req.body?.same_day_available),Boolean(req.body?.public_reputation_enabled),image,clean(req.body?.cv_public_summary,1600),cv,id]);if(req.body?.visibility){const vis=['public','relationship_only','private'].includes(req.body.visibility)?req.body.visibility:'private';await pool.query(`UPDATE profiles SET visibility=$1,updated_at=NOW() WHERE account_id=$2 AND role='service_provider'`,[vis,id])}res.json(await privateProfile(id))}catch(e){next(e)}})
app.put('/api/service-provider/services',body,async(req,res,next)=>{try{const me=await requireProvider(req),id=Number(me.account.id),selections=Array.isArray(req.body?.services)?req.body.services:[];const client=await pool.connect();try{await client.query('BEGIN');await client.query(`DELETE FROM service_provider_services WHERE account_id=$1`,[id]);for(const s of selections.slice(0,80)){const categoryId=Number(s.category_id);if(!Number.isInteger(categoryId))continue;await client.query(`INSERT INTO service_provider_services(account_id,category_id,service_label,active) VALUES($1,$2,$3,TRUE)`,[id,categoryId,clean(s.service_label,120)])}await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}res.json(await privateProfile(id))}catch(e){next(e)}})
app.post('/api/service-provider/credentials',body,async(req,res,next)=>{try{const me=await requireProvider(req),type=clean(req.body?.credential_type,60);if(!['prc_license','tesda_nc_coc','diploma_vocational','training_certificate','experience_certificate','other'].includes(type))return res.status(400).json({error:'Choose a credential type'});if(!clean(req.body?.title,200))return res.status(400).json({error:'Credential title is required'});const evidence=validateEvidence(req.body?.evidence_data_url);const{rows}=await pool.query(`INSERT INTO profile_credentials(account_id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,evidence_data_url,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitted') RETURNING id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status,created_at`,[me.account.id,type,clean(req.body.title,200),clean(req.body?.issuing_body,200),clean(req.body?.reference_number,120),req.body?.issue_date||null,req.body?.expiry_date||null,evidence]);res.status(201).json(rows[0])}catch(e){next(e)}})
app.post('/api/service-provider/portfolio',body,async(req,res,next)=>{try{const me=await requireProvider(req);const image=validateImage(req.body?.image_data_url);if(!image||!clean(req.body?.title,160))return res.status(400).json({error:'Portfolio title and image are required'});const{rows}=await pool.query(`INSERT INTO service_portfolio(account_id,title,description,category_id,image_data_url,approximate_date,customer_publication_consent) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[me.account.id,clean(req.body.title,160),clean(req.body?.description,800),req.body?.category_id?Number(req.body.category_id):null,image,req.body?.approximate_date||null,Boolean(req.body?.customer_publication_consent)]);res.status(201).json(rows[0])}catch(e){next(e)}})

app.post('/api/services/jobs',body,async(req,res,next)=>{try{const me=await requireCustomer(req),providerId=Number(req.body?.provider_account_id),categoryId=Number(req.body?.category_id);if(providerId===Number(me.account.id))return res.status(409).json({error:'You cannot request your own service'});const provider=await publicProvider(providerId);if(!provider)return res.status(404).json({error:'Service Provider is not available'});if(!clean(req.body?.description,1500))return res.status(400).json({error:'Describe the work you need'});const{rows}=await pool.query(`INSERT INTO service_jobs(customer_account_id,provider_account_id,category_id,service_label,description,service_location,requested_window,status) VALUES($1,$2,$3,$4,$5,$6,$7,'requested') RETURNING *`,[me.account.id,providerId,Number.isInteger(categoryId)?categoryId:null,clean(req.body?.service_label,120),clean(req.body.description,1500),clean(req.body?.service_location||me.account.address,400),clean(req.body?.requested_window,300)]);res.status(201).json(rows[0])}catch(e){next(e)}})
app.get('/api/services/jobs/mine',async(req,res,next)=>{try{const me=await identity(req),id=Number(me.account.id);const{rows}=await pool.query(`SELECT j.*,c.name category,a.display_name provider_name,cu.display_name customer_name FROM service_jobs j LEFT JOIN service_categories c ON c.id=j.category_id JOIN accounts a ON a.id=j.provider_account_id JOIN accounts cu ON cu.id=j.customer_account_id WHERE j.customer_account_id=$1 OR j.provider_account_id=$1 ORDER BY j.created_at DESC LIMIT 200`,[id]);res.json(rows)}catch(e){next(e)}})
app.post('/api/service-provider/jobs/:id/quote',body,async(req,res,next)=>{try{const me=await requireProvider(req),id=Number(req.params.id),amount=Number(req.body?.quote_amount);if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:'Valid quote amount required'});const r=await pool.query(`UPDATE service_jobs SET status='quoted',quote_amount=$1,quote_note=$2,updated_at=NOW() WHERE id=$3 AND provider_account_id=$4 AND status IN ('requested','provider_reviewing','quoted') RETURNING *`,[amount,clean(req.body?.quote_note,800),id,me.account.id]);if(!r.rowCount)return res.status(409).json({error:'Job cannot be quoted from its current state'});res.json(r.rows[0])}catch(e){next(e)}})
app.post('/api/services/jobs/:id/accept-quote',body,async(req,res,next)=>{try{const me=await requireCustomer(req);const r=await pool.query(`UPDATE service_jobs SET status='accepted',updated_at=NOW() WHERE id=$1 AND customer_account_id=$2 AND status='quoted' RETURNING *`,[Number(req.params.id),me.account.id]);if(!r.rowCount)return res.status(409).json({error:'Quote is not available for acceptance'});res.json(r.rows[0])}catch(e){next(e)}})
app.post('/api/service-provider/jobs/:id/status',body,async(req,res,next)=>{try{const me=await requireProvider(req),status=clean(req.body?.status,40);if(!['provider_reviewing','scheduled','in_progress','completed','cancelled','disputed'].includes(status))return res.status(400).json({error:'Unsupported job status'});const job=await pool.query(`SELECT * FROM service_jobs WHERE id=$1 AND provider_account_id=$2`,[Number(req.params.id),me.account.id]);if(!job.rowCount)return res.status(404).json({error:'Job not found'});const current=job.rows[0];const allowed={requested:['provider_reviewing','cancelled'],provider_reviewing:['scheduled','cancelled'],accepted:['scheduled','in_progress','cancelled'],scheduled:['in_progress','cancelled'],in_progress:['completed','disputed'],quoted:['cancelled']}[current.status]||[];if(!allowed.includes(status))return res.status(409).json({error:`Cannot move job from ${current.status} to ${status}`});const finalPrice=status==='completed'?(numberOrNull(req.body?.final_price)??numberOrNull(current.quote_amount)):current.final_price;const{rows}=await pool.query(`UPDATE service_jobs SET status=$1,scheduled_at=CASE WHEN $1='scheduled' THEN COALESCE($2::timestamptz,scheduled_at) ELSE scheduled_at END,final_price=$3,provider_completed_at=CASE WHEN $1='completed' THEN NOW() ELSE provider_completed_at END,cancelled_at=CASE WHEN $1='cancelled' THEN NOW() ELSE cancelled_at END,cancellation_reason=CASE WHEN $1='cancelled' THEN $4 ELSE cancellation_reason END,updated_at=NOW() WHERE id=$5 RETURNING *`,[status,req.body?.scheduled_at||null,finalPrice,clean(req.body?.reason,500),current.id]);res.json(rows[0])}catch(e){next(e)}})
app.post('/api/services/jobs/:id/confirm-completion',body,async(req,res,next)=>{try{const me=await requireCustomer(req),id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE service_jobs SET customer_confirmed_at=COALESCE(customer_confirmed_at,NOW()),updated_at=NOW() WHERE id=$1 AND customer_account_id=$2 AND status='completed' RETURNING *`,[id,me.account.id]);if(!r.rowCount)throw Object.assign(new Error('Completed job not available for confirmation'),{status:409});const j=r.rows[0];await recordMonetizableCompletion(client,{serviceScope:'local_services',subjectType:'account',subjectId:j.provider_account_id,sourceType:'service_job',sourceId:j.id,completedAt:j.customer_confirmed_at,grossValue:j.final_price??j.quote_amount??0,currencyCode:j.currency_code||'PHP'});await client.query('COMMIT');res.json(j)}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/services/jobs/:id/review',body,async(req,res,next)=>{try{const me=await requireCustomer(req),jobId=Number(req.params.id);const j=await pool.query(`SELECT * FROM service_jobs WHERE id=$1 AND customer_account_id=$2 AND status='completed' AND customer_confirmed_at IS NOT NULL`,[jobId,me.account.id]);if(!j.rowCount)return res.status(409).json({error:'Review is available only after a completed, confirmed service job'});const vals=['workmanship','reliability','communication','professionalism','property_care','price_transparency','overall'].map(k=>Number(req.body?.[k]));if(vals.some(x=>!Number.isInteger(x)||x<1||x>5))return res.status(400).json({error:'Every rating must be from 1 to 5'});const{rows}=await pool.query(`INSERT INTO service_reviews(job_id,reviewer_account_id,provider_account_id,workmanship,reliability,communication,professionalism,property_care,price_transparency,overall,review_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(job_id) DO NOTHING RETURNING *`,[jobId,me.account.id,j.rows[0].provider_account_id,...vals,clean(req.body?.review_text,1200)]);if(!rows.length)return res.status(409).json({error:'This job has already been reviewed'});res.status(201).json(rows[0])}catch(e){next(e)}})

async function credentialReviewTarget(id){
  const {rows}=await pool.query(`
    SELECT pc.id,pc.account_id,pc.credential_type,pc.title,pc.verification_status,pc.rejection_reason,pc.verified_at,
      COALESCE(
        (SELECT pa.territory_id
           FROM profile_authorizations pa
          WHERE pa.account_id=pc.account_id AND pa.role='service_provider' AND pa.status='active' AND pa.territory_id IS NOT NULL
          ORDER BY pa.id DESC LIMIT 1),
        (SELECT app.territory_id
           FROM profile_applications app
          WHERE app.account_id=pc.account_id AND app.role='service_provider' AND app.status NOT IN ('rejected','revoked')
          ORDER BY app.id DESC LIMIT 1)
      ) target_territory_id
    FROM profile_credentials pc
    WHERE pc.id=$1
  `,[id]);
  return rows[0]||null;
}

app.patch('/api/admin/service-credentials/:id',body,async(req,res,next)=>{
  try{
    const me=await identity(req);
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Valid credential required'});
    const target=await credentialReviewTarget(id);
    if(!target)return res.status(404).json({error:'Credential not found'});
    const territoryId=Number(target.target_territory_id)||null;
    if(!territoryId)return res.status(409).json({error:'Service Provider territory must be established before credential review'});
    const assignment=await requireAdminPermission(pool,me.account.id,'credential.verify',territoryId);
    const status=clean(req.body?.verification_status,30);
    if(!['verified','rejected','expired'].includes(status))return res.status(400).json({error:'Choose verified, rejected or expired'});
    const rejectionReason=clean(req.body?.rejection_reason,500);
    const {rows}=await pool.query(`
      UPDATE profile_credentials
         SET verification_status=$1,
             verified_by_account_id=$2,
             verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,
             rejection_reason=$3,
             updated_at=NOW()
       WHERE id=$4
       RETURNING id,account_id,credential_type,title,verification_status,rejection_reason,verified_at
    `,[status,me.account.id,rejectionReason,id]);
    const after=rows[0];
    await appendAdminAudit(pool,{
      actorAccountId:me.account.id,
      assignmentId:assignment?.id||null,
      permission:'credential.verify',
      territoryId,
      targetType:'profile_credential',
      targetId:String(id),
      eventCode:'service_credential.reviewed',
      before:{
        id:target.id,account_id:target.account_id,credential_type:target.credential_type,title:target.title,
        verification_status:target.verification_status,rejection_reason:target.rejection_reason,verified_at:target.verified_at
      },
      after,
      reason:rejectionReason||status
    });
    res.json(after);
  }catch(e){next(e)}
})

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${internalMarketplacePort}`};const up=http.request({hostname:'127.0.0.1',port:internalMarketplacePort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Services upstream unavailable'})});req.pipe(up)}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})})
function start(){child=spawn(process.execPath,['server-marketplace.js'],{cwd:__dirname,env:{...process.env,PORT:String(internalMarketplacePort),INTERNAL_ORDERS_PORT:String(internalOrdersPort),INTERNAL_AUTH_PORT:String(internalAuthPort),INTERNAL_ACCOUNTING_PORT:String(internalAccountingPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Marketplace child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<100;i++){try{const r=await childFetch('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Marketplace child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life Local Services server listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
