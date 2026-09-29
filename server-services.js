import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';
import { requireAdminPermission,appendAdminAudit } from './admin-authorization.js';
import { marketplaceFetch,startEmbeddedMarketplace,stopEmbeddedMarketplace } from './server-marketplace.js';
import {decodeVerifiedDataUrl} from './file-signature-core.js';
import {
  bindPrivateEvidenceSource,deletePrivateEvidence,ensurePrivateEvidenceSchema,
  readPrivateEvidence,sendPrivateEvidence,storePrivateEvidence
} from './private-evidence-core.js';
import {accountsBlocked,blockAccount,ensureTrustSafetySchema,hasActiveBlock,listBlockedAccounts,unblockAccount} from './trust-safety-core.js';
import {enforceHighRiskVelocity,highRiskVelocityErrorBody} from './abuse-velocity-core.js';
import {accountGeographySnapshot} from './account-geography.js';
import {
  coarseServiceAreaFromGeography,
  ensureServiceLocationPrivacySchema,
  redactProviderServiceJob,
  requireProviderExactLocation
} from './service-location-privacy-core.js';
import {
  acceptedCompletionPrice,
  normalizeServicePriceOffer,
  normalizeServiceQuote,
  quoteIsExpired
} from './local-services-pricing-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const internalOrdersPort = Number(process.env.INTERNAL_ORDERS_PORT || 3307);
const internalAuthPort = Number(process.env.INTERNAL_AUTH_PORT || 3207);
const internalAccountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '2500kb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
let marketplaceApp;
let marketplaceReady=false;
let shuttingDown = false;
const PRIVATE_SERVICE_EVIDENCE_MIMES=new Set(['application/pdf','image/png','image/jpeg','image/webp']);
const MAX_PRIVATE_SERVICE_EVIDENCE_BYTES=1_400_000;

function clean(v,max=600){return String(v??'').trim().slice(0,max)}
function authHeader(req){return req.headers.authorization||''}
function numberOrNull(v){if(v===''||v==null)return null;const x=Number(v);return Number.isFinite(x)?x:null}
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||crypto.randomUUID(),120);
export function isServicesOwnedPath(path='',method='GET'){
  const pathname=String(path||'').split('?')[0];
  if(pathname==='/services.css'||pathname==='/services-ui.js')return true;
  if(pathname.startsWith('/api/services/'))return true;
  if(pathname.startsWith('/api/service-provider/'))return true;
  if(pathname==='/api/user-blocks'||pathname.startsWith('/api/user-blocks/'))return true;
  if(pathname.startsWith('/api/admin/service-credentials/'))return true;
  if(pathname.startsWith('/api/admin/service-providers/'))return true;
  return false;
}
export async function servicesFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  const method=String(options.method||'GET').toUpperCase();
  if(isServicesOwnedPath(pathname,method)){
    throw Object.assign(new Error('Local Services-owned paths require in-process Local Services dispatch'),{
      status:500,code:'LOCAL_SERVICES_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const marketplace=await marketplaceFetch('/health',{headers:options.headers||{}});
      const ok=marketplaceReady&&marketplace.ok;
      return new Response(JSON.stringify({ok,db:true,marketplace:ok,version:'0.8.1-services'}),{
        status:ok?200:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,marketplace:false,version:'0.8.1-services'}),{
        status:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  if(pathname==='/'||pathname==='/index.html'){
    const r=await marketplaceFetch(path,options);
    let html=await r.text();
    html=html.replace('</head>','  <link rel="stylesheet" href="/services.css" />\n</head>')
      .replace('</body>','  <script type="module" src="/services-ui.js"></script>\n</body>');
    return new Response(html,{status:r.status,headers:{'content-type':'text/html; charset=utf-8'}});
  }
  return marketplaceFetch(path,options);
}
async function identity(req){const r=await servicesFetch('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
async function requireProvider(req){const me=await identity(req);if(!enabled(me,'service_provider'))throw Object.assign(new Error('Service Provider profile required'),{status:403});return me}
async function requireCustomer(req){const me=await identity(req);if(!enabled(me,'customer'))throw Object.assign(new Error('Customer profile required'),{status:403});return me}
function validateImage(data){const x=String(data||'');if(!x)return '';if(x.length>450_000)throw Object.assign(new Error('Image is too large'),{status:413});if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x))throw Object.assign(new Error('Image must be PNG, JPEG or WebP'),{status:400});decodeVerifiedDataUrl(x,{allowedMimes:['image/png','image/jpeg','image/webp'],label:'Image'});return x}

async function initDb(){await ensureMonetizationSchema(pool);await ensureTrustSafetySchema(pool);await ensurePrivateEvidenceSchema(pool);await pool.query(`
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS profile_image_data_url TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS languages TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS availability_text TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS pricing_model TEXT NOT NULL DEFAULT 'quotation';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS price_from NUMERIC(12,2);
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS price_to NUMERIC(12,2);
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS same_day_available BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_public_summary TEXT NOT NULL DEFAULT '';
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_private_data_url TEXT;
  ALTER TABLE service_provider_profiles ALTER COLUMN cv_private_data_url DROP NOT NULL;
  ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

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
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS pricing_method TEXT NOT NULL DEFAULT 'quotation';
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS rate_unit TEXT NOT NULL DEFAULT 'job';
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS price_from NUMERIC(12,2);
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS price_to NUMERIC(12,2);
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS minimum_charge NUMERIC(12,2);
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS callout_fee NUMERIC(12,2);
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS materials_policy TEXT NOT NULL DEFAULT 'separate';
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS service_mode TEXT NOT NULL DEFAULT 'at_customer';
  ALTER TABLE service_provider_services ADD COLUMN IF NOT EXISTS pricing_note TEXT NOT NULL DEFAULT '';
  CREATE TABLE IF NOT EXISTS profile_credentials (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL,
    title TEXT NOT NULL,
    issuing_body TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    issue_date DATE,
    expiry_date DATE,
    evidence_data_url TEXT,
    private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id),
    verification_status TEXT NOT NULL DEFAULT 'submitted',
    verified_by_account_id BIGINT REFERENCES accounts(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (credential_type IN ('prc_license','tesda_nc_coc','diploma_vocational','training_certificate','experience_certificate','other')),
    CHECK (verification_status IN ('unverified','submitted','verified','rejected','expired'))
  );
  ALTER TABLE profile_credentials ALTER COLUMN evidence_data_url DROP NOT NULL;
  ALTER TABLE profile_credentials ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);
  CREATE INDEX IF NOT EXISTS profile_credentials_account_idx ON profile_credentials(account_id,verification_status);
  CREATE INDEX IF NOT EXISTS profile_credentials_private_evidence_idx ON profile_credentials(private_evidence_object_id);
  CREATE INDEX IF NOT EXISTS service_provider_cv_private_evidence_idx ON service_provider_profiles(cv_private_evidence_object_id);

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
    coarse_location TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS service_job_quotes (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    job_id BIGINT NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    quote_kind TEXT NOT NULL,
    quote_phase TEXT NOT NULL,
    parent_quote_id BIGINT REFERENCES service_job_quotes(id),
    status TEXT NOT NULL DEFAULT 'sent',
    scope_summary TEXT NOT NULL,
    materials_policy TEXT NOT NULL DEFAULT 'separate',
    currency_code TEXT NOT NULL DEFAULT 'PHP',
    labor_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    materials_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    callout_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    travel_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL,
    estimated_duration_value NUMERIC(12,3),
    estimated_duration_unit TEXT,
    valid_until TIMESTAMPTZ NOT NULL,
    inclusions TEXT NOT NULL DEFAULT '',
    exclusions TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    created_by_provider_account_id BIGINT NOT NULL REFERENCES accounts(id),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    accepted_by_customer_account_id BIGINT REFERENCES accounts(id),
    legacy_record BOOLEAN NOT NULL DEFAULT FALSE,
    approval_evidence_status TEXT NOT NULL DEFAULT 'explicit_v2',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id,version_no),
    CHECK (quote_kind IN ('fixed_quote','estimate','inspection','change_order')),
    CHECK (quote_phase IN ('initial','change_order')),
    CHECK (status IN ('sent','accepted','superseded','withdrawn','declined','changes_requested','expired')),
    CHECK (materials_policy IN ('included','separate','customer_supplied','mixed')),
    CHECK (total_amount>=0)
  );
  CREATE INDEX IF NOT EXISTS service_job_quotes_job_idx ON service_job_quotes(job_id,version_no DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS service_job_quotes_one_sent_phase_idx ON service_job_quotes(job_id,quote_phase) WHERE status='sent';

  CREATE TABLE IF NOT EXISTS service_job_quote_items (
    id BIGSERIAL PRIMARY KEY,
    quote_id BIGINT NOT NULL REFERENCES service_job_quotes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    item_kind TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    unit_code TEXT NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(quote_id,position),
    CHECK (item_kind IN ('labor','materials','callout','travel','other')),
    CHECK (unit_code IN ('job','hour','half_day','day','sqm','item','unit','visit')),
    CHECK (quantity>0),
    CHECK (unit_price>=0),
    CHECK (subtotal>=0)
  );

  CREATE TABLE IF NOT EXISTS service_job_quote_events (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
    quote_id BIGINT NOT NULL REFERENCES service_job_quotes(id) ON DELETE CASCADE,
    actor_account_id BIGINT NOT NULL REFERENCES accounts(id),
    event_code TEXT NOT NULL,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS service_job_quote_events_job_idx ON service_job_quote_events(job_id,created_at DESC);

  ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS accepted_quote_id BIGINT REFERENCES service_job_quotes(id);
  ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS agreed_total NUMERIC(12,2);
  ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS pricing_locked_at TIMESTAMPTZ;
  ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS legacy_final_adjustment NUMERIC(12,2);

  INSERT INTO service_job_quotes(
    job_id,version_no,quote_kind,quote_phase,status,scope_summary,materials_policy,currency_code,
    labor_amount,total_amount,valid_until,created_by_provider_account_id,sent_at,accepted_at,
    accepted_by_customer_account_id,legacy_record,approval_evidence_status,created_at,updated_at
  )
  SELECT j.id,1,'fixed_quote','initial',
         CASE WHEN j.status='quoted' THEN 'sent'
              WHEN j.status IN ('accepted','scheduled','in_progress','completed','disputed') THEN 'accepted'
              ELSE 'superseded' END,
         COALESCE(NULLIF(BTRIM(j.quote_note),''),j.description),'separate',COALESCE(j.currency_code,'PHP'),
         j.quote_amount,j.quote_amount,j.created_at+INTERVAL '100 years',j.provider_account_id,j.updated_at,
         CASE WHEN j.status IN ('accepted','scheduled','in_progress','completed','disputed') THEN j.updated_at END,
         CASE WHEN j.status IN ('accepted','scheduled','in_progress','completed','disputed') THEN j.customer_account_id END,
         TRUE,
         CASE WHEN j.status IN ('accepted','scheduled','in_progress','completed','disputed') THEN 'legacy_job_state' ELSE 'unknown_legacy' END,
         j.created_at,j.updated_at
    FROM service_jobs j
   WHERE j.quote_amount IS NOT NULL
     AND j.quote_amount>=0
     AND NOT EXISTS(SELECT 1 FROM service_job_quotes q WHERE q.job_id=j.id)
  ON CONFLICT(job_id,version_no) DO NOTHING;

  INSERT INTO service_job_quote_items(quote_id,position,item_kind,description,quantity,unit_code,unit_price,subtotal)
  SELECT q.id,1,'labor',q.scope_summary,1,'job',q.total_amount,q.total_amount
    FROM service_job_quotes q
   WHERE q.legacy_record=TRUE
     AND NOT EXISTS(SELECT 1 FROM service_job_quote_items i WHERE i.quote_id=q.id)
  ON CONFLICT(quote_id,position) DO NOTHING;

  UPDATE service_jobs j
     SET accepted_quote_id=q.id,
         agreed_total=q.total_amount,
         pricing_locked_at=COALESCE(q.accepted_at,q.sent_at),
         legacy_final_adjustment=CASE WHEN j.final_price IS NOT NULL AND j.final_price<>q.total_amount THEN j.final_price-q.total_amount ELSE NULL END
    FROM service_job_quotes q
   WHERE q.job_id=j.id AND q.status='accepted' AND j.accepted_quote_id IS NULL;

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
`);await ensureServiceLocationPrivacySchema(pool)}

async function rating(accountId){const r=await pool.query(`SELECT COUNT(*)::int review_count,ROUND(AVG(overall)::numeric,2) rating FROM service_reviews WHERE provider_account_id=$1 AND moderation_status='published'`,[accountId]);return{review_count:Number(r.rows[0]?.review_count||0),rating:r.rows[0]?.rating==null?null:Number(r.rows[0].rating)}}
const serviceOfferSelect=`s.category_id,c.code,c.name,c.credential_gate,s.service_label,s.active,
  s.pricing_method,s.rate_unit,s.price_from,s.price_to,s.minimum_charge,s.callout_fee,
  s.materials_policy,s.service_mode,s.pricing_note`;
async function publicProvider(accountId){const q=await pool.query(`SELECT a.id account_id,a.display_name,p.professional_headline,p.about,p.service_area,p.years_experience,p.languages,p.availability_text,p.pricing_model,p.price_from,p.price_to,p.same_day_available,p.public_reputation_enabled,p.profile_image_data_url,pr.visibility FROM accounts a JOIN service_provider_profiles p ON p.account_id=a.id JOIN profiles pr ON pr.account_id=a.id AND pr.role='service_provider' AND pr.enabled=TRUE WHERE a.id=$1 AND pr.visibility='public'`,[accountId]);if(!q.rowCount)return null;const [services,credentials,portfolio,rate]=await Promise.all([pool.query(`SELECT ${serviceOfferSelect} FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.active=TRUE ORDER BY c.sort_order,c.name,s.service_label`,[accountId]),pool.query(`SELECT credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status FROM profile_credentials WHERE account_id=$1 AND verification_status IN ('verified','submitted','unverified','expired') ORDER BY verification_status='verified' DESC,created_at DESC`,[accountId]),pool.query(`SELECT p.id,p.title,p.description,p.image_data_url,p.approximate_date,p.linked_job_id,c.name category FROM service_portfolio p LEFT JOIN service_categories c ON c.id=p.category_id WHERE p.account_id=$1 AND (p.linked_job_id IS NULL OR p.customer_publication_consent=TRUE) ORDER BY p.created_at DESC LIMIT 20`,[accountId]),rating(accountId)]);const base=q.rows[0];return{...base,services:services.rows,credentials:credentials.rows,portfolio:portfolio.rows,...(base.public_reputation_enabled?rate:{rating:null,review_count:0})}}
async function privateProfile(accountId){const p=await pool.query(`
  SELECT account_id,display_name,professional_headline,about,service_area,years_experience,
         public_reputation_enabled,profile_image_data_url,languages,availability_text,pricing_model,
         price_from,price_to,same_day_available,cv_public_summary,
         (cv_private_evidence_object_id IS NOT NULL OR NULLIF(cv_private_data_url,'') IS NOT NULL) has_private_cv,
         updated_at
    FROM service_provider_profiles WHERE account_id=$1
`,[accountId]);const [services,credentials,portfolio,rate,reviews]=await Promise.all([pool.query(`SELECT ${serviceOfferSelect} FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 ORDER BY c.sort_order,c.name`,[accountId]),pool.query(`SELECT id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at FROM profile_credentials WHERE account_id=$1 ORDER BY created_at DESC`,[accountId]),pool.query(`SELECT p.*,c.name category FROM service_portfolio p LEFT JOIN service_categories c ON c.id=p.category_id WHERE p.account_id=$1 ORDER BY p.created_at DESC`,[accountId]),rating(accountId),pool.query(`SELECT r.id,r.job_id,r.overall,r.workmanship,r.reliability,r.communication,r.professionalism,r.property_care,r.price_transparency,r.review_text,r.created_at,a.display_name reviewer_name,j.service_label FROM service_reviews r JOIN accounts a ON a.id=r.reviewer_account_id JOIN service_jobs j ON j.id=r.job_id WHERE r.provider_account_id=$1 AND r.moderation_status='published' ORDER BY r.created_at DESC LIMIT 50`,[accountId])]);return{profile:p.rows[0]||null,services:services.rows,credentials:credentials.rows,portfolio:portfolio.rows,reviews:reviews.rows,...rate}}
async function privateProfileHome(accountId){
  const [profile,services]=await Promise.all([
    pool.query(`SELECT account_id,display_name,professional_headline,service_area,availability_text,pricing_model,price_from,price_to,same_day_available,public_reputation_enabled,updated_at FROM service_provider_profiles WHERE account_id=$1`,[accountId]),
    pool.query(`SELECT ${serviceOfferSelect} FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.active=TRUE ORDER BY c.sort_order,c.name LIMIT 40`,[accountId])
  ]);
  return{detail_mode:'home',profile:profile.rows[0]||null,services:services.rows};
}

async function quoteWithItems(db,quoteId){
  const quote=await db.query(`SELECT * FROM service_job_quotes WHERE id=$1`,[quoteId]);
  if(!quote.rowCount)return null;
  const items=await db.query(`SELECT id,position,item_kind,description,quantity,unit_code,unit_price,subtotal FROM service_job_quote_items WHERE quote_id=$1 ORDER BY position`,[quoteId]);
  return{...quote.rows[0],line_items:items.rows};
}

async function pricingForJobs(db,jobs){
  const rows=Array.isArray(jobs)?jobs:[];
  const ids=[...new Set(rows.map(row=>Number(row.id)).filter(Number.isInteger))];
  if(!ids.length)return rows;
  const quotes=await db.query(`
    SELECT q.*,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id',i.id,'position',i.position,'item_kind',i.item_kind,'description',i.description,
                 'quantity',i.quantity,'unit_code',i.unit_code,'unit_price',i.unit_price,'subtotal',i.subtotal
               ) ORDER BY i.position
             ) FILTER(WHERE i.id IS NOT NULL),
             '[]'::jsonb
           ) line_items
      FROM service_job_quotes q
      LEFT JOIN service_job_quote_items i ON i.quote_id=q.id
     WHERE q.job_id=ANY($1::bigint[])
       AND q.status IN ('sent','accepted','declined','changes_requested')
     GROUP BY q.id
     ORDER BY q.job_id,q.version_no
  `,[ids]);
  const grouped=new Map();
  for(const quote of quotes.rows){
    const key=Number(quote.job_id),entry=grouped.get(key)||{accepted_quote:null,current_quote:null,pending_change:null};
    if(quote.status==='accepted')entry.accepted_quote=quote;
    if(quote.status==='sent'&&quote.quote_phase==='initial')entry.current_quote=quote;
    if(quote.status==='sent'&&quote.quote_phase==='change_order')entry.pending_change=quote;
    grouped.set(key,entry);
  }
  return rows.map(row=>({...row,pricing:grouped.get(Number(row.id))||{accepted_quote:null,current_quote:null,pending_change:null}}));
}

async function createServiceQuote(db,{job,providerAccountId,input}){
  const quote=normalizeServiceQuote(input);
  const initial=quote.quote_phase==='initial';
  const allowedInitial=['requested','provider_reviewing','quoted'];
  const allowedChange=['accepted','scheduled','in_progress'];
  if(initial&&!allowedInitial.includes(job.status))throw Object.assign(new Error('Initial quote cannot be sent from the current job state'),{status:409});
  if(!initial&&!allowedChange.includes(job.status))throw Object.assign(new Error('A change order is available only for accepted or active work'),{status:409});
  if(!initial&&!job.accepted_quote_id)throw Object.assign(new Error('A Customer-accepted quote is required before a change order'),{status:409});
  await db.query(`UPDATE service_job_quotes SET status='superseded',updated_at=NOW() WHERE job_id=$1 AND quote_phase=$2 AND status='sent'`,[job.id,quote.quote_phase]);
  const version=await db.query(`SELECT COALESCE(MAX(version_no),0)+1 version_no FROM service_job_quotes WHERE job_id=$1`,[job.id]);
  const inserted=await db.query(`
    INSERT INTO service_job_quotes(
      job_id,version_no,quote_kind,quote_phase,parent_quote_id,status,scope_summary,materials_policy,currency_code,
      labor_amount,materials_amount,callout_amount,travel_amount,other_amount,total_amount,
      estimated_duration_value,estimated_duration_unit,valid_until,inclusions,exclusions,terms,created_by_provider_account_id
    ) VALUES($1,$2,$3,$4,$5,'sent',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    RETURNING *
  `,[job.id,Number(version.rows[0].version_no),quote.quote_kind,quote.quote_phase,initial?null:job.accepted_quote_id,quote.scope_summary,quote.materials_policy,quote.currency_code,quote.labor_amount,quote.materials_amount,quote.callout_amount,quote.travel_amount,quote.other_amount,quote.total_amount,quote.estimated_duration_value,quote.estimated_duration_unit,quote.valid_until,quote.inclusions,quote.exclusions,quote.terms,providerAccountId]);
  const row=inserted.rows[0];
  for(const [position,item] of quote.line_items.entries())await db.query(`
    INSERT INTO service_job_quote_items(quote_id,position,item_kind,description,quantity,unit_code,unit_price,subtotal)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  `,[row.id,position+1,item.item_kind,item.description,item.quantity,item.unit_code,item.unit_price,item.subtotal]);
  await db.query(`INSERT INTO service_job_quote_events(job_id,quote_id,actor_account_id,event_code,detail_json) VALUES($1,$2,$3,'quote_sent',$4::jsonb)`,[job.id,row.id,providerAccountId,JSON.stringify({version_no:row.version_no,quote_phase:row.quote_phase,total_amount:Number(row.total_amount)})]);
  if(initial)await db.query(`UPDATE service_jobs SET status='quoted',quote_amount=$1,quote_note=$2,updated_at=NOW() WHERE id=$3`,[row.total_amount,row.scope_summary,job.id]);
  return quoteWithItems(db,row.id);
}

async function respondToServiceQuote(db,{job,quote,customerAccountId,action,note=''}){
  if(quote.status!=='sent')throw Object.assign(new Error('This quote version is no longer available'),{status:409,code:'SERVICE_QUOTE_STALE'});
  if(quoteIsExpired(quote)){
    await db.query(`UPDATE service_job_quotes SET status='expired',updated_at=NOW() WHERE id=$1 AND status='sent'`,[quote.id]);
    if(quote.quote_phase==='initial')await db.query(`UPDATE service_jobs SET status='provider_reviewing',quote_amount=NULL,quote_note='',updated_at=NOW() WHERE id=$1 AND status='quoted'`,[job.id]);
    await db.query(`INSERT INTO service_job_quote_events(job_id,quote_id,actor_account_id,event_code,detail_json) VALUES($1,$2,$3,'quote_expired',$4::jsonb)`,[job.id,quote.id,customerAccountId,JSON.stringify({version_no:quote.version_no})]);
    return{expired:true};
  }
  if(!['accept','decline','request_changes'].includes(action))throw Object.assign(new Error('Choose accept, decline or request changes'),{status:400});
  if(quote.quote_phase==='initial'&&job.status!=='quoted')throw Object.assign(new Error('Initial quote cannot be answered from the current job state'),{status:409});
  if(quote.quote_phase==='change_order'&&!['accepted','scheduled','in_progress'].includes(job.status))throw Object.assign(new Error('Change order cannot be answered from the current job state'),{status:409});
  if(action==='accept'){
    await db.query(`UPDATE service_job_quotes SET status='superseded',updated_at=NOW() WHERE job_id=$1 AND status='accepted'`,[job.id]);
    await db.query(`UPDATE service_job_quotes SET status='accepted',accepted_at=NOW(),accepted_by_customer_account_id=$1,updated_at=NOW() WHERE id=$2`,[customerAccountId,quote.id]);
    await db.query(`
      UPDATE service_jobs
         SET status=CASE WHEN $1='initial' THEN 'accepted' ELSE status END,
             accepted_quote_id=$2,agreed_total=$3,pricing_locked_at=NOW(),
             quote_amount=$3,quote_note=$4,updated_at=NOW()
       WHERE id=$5
    `,[quote.quote_phase,quote.id,quote.total_amount,quote.scope_summary,job.id]);
    await db.query(`INSERT INTO service_job_quote_events(job_id,quote_id,actor_account_id,event_code,detail_json) VALUES($1,$2,$3,'quote_accepted',$4::jsonb)`,[job.id,quote.id,customerAccountId,JSON.stringify({version_no:quote.version_no,quote_phase:quote.quote_phase,total_amount:Number(quote.total_amount)})]);
    return{accepted:true};
  }
  const nextStatus=action==='decline'?'declined':'changes_requested';
  await db.query(`UPDATE service_job_quotes SET status=$1,updated_at=NOW() WHERE id=$2`,[nextStatus,quote.id]);
  if(quote.quote_phase==='initial')await db.query(`UPDATE service_jobs SET status='provider_reviewing',quote_amount=NULL,quote_note='',updated_at=NOW() WHERE id=$1`,[job.id]);
  await db.query(`INSERT INTO service_job_quote_events(job_id,quote_id,actor_account_id,event_code,detail_json) VALUES($1,$2,$3,$4,$5::jsonb)`,[job.id,quote.id,customerAccountId,action==='decline'?'quote_declined':'quote_changes_requested',JSON.stringify({version_no:quote.version_no,note:clean(note,500)})]);
  return{accepted:false,status:nextStatus};
}

app.get('/health',async(req,res)=>{const r=await servicesFetch('/health',{headers:req.headers});const payload=await r.json().catch(()=>({ok:false,db:false,marketplace:false,version:'0.8.1-services'}));res.status(r.status).json(payload)})
app.get('/services.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','services.css'),'utf8')))
app.get('/services-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','services-ui.js'),'utf8')))
async function root(req,res){const r=await servicesFetch(req.path,{headers:req.headers});res.status(r.status).type('html').send(await r.text())}
app.get('/',root);app.get('/index.html',root)

app.get('/api/services/categories',async(req,res,next)=>{try{await identity(req);const{rows}=await pool.query(`SELECT id,code,name,credential_gate FROM service_categories WHERE active=TRUE ORDER BY sort_order,name`);res.json(rows)}catch(e){next(e)}})
app.get('/api/user-blocks',async(req,res,next)=>{try{const me=await identity(req);res.json(await listBlockedAccounts(pool,me.account.id,'local_services'))}catch(e){next(e)}})
app.get('/api/user-blocks/:accountId/status',async(req,res,next)=>{try{const me=await identity(req),targetId=Number(req.params.accountId);res.json({blocked_by_me:await hasActiveBlock(pool,{blockerAccountId:me.account.id,blockedAccountId:targetId,blockScope:'local_services'}),scope:'local_services'})}catch(e){next(e)}})
app.post('/api/user-blocks',body,async(req,res,next)=>{try{const me=await identity(req);res.json(await blockAccount(pool,{blockerAccountId:me.account.id,blockedAccountId:req.body?.blocked_account_id,reasonCategory:req.body?.reason_category,blockScope:'local_services'}))}catch(e){next(e)}})
app.delete('/api/user-blocks/:accountId',async(req,res,next)=>{try{const me=await identity(req);res.json(await unblockAccount(pool,{blockerAccountId:me.account.id,blockedAccountId:req.params.accountId,blockScope:'local_services'}))}catch(e){next(e)}})
app.get('/api/services/providers',async(req,res,next)=>{try{await requireCustomer(req);const category=clean(req.query.category,80);const args=[];let clause='';if(category){args.push(category);clause=` AND EXISTS(SELECT 1 FROM service_provider_services ss JOIN service_categories c ON c.id=ss.category_id WHERE ss.account_id=a.id AND ss.active=TRUE AND c.code=$1)`}const{rows}=await pool.query(`SELECT a.id account_id,a.display_name,p.professional_headline,p.about,p.service_area,p.years_experience,p.languages,p.availability_text,p.pricing_model,p.price_from,p.price_to,p.same_day_available,p.public_reputation_enabled,p.profile_image_data_url FROM accounts a JOIN service_provider_profiles p ON p.account_id=a.id JOIN profiles pr ON pr.account_id=a.id AND pr.role='service_provider' AND pr.enabled=TRUE AND pr.visibility='public' WHERE 1=1${clause} ORDER BY p.same_day_available DESC,a.display_name`,args);const out=[];for(const row of rows){const svc=await pool.query(`SELECT c.code,c.name,s.service_label,s.pricing_method,s.rate_unit,s.price_from,s.price_to,s.minimum_charge,s.callout_fee,s.materials_policy,s.service_mode,s.pricing_note FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.active=TRUE ORDER BY c.sort_order LIMIT 8`,[row.account_id]);const cred=await pool.query(`SELECT title,credential_type FROM profile_credentials WHERE account_id=$1 AND verification_status='verified' ORDER BY created_at DESC LIMIT 3`,[row.account_id]);const rate=row.public_reputation_enabled?await rating(row.account_id):{rating:null,review_count:0};out.push({...row,services:svc.rows,verified_credentials:cred.rows,...rate})}res.json(out)}catch(e){next(e)}})
app.get('/api/services/providers/:accountId',async(req,res,next)=>{try{await requireCustomer(req);const p=await publicProvider(Number(req.params.accountId));if(!p)return res.status(404).json({error:'Public Service Provider profile not found'});res.json(p)}catch(e){next(e)}})

app.get('/api/service-provider/me',async(req,res,next)=>{try{const me=await requireProvider(req);if(String(req.query.view||'')==='home')return res.json(await privateProfileHome(Number(me.account.id)));res.json(await privateProfile(Number(me.account.id)))}catch(e){next(e)}})
app.put('/api/service-provider/me',body,async(req,res,next)=>{
  let storedCv=null,me=null,previousCvObjectId=null;
  try{
    me=await requireProvider(req);
    const id=Number(me.account.id),image=req.body?.profile_image_data_url===undefined?null:validateImage(req.body.profile_image_data_url);
    const priceFrom=numberOrNull(req.body?.price_from),priceTo=numberOrNull(req.body?.price_to);
    if((priceFrom!=null&&priceFrom<0)||(priceTo!=null&&priceTo<0)||(priceFrom!=null&&priceTo!=null&&priceTo<priceFrom))return res.status(400).json({error:'Profile price range is invalid'});
    if(image!==null)await enforceHighRiskVelocity(pool,{actorAccountId:id,actionCode:'upload_public',subjectType:'service_provider_profile',subjectId:id});
    const cvData=req.body?.cv_private_data_url,hasCvUpload=cvData!==undefined&&String(cvData||'').trim()!=='';
    if(hasCvUpload){
      const fileName=clean(req.body?.cv_file_name,220);
      if(!fileName)return res.status(400).json({error:'CV filename is required'});
      await enforceHighRiskVelocity(pool,{actorAccountId:id,actionCode:'upload_private',subjectType:'service_provider_cv',subjectId:id});
      const prior=await pool.query('SELECT cv_private_evidence_object_id FROM service_provider_profiles WHERE account_id=$1',[id]);
      previousCvObjectId=Number(prior.rows[0]?.cv_private_evidence_object_id)||null;
      storedCv=await storePrivateEvidence(pool,{
        dataUrl:cvData,fileName,allowedMimes:[...PRIVATE_SERVICE_EVIDENCE_MIMES],
        maxBytes:MAX_PRIVATE_SERVICE_EVIDENCE_BYTES,ownerAccountId:id,actorAccountId:id,
        sourceType:'service_provider_cv',sourceId:String(id),purpose:'service_provider_cv_upload',
        classification:'service_provider_cv',correlationId:correlation(req)
      });
    }
    await pool.query(`
      UPDATE service_provider_profiles
         SET display_name=$1,professional_headline=$2,about=$3,service_area=$4,years_experience=$5,
             languages=$6,availability_text=$7,pricing_model=$8,price_from=$9,price_to=$10,
             same_day_available=$11,public_reputation_enabled=$12,
             profile_image_data_url=COALESCE($13,profile_image_data_url),cv_public_summary=$14,updated_at=NOW()
       WHERE account_id=$15
    `,[
      clean(req.body?.display_name,120)||me.account.display_name,clean(req.body?.professional_headline,160),
      clean(req.body?.about,1800),clean(req.body?.service_area,300),numberOrNull(req.body?.years_experience),
      clean(req.body?.languages,300),clean(req.body?.availability_text,500),
      ['quotation','fixed','hourly','daily','mixed'].includes(req.body?.pricing_model)?req.body.pricing_model:'quotation',
      priceFrom,priceTo,Boolean(req.body?.same_day_available),Boolean(req.body?.public_reputation_enabled),
      image,clean(req.body?.cv_public_summary,1600),id
    ]);
    if(storedCv){
      await pool.query(`
        UPDATE service_provider_profiles
           SET cv_private_data_url=NULL,cv_private_evidence_object_id=$1,updated_at=NOW()
         WHERE account_id=$2
      `,[storedCv.id,id]);
      if(previousCvObjectId&&previousCvObjectId!==Number(storedCv.id)){
        await deletePrivateEvidence(pool,{objectId:previousCvObjectId,actorAccountId:id,purpose:'service_provider_cv_replaced',correlationId:correlation(req)}).catch(()=>{});
      }
    }
    if(req.body?.visibility){const vis=['public','relationship_only','private'].includes(req.body.visibility)?req.body.visibility:'private';await pool.query(`UPDATE profiles SET visibility=$1,updated_at=NOW() WHERE account_id=$2 AND role='service_provider'`,[vis,id])}
    res.json(await privateProfile(id));
  }catch(e){
    if(storedCv?.id)await deletePrivateEvidence(pool,{objectId:storedCv.id,actorAccountId:me?.account?.id,purpose:'service_provider_cv_rollback',correlationId:correlation(req)}).catch(()=>{});
    next(e);
  }
})
app.put('/api/service-provider/services',body,async(req,res,next)=>{try{const me=await requireProvider(req),id=Number(me.account.id),selections=Array.isArray(req.body?.services)?req.body.services:[];const client=await pool.connect();try{await client.query('BEGIN');await client.query(`DELETE FROM service_provider_services WHERE account_id=$1`,[id]);for(const selection of selections.slice(0,80)){const categoryId=Number(selection.category_id);if(!Number.isInteger(categoryId))continue;const category=await client.query(`SELECT id,name FROM service_categories WHERE id=$1 AND active=TRUE`,[categoryId]);if(!category.rowCount)throw Object.assign(new Error('Choose an active Local Services category'),{status:400});const offer=normalizeServicePriceOffer(selection);await client.query(`INSERT INTO service_provider_services(account_id,category_id,service_label,active,pricing_method,rate_unit,price_from,price_to,minimum_charge,callout_fee,materials_policy,service_mode,pricing_note) VALUES($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,categoryId,clean(selection.service_label,120)||category.rows[0].name,offer.pricing_method,offer.rate_unit,offer.price_from,offer.price_to,offer.minimum_charge,offer.callout_fee,offer.materials_policy,offer.service_mode,offer.pricing_note])}await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}res.json(await privateProfile(id))}catch(e){next(e)}})
app.post('/api/service-provider/credentials',body,async(req,res,next)=>{
  let stored=null,me=null;
  try{
    me=await requireProvider(req);
    const type=clean(req.body?.credential_type,60),fileName=clean(req.body?.evidence_file_name,220);
    if(!['prc_license','tesda_nc_coc','diploma_vocational','training_certificate','experience_certificate','other'].includes(type))return res.status(400).json({error:'Choose a credential type'});
    if(!clean(req.body?.title,200))return res.status(400).json({error:'Credential title is required'});
    if(!req.body?.evidence_data_url||!fileName)return res.status(400).json({error:'Credential evidence and filename are required'});
    await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'upload_private',subjectType:'service_credential',subjectId:me.account.id});
    stored=await storePrivateEvidence(pool,{
      dataUrl:req.body.evidence_data_url,fileName,allowedMimes:[...PRIVATE_SERVICE_EVIDENCE_MIMES],
      maxBytes:MAX_PRIVATE_SERVICE_EVIDENCE_BYTES,ownerAccountId:me.account.id,actorAccountId:me.account.id,
      sourceType:'service_credential',sourceId:`pending:${me.account.id}`,
      purpose:'service_credential_upload',classification:'service_credential',correlationId:correlation(req)
    });
    const{rows}=await pool.query(`
      INSERT INTO profile_credentials(
        account_id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,
        evidence_data_url,private_evidence_object_id,verification_status
      ) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,'submitted')
      RETURNING id,credential_type,title,issuing_body,reference_number,issue_date,expiry_date,verification_status,created_at
    `,[
      me.account.id,type,clean(req.body.title,200),clean(req.body?.issuing_body,200),
      clean(req.body?.reference_number,120),req.body?.issue_date||null,req.body?.expiry_date||null,stored.id
    ]);
    await bindPrivateEvidenceSource(pool,{
      objectId:stored.id,sourceType:'service_credential',sourceId:String(rows[0].id),
      actorAccountId:me.account.id,purpose:'service_credential_bind',correlationId:correlation(req)
    });
    res.status(201).json(rows[0]);
  }catch(e){
    if(stored?.id)await deletePrivateEvidence(pool,{objectId:stored.id,actorAccountId:me?.account?.id,purpose:'service_credential_rollback',correlationId:correlation(req)}).catch(()=>{});
    next(e);
  }
})
app.post('/api/service-provider/portfolio',body,async(req,res,next)=>{try{const me=await requireProvider(req);const image=validateImage(req.body?.image_data_url);if(!image||!clean(req.body?.title,160))return res.status(400).json({error:'Portfolio title and image are required'});await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'upload_public',subjectType:'service_portfolio',subjectId:me.account.id});const{rows}=await pool.query(`INSERT INTO service_portfolio(account_id,title,description,category_id,image_data_url,approximate_date,customer_publication_consent) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[me.account.id,clean(req.body.title,160),clean(req.body?.description,800),req.body?.category_id?Number(req.body.category_id):null,image,req.body?.approximate_date||null,Boolean(req.body?.customer_publication_consent)]);res.status(201).json(rows[0])}catch(e){next(e)}})

app.post('/api/services/jobs',body,async(req,res,next)=>{try{
  const me=await requireCustomer(req),providerId=Number(req.body?.provider_account_id),categoryId=Number(req.body?.category_id),requestedLabel=clean(req.body?.service_label,120);
  if(providerId===Number(me.account.id))return res.status(409).json({error:'You cannot request your own service'});
  const provider=await publicProvider(providerId);
  if(!provider)return res.status(404).json({error:'Service Provider is not available'});
  if(await accountsBlocked(pool,me.account.id,providerId,'local_services'))return res.status(409).json({error:'New Local Services requests are unavailable between these accounts. Existing jobs and history remain available.'});
  if(!Number.isInteger(categoryId))return res.status(400).json({error:'Choose a service offered by this Provider'});
  const offered=await pool.query(`SELECT s.service_label,c.name FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 AND s.category_id=$2 AND s.active=TRUE AND c.active=TRUE AND ($3='' OR s.service_label=$3) ORDER BY s.service_label LIMIT 1`,[providerId,categoryId,requestedLabel]);
  if(!offered.rowCount)return res.status(409).json({error:'This Service Provider does not currently offer the selected service'});
  const description=clean(req.body?.description,1500),exactLocation=clean(req.body?.service_location,400);
  if(!description)return res.status(400).json({error:'Describe the work you need'});
  if(!exactLocation)return res.status(400).json({error:'Enter the exact service address. It stays private until you accept a quote.'});
  const geography=await accountGeographySnapshot(pool,me.account.id);
  const coarseLocation=coarseServiceAreaFromGeography(geography,{companyTest:me.account.account_mode==='company_test'});
  await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'service_job_create',subjectType:'service_provider',subjectId:providerId});
  const{rows}=await pool.query(`
    INSERT INTO service_jobs(
      customer_account_id,provider_account_id,category_id,service_label,description,
      service_location,coarse_location,requested_window,status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'requested') RETURNING *
  `,[me.account.id,providerId,categoryId,clean(offered.rows[0].service_label,120)||clean(offered.rows[0].name,120),description,exactLocation,coarseLocation,clean(req.body?.requested_window,300)]);
  res.status(201).json(rows[0]);
}catch(e){next(e)}})
app.get('/api/services/jobs/mine',async(req,res,next)=>{try{
  const me=await identity(req),id=Number(me.account.id);
  if(String(req.query.view||'')==='provider_home'){
    if(!enabled(me,'service_provider'))return res.status(403).json({error:'Service Provider profile required'});
    const{rows}=await pool.query(`
      SELECT j.id,j.customer_account_id,j.provider_account_id,j.service_label,j.coarse_location,j.status,j.quote_amount,j.final_price,j.currency_code,
             j.scheduled_at,j.customer_confirmed_at,j.provider_completed_at AS completed_at,j.updated_at,j.created_at,
             c.name category,cu.display_name customer_name,
             (j.status IN ('accepted','scheduled','in_progress') AND BTRIM(j.service_location)<>'') exact_location_available
        FROM service_jobs j
        LEFT JOIN service_categories c ON c.id=j.category_id
        JOIN accounts cu ON cu.id=j.customer_account_id
       WHERE j.provider_account_id=$1
         AND j.status IN ('requested','provider_reviewing','quoted','accepted','scheduled','in_progress','completed','disputed')
         AND NOT(j.status='completed' AND j.customer_confirmed_at IS NOT NULL)
       ORDER BY CASE WHEN j.status IN ('requested','provider_reviewing','accepted','disputed','in_progress') THEN 0 WHEN j.status='scheduled' THEN 1 ELSE 2 END,
                COALESCE(j.scheduled_at,j.updated_at,j.created_at) DESC
       LIMIT 20
    `,[id]);
    return res.json(rows);
  }
  if(String(req.query.view||'')==='home'){
    if(!enabled(me,'customer'))return res.status(403).json({error:'Customer profile required'});
    const{rows}=await pool.query(`
      WITH home_jobs AS (
        (SELECT j.id,j.customer_account_id,j.provider_account_id,j.service_label,j.status,j.customer_confirmed_at,j.provider_completed_at AS completed_at,j.updated_at,j.created_at,c.name category,a.display_name provider_name,0 AS home_rank
           FROM service_jobs j
           LEFT JOIN service_categories c ON c.id=j.category_id
           JOIN accounts a ON a.id=j.provider_account_id
          WHERE j.customer_account_id=$1
            AND j.status<>'cancelled'
            AND NOT(j.status='completed' AND j.customer_confirmed_at IS NOT NULL)
          ORDER BY j.updated_at DESC
          LIMIT 12)
        UNION ALL
        (SELECT j.id,j.customer_account_id,j.provider_account_id,j.service_label,j.status,j.customer_confirmed_at,j.provider_completed_at AS completed_at,j.updated_at,j.created_at,c.name category,a.display_name provider_name,1 AS home_rank
           FROM service_jobs j
           LEFT JOIN service_categories c ON c.id=j.category_id
           JOIN accounts a ON a.id=j.provider_account_id
          WHERE j.customer_account_id=$1
            AND j.status='completed'
            AND j.customer_confirmed_at IS NOT NULL
          ORDER BY j.customer_confirmed_at DESC
          LIMIT 3)
      )
      SELECT id,customer_account_id,provider_account_id,service_label,status,customer_confirmed_at,completed_at,updated_at,created_at,category,provider_name
        FROM home_jobs
       ORDER BY home_rank,COALESCE(customer_confirmed_at,updated_at,created_at) DESC
    `,[id]);
    return res.json(rows);
  }
  const[customerJobs,providerJobs]=await Promise.all([
    pool.query(`SELECT j.*,c.name category,a.display_name provider_name,cu.display_name customer_name FROM service_jobs j LEFT JOIN service_categories c ON c.id=j.category_id JOIN accounts a ON a.id=j.provider_account_id JOIN accounts cu ON cu.id=j.customer_account_id WHERE j.customer_account_id=$1 ORDER BY j.created_at DESC LIMIT 200`,[id]),
    pool.query(`
      SELECT to_jsonb(j)-'service_location' job,c.name category,a.display_name provider_name,cu.display_name customer_name,
             (j.status IN ('accepted','scheduled','in_progress') AND BTRIM(j.service_location)<>'') exact_location_available
        FROM service_jobs j
        LEFT JOIN service_categories c ON c.id=j.category_id
        JOIN accounts a ON a.id=j.provider_account_id
        JOIN accounts cu ON cu.id=j.customer_account_id
       WHERE j.provider_account_id=$1
       ORDER BY j.created_at DESC
       LIMIT 200
    `,[id])
  ]);
  const providerRows=providerJobs.rows.map(row=>({...row.job,category:row.category,provider_name:row.provider_name,customer_name:row.customer_name,service_location:null,exact_location_available:Boolean(row.exact_location_available)}));
  const combined=[...customerJobs.rows,...providerRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,200);
  res.json(await pricingForJobs(pool,combined))
}catch(e){next(e)}})
async function sendServiceJobQuote(req,res,next){try{
  const me=await requireProvider(req),id=Number(req.params.id);
  if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Service job id is invalid'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const found=await client.query(`SELECT * FROM service_jobs WHERE id=$1 AND provider_account_id=$2 FOR UPDATE`,[id,me.account.id]);
    if(!found.rowCount)throw Object.assign(new Error('Job not found'),{status:404});
    const quote=await createServiceQuote(client,{job:found.rows[0],providerAccountId:me.account.id,input:req.body||{}});
    const updated=await client.query(`SELECT * FROM service_jobs WHERE id=$1`,[id]);
    await client.query('COMMIT');
    res.json({...redactProviderServiceJob(updated.rows[0]),pricing:{accepted_quote:null,current_quote:quote.quote_phase==='initial'?quote:null,pending_change:quote.quote_phase==='change_order'?quote:null}});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}}
app.post('/api/service-provider/jobs/:id/quotes',body,sendServiceJobQuote)
app.post('/api/service-provider/jobs/:id/quote',body,sendServiceJobQuote)

app.get('/api/services/jobs/:id/pricing',async(req,res,next)=>{try{
  const me=await identity(req),id=Number(req.params.id);
  if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Service job id is invalid'});
  const job=await pool.query(`SELECT * FROM service_jobs WHERE id=$1 AND (customer_account_id=$2 OR provider_account_id=$2)`,[id,me.account.id]);
  if(!job.rowCount)return res.status(404).json({error:'Service job not found'});
  const quotes=await pool.query(`SELECT * FROM service_job_quotes WHERE job_id=$1 ORDER BY version_no`,[id]);
  const result=[];
  for(const quote of quotes.rows)result.push(await quoteWithItems(pool,quote.id));
  const events=await pool.query(`SELECT quote_id,event_code,detail_json,created_at FROM service_job_quote_events WHERE job_id=$1 ORDER BY created_at,id`,[id]);
  res.json({job_id:id,accepted_quote_id:job.rows[0].accepted_quote_id,agreed_total:job.rows[0].agreed_total,currency_code:job.rows[0].currency_code||'PHP',quotes:result,events:events.rows});
}catch(e){next(e)}})
app.get('/api/service-provider/jobs/:id/exact-location',async(req,res,next)=>{try{
  const me=await requireProvider(req),jobId=Number(req.params.id);
  if(!Number.isInteger(jobId)||jobId<1)return res.status(400).json({error:'Service job id is invalid'});
  await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'service_exact_location_access',subjectType:'service_job',subjectId:jobId});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const job=await client.query(`SELECT id,customer_account_id,provider_account_id,status,service_location,coarse_location FROM service_jobs WHERE id=$1 AND provider_account_id=$2 FOR SHARE`,[jobId,me.account.id]);
    const row=job.rows[0],exactLocation=requireProviderExactLocation(row,me.account.id);
    const audit=await client.query(`
      INSERT INTO service_job_sensitive_access_events(
        job_id,actor_account_id,subject_account_id,actor_context,event_code,
        job_status,purpose_code,request_correlation_id
      ) VALUES($1,$2,$3,'service_provider','exact_service_location_viewed',$4,'active_job_fulfilment',$5)
      RETURNING id,created_at
    `,[row.id,me.account.id,row.customer_account_id,row.status,correlation(req)]);
    await client.query('COMMIT');
    res.json({
      job_id:Number(row.id),service_location:exactLocation,coarse_location:row.coarse_location,
      job_status:row.status,purpose_code:'active_job_fulfilment',
      access_event_id:Number(audit.rows[0].id),accessed_at:audit.rows[0].created_at,
      access_expires_when:'job_leaves_accepted_scheduled_or_in_progress'
    });
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}})
async function handleServiceQuoteResponse(req,res,next,{legacyAccept=false}={}){try{
  const me=await requireCustomer(req),jobId=Number(req.params.id);
  if(!Number.isInteger(jobId)||jobId<1)return res.status(400).json({error:'Service job id is invalid'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const found=await client.query(`SELECT * FROM service_jobs WHERE id=$1 AND customer_account_id=$2 FOR UPDATE`,[jobId,me.account.id]);
    if(!found.rowCount)throw Object.assign(new Error('Service job not found'),{status:404});
    const job=found.rows[0];
    let quoteId=Number(req.params.quoteId||req.body?.quote_id);
    if(!Number.isInteger(quoteId))throw Object.assign(new Error('Choose the exact quote version to answer'),{status:400,code:'SERVICE_QUOTE_ID_REQUIRED'});
    const quoteResult=await client.query(`SELECT * FROM service_job_quotes WHERE id=$1 AND job_id=$2 FOR UPDATE`,[quoteId,jobId]);
    if(!quoteResult.rowCount)throw Object.assign(new Error('Quote version not found'),{status:404});
    const quote=quoteResult.rows[0];
    const expectedVersion=req.body?.expected_version;
    if(expectedVersion!==undefined&&Number(expectedVersion)!==Number(quote.version_no))throw Object.assign(new Error('Quote version changed. Review the latest version before responding.'),{status:409,code:'SERVICE_QUOTE_STALE'});
    const outcome=await respondToServiceQuote(client,{job,quote,customerAccountId:me.account.id,action:legacyAccept?'accept':clean(req.body?.action,40),note:req.body?.note});
    if(outcome.expired){await client.query('COMMIT');return res.status(409).json({error:'This quote has expired. Ask the Provider for a new version.',code:'SERVICE_QUOTE_EXPIRED'})}
    const updated=await client.query(`SELECT * FROM service_jobs WHERE id=$1`,[jobId]);
    const enriched=await pricingForJobs(client,updated.rows);
    await client.query('COMMIT');
    res.json(enriched[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}}
app.post('/api/services/jobs/:id/quotes/:quoteId/respond',body,(req,res,next)=>handleServiceQuoteResponse(req,res,next))
app.post('/api/services/jobs/:id/accept-quote',body,(req,res,next)=>handleServiceQuoteResponse(req,res,next,{legacyAccept:true}))
app.post('/api/service-provider/jobs/:id/status',body,async(req,res,next)=>{try{
  const me=await requireProvider(req),status=clean(req.body?.status,40),jobId=Number(req.params.id);
  if(!['provider_reviewing','scheduled','in_progress','completed','cancelled','disputed'].includes(status))return res.status(400).json({error:'Unsupported job status'});
  if(!Number.isInteger(jobId)||jobId<1)return res.status(400).json({error:'Service job id is invalid'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const job=await client.query(`SELECT * FROM service_jobs WHERE id=$1 AND provider_account_id=$2 FOR UPDATE`,[jobId,me.account.id]);
    if(!job.rowCount)throw Object.assign(new Error('Job not found'),{status:404});
    const current=job.rows[0];
    const allowed={requested:['provider_reviewing','cancelled'],provider_reviewing:['cancelled'],accepted:['scheduled','in_progress','cancelled'],scheduled:['in_progress','cancelled'],in_progress:['completed','disputed'],quoted:['cancelled']}[current.status]||[];
    if(!allowed.includes(status))throw Object.assign(new Error(`Cannot move job from ${current.status} to ${status}`),{status:409});
    if(status==='cancelled')await enforceHighRiskVelocity(client,{actorAccountId:me.account.id,actionCode:'service_job_cancel',subjectType:'service_job',subjectId:current.id});
    let finalPrice=current.final_price;
    if(status==='completed'){
      if(current.agreed_total==null||!current.accepted_quote_id)throw Object.assign(new Error('Accept an exact quote before completing this job'),{status:409,code:'SERVICE_ACCEPTED_QUOTE_REQUIRED'});
      const pending=await client.query(`SELECT 1 FROM service_job_quotes WHERE job_id=$1 AND quote_phase='change_order' AND status='sent' LIMIT 1`,[current.id]);
      if(pending.rowCount)throw Object.assign(new Error('The Customer must answer the pending change order before completion'),{status:409,code:'SERVICE_CHANGE_ORDER_PENDING'});
      finalPrice=acceptedCompletionPrice({acceptedTotal:current.agreed_total,requestedFinalPrice:req.body?.final_price});
    }
    const{rows}=await client.query(`UPDATE service_jobs SET status=$1,scheduled_at=CASE WHEN $1='scheduled' THEN COALESCE($2::timestamptz,scheduled_at) ELSE scheduled_at END,final_price=$3,provider_completed_at=CASE WHEN $1='completed' THEN NOW() ELSE provider_completed_at END,cancelled_at=CASE WHEN $1='cancelled' THEN NOW() ELSE cancelled_at END,cancellation_reason=CASE WHEN $1='cancelled' THEN $4 ELSE cancellation_reason END,updated_at=NOW() WHERE id=$5 RETURNING *`,[status,req.body?.scheduled_at||null,finalPrice,clean(req.body?.reason,500),current.id]);
    await client.query('COMMIT');
    res.json(redactProviderServiceJob(rows[0]));
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}})
app.post('/api/services/jobs/:id/confirm-completion',body,async(req,res,next)=>{try{const me=await requireCustomer(req),id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE service_jobs SET customer_confirmed_at=COALESCE(customer_confirmed_at,NOW()),updated_at=NOW() WHERE id=$1 AND customer_account_id=$2 AND status='completed' RETURNING *`,[id,me.account.id]);if(!r.rowCount)throw Object.assign(new Error('Completed job not available for confirmation'),{status:409});const j=r.rows[0];await recordMonetizableCompletion(client,{serviceScope:'local_services',subjectType:'account',subjectId:j.provider_account_id,sourceType:'service_job',sourceId:j.id,completedAt:j.customer_confirmed_at,grossValue:j.final_price??j.quote_amount??0,currencyCode:j.currency_code||'PHP'});await client.query('COMMIT');res.json(j)}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/services/jobs/:id/review',body,async(req,res,next)=>{try{const me=await requireCustomer(req),jobId=Number(req.params.id);const j=await pool.query(`SELECT * FROM service_jobs WHERE id=$1 AND customer_account_id=$2 AND status='completed' AND customer_confirmed_at IS NOT NULL`,[jobId,me.account.id]);if(!j.rowCount)return res.status(409).json({error:'Review is available only after a completed, confirmed service job'});const vals=['workmanship','reliability','communication','professionalism','property_care','price_transparency','overall'].map(k=>Number(req.body?.[k]));if(vals.some(x=>!Number.isInteger(x)||x<1||x>5))return res.status(400).json({error:'Every rating must be from 1 to 5'});await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'review_submit',subjectType:'service_job',subjectId:jobId});const{rows}=await pool.query(`INSERT INTO service_reviews(job_id,reviewer_account_id,provider_account_id,workmanship,reliability,communication,professionalism,property_care,price_transparency,overall,review_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(job_id) DO NOTHING RETURNING *`,[jobId,me.account.id,j.rows[0].provider_account_id,...vals,clean(req.body?.review_text,1200)]);if(!rows.length)return res.status(409).json({error:'This job has already been reviewed'});res.status(201).json(rows[0])}catch(e){next(e)}})

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

async function serviceProviderReviewTerritory(accountId){
  const{rows}=await pool.query(`
    SELECT COALESCE(
      (SELECT pa.territory_id FROM profile_authorizations pa
        WHERE pa.account_id=$1 AND pa.role='service_provider' AND pa.status='active' AND pa.territory_id IS NOT NULL
        ORDER BY pa.id DESC LIMIT 1),
      (SELECT app.territory_id FROM profile_applications app
        WHERE app.account_id=$1 AND app.role='service_provider' AND app.status NOT IN ('rejected','revoked')
        ORDER BY app.id DESC LIMIT 1)
    ) territory_id
  `,[Number(accountId)]);
  return Number(rows[0]?.territory_id)||null;
}

app.get('/api/service-provider/private-cv',async(req,res,next)=>{try{
  const me=await requireProvider(req),id=Number(me.account.id);
  const q=await pool.query('SELECT cv_private_evidence_object_id,cv_private_data_url FROM service_provider_profiles WHERE account_id=$1',[id]);
  if(!q.rowCount)return res.status(404).json({error:'Service Provider profile not found'});
  if(!q.rows[0].cv_private_evidence_object_id){
    if(q.rows[0].cv_private_data_url)return res.status(409).json({error:'Private evidence migration is required before this CV can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
    return res.status(404).json({error:'Private CV not found'});
  }
  const evidence=await readPrivateEvidence(pool,{objectId:q.rows[0].cv_private_evidence_object_id,actorAccountId:id,purpose:'service_provider_cv_read',correlationId:correlation(req)});
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

app.get('/api/service-provider/credentials/:id/evidence',async(req,res,next)=>{try{
  const me=await requireProvider(req),id=Number(req.params.id);
  const q=await pool.query('SELECT private_evidence_object_id,evidence_data_url FROM profile_credentials WHERE id=$1 AND account_id=$2',[id,me.account.id]);
  if(!q.rowCount)return res.status(404).json({error:'Credential not found'});
  if(!q.rows[0].private_evidence_object_id){
    if(q.rows[0].evidence_data_url)return res.status(409).json({error:'Private evidence migration is required before this credential can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
    return res.status(404).json({error:'Credential evidence not found'});
  }
  const evidence=await readPrivateEvidence(pool,{objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,purpose:'service_credential_self_read',correlationId:correlation(req)});
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

app.get('/api/admin/service-credentials/:id/evidence',async(req,res,next)=>{try{
  const me=await identity(req),id=Number(req.params.id),target=await credentialReviewTarget(id);
  if(!target)return res.status(404).json({error:'Credential not found'});
  const territoryId=Number(target.target_territory_id)||null;
  if(!territoryId)return res.status(409).json({error:'Service Provider territory must be established before credential review'});
  await requireAdminPermission(pool,me.account.id,'credential.verify',territoryId);
  const q=await pool.query('SELECT private_evidence_object_id,evidence_data_url FROM profile_credentials WHERE id=$1',[id]);
  if(!q.rows[0].private_evidence_object_id){
    if(q.rows[0].evidence_data_url)return res.status(409).json({error:'Private evidence migration is required before this credential can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
    return res.status(404).json({error:'Credential evidence not found'});
  }
  const evidence=await readPrivateEvidence(pool,{objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,purpose:'service_credential_admin_read',correlationId:correlation(req)});
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

app.get('/api/admin/service-providers/:accountId/private-cv',async(req,res,next)=>{try{
  const me=await identity(req),accountId=Number(req.params.accountId),territoryId=await serviceProviderReviewTerritory(accountId);
  if(!territoryId)return res.status(409).json({error:'Service Provider territory must be established before CV review'});
  await requireAdminPermission(pool,me.account.id,'credential.verify',territoryId);
  const q=await pool.query('SELECT cv_private_evidence_object_id,cv_private_data_url FROM service_provider_profiles WHERE account_id=$1',[accountId]);
  if(!q.rowCount)return res.status(404).json({error:'Service Provider profile not found'});
  if(!q.rows[0].cv_private_evidence_object_id){
    if(q.rows[0].cv_private_data_url)return res.status(409).json({error:'Private evidence migration is required before this CV can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
    return res.status(404).json({error:'Private CV not found'});
  }
  const evidence=await readPrivateEvidence(pool,{objectId:q.rows[0].cv_private_evidence_object_id,actorAccountId:me.account.id,purpose:'service_provider_cv_admin_read',correlationId:correlation(req)});
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

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

function proxy(req,res,next){
  if(!marketplaceApp)return res.status(503).json({error:'Marketplace runtime is not ready'});
  return marketplaceApp(req,res,next);
}
app.use(proxy)
app.use((err,_req,res,_next)=>{const status=Number(err?.status)||500;if(status>=500)console.error(err);if(res.headersSent)return;if(err?.code==='HIGH_RISK_VELOCITY_LIMIT')res.set('Retry-After',String(Math.max(1,Number(err.retryAfterSeconds)||1)));const payload=err?.code==='HIGH_RISK_VELOCITY_LIMIT'?highRiskVelocityErrorBody(err):{error:status<500?err.message:'Unexpected server error',...(status<500&&err?.code?{code:err.code}:{})};res.status(status).json(payload)})
let embeddedStartPromise=null;
export async function startEmbeddedServices(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      marketplaceApp=await startEmbeddedMarketplace();
      marketplaceReady=true;
      await initDb();
      console.log('Business & Life Local Services mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopServices(){
  if(shuttingDown)return;
  shuttingDown=true;
  marketplaceReady=false;
  await stopEmbeddedMarketplace().catch(()=>{});
  marketplaceApp=null;
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedServices(){await stopServices()}

async function shutdown(sig){
  console.log(`Received ${sig}`);
  await stopServices();
  process.exit(0);
}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedServices()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life Local Services server listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
