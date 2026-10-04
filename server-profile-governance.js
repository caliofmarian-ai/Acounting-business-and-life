import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdminAssignments, verifyAdminAssertion } from './admin-authorization.js';
import { companyTestAccountForEmail, companyTestProfileRole } from './company-test-accounts.js';
import {authHardeningFetch,startEmbeddedAuthHardening,stopEmbeddedAuthHardening} from './server-auth-hardening.js';
import {ensurePhGeographicRegistrySchema,phGeographicRegistryStatus,syncPhGeographicRegistry,searchPhGeographicRegistry,resolvePhGeographicUnit,findNearestOpenedPhAncestor,territoryTypeForPsgcLevel,normalizePsgcCode,PH_PSGC_SOURCE} from './ph-geographic-registry.js';
import {requireAssignedOpenBarangay,accountGeographySnapshot,accountIdsInPsgcScope} from './account-geography.js';
import {ensureTerritoryDemandSchema,recordUnavailableProfileInterest,territoryDemandOverview} from './territory-demand-core.js';
import {emitNotificationEvent} from './notification-core.js';
import {enforceHighRiskVelocity,highRiskVelocityErrorBody} from './abuse-velocity-core.js';
import {ensureAccountSafetyEligibilitySchema,accountAdultEligibilitySnapshot,recordAdultEligibilityAdminReview,requireAdultEligibility} from './account-safety-eligibility-core.js';
import {
  bindPrivateEvidenceSource,deletePrivateEvidence,ensurePrivateEvidenceSchema,
  readPrivateEvidence,sendPrivateEvidence,storePrivateEvidence
} from './private-evidence-core.js';
import {ensureMicrobusinessReadinessSchema,microbusinessReadinessSnapshot,setMicrobusinessCommerceState} from './microbusiness-readiness-core.js';
import {
  PROFILE_APPLICATION_STATES,
  applicationStatusAfterReview,
  applicationStatusAfterSave,
  applicationStatusAfterSubmit,
  profileProjectionForApplication
} from './profile-application-state-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const body = express.json({ limit: '2800kb' });
const INVITE_ROLES = new Set(['merchant','supplier','courier']);
const GOVERNED_ROLES = new Set(['merchant','supplier','courier','service_provider']);
const TOKEN_SECRET=process.env.TOKEN_SECRET||'';
const APPLICATION_STATES = new Set(PROFILE_APPLICATION_STATES);
const APPLICATION_EVIDENCE_MIMES=new Set(['application/pdf','image/png','image/jpeg','image/webp']);
const MAX_APPLICATION_EVIDENCE_BYTES=2_000_000;
let authHardeningApp=null;
let authHardeningReady=false;
let shuttingDown = false;

const clean=(v,max=700)=>String(v??'').trim().slice(0,max);
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||'',160);
const email=v=>clean(v,160).toLowerCase();
const authHeader=req=>req.headers.authorization||'';
const randomToken=()=>crypto.randomBytes(30).toString('base64url');
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
async function upstream(path,options={}){return authHardeningFetch(path,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function requireAssignedTestRole(me,role){if(!me?.account?.is_test_account)return;const assigned=companyTestProfileRole(me.account.test_role);if(assigned!==role)throw Object.assign(new Error(`This company test account is reserved for ${clean(me.account.test_role||'another role',80).replaceAll('_',' ')}.`),{status:403})}
async function requireAdmin(req){const me=await identity(req);if(Number(me.account.id)===1)return me;const assertion=verifyAdminAssertion(TOKEN_SECRET,req.headers['x-bl-admin-assertion'],me.account.id);if(!assertion)throw Object.assign(new Error('Scoped Admin assertion required'),{status:403});me.admin_assertion=assertion;return me}
function validTerritoryType(v){return ['country','region','province','city','municipality','district','barangay','custom_cell'].includes(v)}
function validTerritoryStatus(v){return ['planned','onboarding','active','paused','suspended','closed'].includes(v)}
async function activeAuthorization(accountId,role,territoryId=null){const args=[accountId,role];let q=`SELECT * FROM profile_authorizations WHERE account_id=$1 AND role=$2 AND status='active'`;if(territoryId!=null){args.push(territoryId);q+=` AND (territory_id=$3 OR territory_id IS NULL)`}q+=` ORDER BY territory_id NULLS LAST,id DESC LIMIT 1`;const r=await pool.query(q,args);return r.rows[0]||null}
async function isActiveSuperAdmin(accountId){const assignments=await getAdminAssignments(pool,Number(accountId));return assignments.some(a=>(a.effective_rank||a.authority_rank||a.admin_role)==='super_admin')}
async function assignedOnboardingTerritory(me,fallbackTerritoryId=null,role=''){const geo=await accountGeographySnapshot(pool,me.account.id);if(geo.assigned){if(role&&!geo.operational_onboarding_available)await recordUnavailableProfileInterest(pool,{accountId:me.account.id,psgcCode:geo.psgc_code,role});return requireAssignedOpenBarangay(pool,me.account.id)}if(me.account.account_mode==='company_test'&&Number.isInteger(Number(fallbackTerritoryId))&&Number(fallbackTerritoryId)>0)return{id:Number(fallbackTerritoryId),test_fallback:true};return requireAssignedOpenBarangay(pool,me.account.id)}
async function ensureSuperAdminSelfProfile(client,me,role){
  const accountId=Number(me.account.id),displayName=clean(me.account.display_name,120)||'Super Admin';
  await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,TRUE,'private','active') ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,visibility='private',status='active',updated_at=NOW()`,[accountId,role]);
  if(role==='customer'){
    await client.query(`INSERT INTO customer_profiles(account_id,preferred_address) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET preferred_address=CASE WHEN customer_profiles.preferred_address='' THEN EXCLUDED.preferred_address ELSE customer_profiles.preferred_address END,updated_at=NOW()`,[accountId,clean(me.account.address,300)]);
    return;
  }
  await client.query(`INSERT INTO profile_authorizations(account_id,role,territory_id,application_id,status,approved_by_account_id,approved_at,reason) VALUES($1,$2,NULL,NULL,'active',$1,NOW(),'Super Admin self-test bypass') ON CONFLICT(account_id,role,COALESCE(territory_id,0)) DO UPDATE SET application_id=NULL,status='active',approved_by_account_id=$1,approved_at=NOW(),expires_at=NULL,reason='Super Admin self-test bypass',updated_at=NOW()`,[accountId,role]);
  if(role==='merchant'){
    const existing=await client.query(`SELECT 1 FROM business_memberships WHERE account_id=$1 AND active=TRUE LIMIT 1`,[accountId]);
    if(!existing.rowCount){const b=await client.query(`INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',NULL) RETURNING id`,[displayName+' Admin Test Workspace']);await client.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)`,[b.rows[0].id,accountId]);}
  }
  if(role==='supplier')await client.query(`INSERT INTO supplier_profiles(account_id,supplier_name) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET supplier_name=CASE WHEN supplier_profiles.supplier_name='' THEN EXCLUDED.supplier_name ELSE supplier_profiles.supplier_name END,updated_at=NOW()`,[accountId,displayName]);
  if(role==='courier')await client.query(`INSERT INTO courier_profiles(account_id,display_name,eligibility_status,available,non_commercial_test_only,approval_note) VALUES($1,$2,'pending',FALSE,TRUE,'Super Admin self-test only — private, non-commercial and blocked from real delivery work.') ON CONFLICT(account_id) DO UPDATE SET display_name=COALESCE(NULLIF(courier_profiles.display_name,''),EXCLUDED.display_name),eligibility_status='pending',available=FALSE,non_commercial_test_only=TRUE,approval_note='Super Admin self-test only — private, non-commercial and blocked from real delivery work.',updated_at=NOW()`,[accountId,displayName]);
  if(role==='service_provider')await client.query(`INSERT INTO service_provider_profiles(account_id,display_name,professional_headline,about,service_area,years_experience) VALUES($1,$2,'','','',NULL) ON CONFLICT(account_id) DO UPDATE SET display_name=CASE WHEN service_provider_profiles.display_name='' THEN EXCLUDED.display_name ELSE service_provider_profiles.display_name END,updated_at=NOW()`,[accountId,displayName]);
}
async function applicationReviewHistory(applicationId,db=pool){const r=await db.query(`
  SELECT h.id,h.application_id,h.from_status,h.decision,h.to_status,h.reviewer_account_id,
         reviewer.display_name reviewer_name,h.reviewer_note,h.evidence_attested,
         h.adult_eligibility_attested,h.approved_category_ids,h.correlation_id,h.created_at
    FROM profile_application_reviews h
    JOIN accounts reviewer ON reviewer.id=h.reviewer_account_id
   WHERE h.application_id=$1
   ORDER BY h.created_at DESC,h.id DESC
`,[Number(applicationId)]);return r.rows}
async function applicationSnapshot(applicationId,db=pool){const r=await db.query(`
  SELECT pa.*,t.name territory_name,t.status territory_status,reviewer.display_name reviewer_name,
         p.status profile_status,p.enabled profile_enabled
    FROM profile_applications pa
    LEFT JOIN territories t ON t.id=pa.territory_id
    LEFT JOIN accounts reviewer ON reviewer.id=pa.reviewed_by_account_id
    LEFT JOIN profiles p ON p.account_id=pa.account_id AND p.role=pa.role
   WHERE pa.id=$1
`,[Number(applicationId)]);if(!r.rowCount)return null;return{...r.rows[0],review_history:await applicationReviewHistory(applicationId,db)}}
async function syncProfileApplicationProjection(client,application){
  const projection=profileProjectionForApplication(application.status);
  await client.query(`
    INSERT INTO profiles(account_id,role,enabled,visibility,status)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(account_id,role) DO UPDATE SET
      enabled=EXCLUDED.enabled,
      visibility=CASE WHEN EXCLUDED.enabled=TRUE AND profiles.visibility='public' THEN 'public' ELSE EXCLUDED.visibility END,
      status=EXCLUDED.status,
      updated_at=NOW()
  `,[application.account_id,application.role,projection.enabled,projection.visibility,projection.status]);
  return projection;
}
async function recordApplicationReview(client,{application,decision,toStatus,reviewerAccountId,reviewerNote,evidenceAttested,adultEligibilityAttested,approvedCategoryIds,correlationId}){
  const r=await client.query(`
    INSERT INTO profile_application_reviews(
      application_id,from_status,decision,to_status,reviewer_account_id,reviewer_note,
      evidence_attested,adult_eligibility_attested,approved_category_ids,correlation_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    RETURNING *
  `,[application.id,application.status,decision,toStatus,reviewerAccountId,reviewerNote,Boolean(evidenceAttested),Boolean(adultEligibilityAttested),JSON.stringify(approvedCategoryIds),correlationId]);
  return r.rows[0];
}
async function audit(actorId,eventCode,targetAccountId=null,role='',territoryId=null,detail={}){await pool.query(`INSERT INTO profile_governance_events(actor_account_id,event_code,target_account_id,role,territory_id,detail_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[actorId,clean(eventCode,100),targetAccountId,clean(role,40),territoryId,JSON.stringify(detail)]).catch(()=>{})}

async function initDb(){await ensurePrivateEvidenceSchema(pool);await ensureMicrobusinessReadinessSchema(pool);await pool.query(`
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

  CREATE TABLE IF NOT EXISTS profile_application_reviews (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES profile_applications(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    decision TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reviewer_account_id BIGINT NOT NULL REFERENCES accounts(id),
    reviewer_note TEXT NOT NULL DEFAULT '',
    evidence_attested BOOLEAN NOT NULL DEFAULT FALSE,
    adult_eligibility_attested BOOLEAN NOT NULL DEFAULT FALSE,
    approved_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    correlation_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(from_status IN ('application_started','requirements_pending','submitted','under_review','approved','rejected','suspended','revoked')),
    CHECK(decision IN ('approve','reject','under_review','requirements_pending')),
    CHECK(to_status IN ('requirements_pending','under_review','approved','rejected')),
    CHECK(jsonb_typeof(approved_category_ids)='array')
  );
  CREATE INDEX IF NOT EXISTS profile_application_reviews_application_idx ON profile_application_reviews(application_id,created_at DESC,id DESC);

  CREATE TABLE IF NOT EXISTS profile_application_documents (
    id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES profile_applications(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    evidence_data_url TEXT,
    private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE profile_application_documents ALTER COLUMN evidence_data_url DROP NOT NULL;
  ALTER TABLE profile_application_documents ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);
  CREATE INDEX IF NOT EXISTS profile_application_documents_private_evidence_idx ON profile_application_documents(private_evidence_object_id);

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

  WITH latest_application AS (
    SELECT DISTINCT ON (account_id,role) account_id,role,status
      FROM profile_applications
     ORDER BY account_id,role,created_at DESC,id DESC
  )
  UPDATE profiles p
     SET enabled=FALSE,status=latest.status,visibility='private',updated_at=NOW()
    FROM latest_application latest
   WHERE p.account_id=latest.account_id
     AND p.role=latest.role
     AND latest.status IN ('application_started','requirements_pending','submitted','under_review','rejected','suspended','revoked')
     AND NOT EXISTS(
       SELECT 1 FROM profile_authorizations authz
        WHERE authz.account_id=p.account_id
          AND authz.role=p.role
          AND authz.status='active'
          AND (authz.expires_at IS NULL OR authz.expires_at>NOW())
     )
     AND (p.enabled IS DISTINCT FROM FALSE OR p.status IS DISTINCT FROM latest.status OR p.visibility IS DISTINCT FROM 'private');
`);await ensureAccountSafetyEligibilitySchema(pool);await ensurePhGeographicRegistrySchema(pool);await ensureTerritoryDemandSchema(pool)}

async function profileState(me){const id=Number(me.account.id);const [apps,auths,invites,cats]=await Promise.all([
  pool.query(`SELECT pa.id,pa.role,pa.territory_id,t.name territory_name,pa.status,pa.proposed_business_name,pa.applicant_note,pa.responsibility_acknowledged,pa.application_data,pa.submitted_at,pa.reviewed_by_account_id,pa.reviewed_at,pa.decision_reason,pa.created_at,pa.updated_at,reviewer.display_name reviewer_name,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',d.id,
        'document_type',d.document_type,
        'label',d.label,
        'original_file_name',pe.original_file_name,
        'detected_mime',pe.detected_mime,
        'byte_size',pe.byte_size,
        'scan_status',pe.scan_status,
        'created_at',d.created_at
      ) ORDER BY d.created_at,d.id)
      FROM profile_application_documents d
      LEFT JOIN private_evidence_objects pe ON pe.id=d.private_evidence_object_id
      WHERE d.application_id=pa.id
    ),'[]'::jsonb) documents,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',history.id,
        'from_status',history.from_status,
        'decision',history.decision,
        'to_status',history.to_status,
        'reviewer_name',history_reviewer.display_name,
        'reviewer_note',history.reviewer_note,
        'evidence_attested',history.evidence_attested,
        'adult_eligibility_attested',history.adult_eligibility_attested,
        'created_at',history.created_at
      ) ORDER BY history.created_at DESC,history.id DESC)
      FROM profile_application_reviews history
      JOIN accounts history_reviewer ON history_reviewer.id=history.reviewer_account_id
      WHERE history.application_id=pa.id
    ),'[]'::jsonb) review_history
    FROM profile_applications pa
    JOIN territories t ON t.id=pa.territory_id
    LEFT JOIN accounts reviewer ON reviewer.id=pa.reviewed_by_account_id
    WHERE pa.account_id=$1 ORDER BY pa.created_at DESC,pa.id DESC`,[id]),
  pool.query(`SELECT a.id,a.role,a.territory_id,t.name territory_name,a.status,a.approved_at,a.expires_at,a.reason FROM profile_authorizations a LEFT JOIN territories t ON t.id=a.territory_id WHERE a.account_id=$1 ORDER BY a.created_at DESC`,[id]),
  pool.query(`SELECT i.id,i.role,i.territory_id,t.name territory_name,i.status,i.note,i.expires_at,i.created_at FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE LOWER(i.target_email)=LOWER($1) AND i.status='invited' AND i.expires_at>NOW() ORDER BY i.created_at DESC`,[me.account.email||'']),
  pool.query(`SELECT sa.category_id,c.code,c.name,c.credential_gate,sa.territory_id,t.name territory_name,sa.status,sa.reason FROM service_category_authorizations sa JOIN service_categories c ON c.id=sa.category_id JOIN territories t ON t.id=sa.territory_id WHERE sa.account_id=$1 ORDER BY c.sort_order,c.name`,[id])
]);return{applications:apps.rows,authorizations:auths.rows,invitations:invites.rows,service_categories:cats.rows}}

app.get('/health',async(_q,res)=>{try{await pool.query('SELECT 1');const r=await upstream('/health');const ok=authHardeningReady&&r.ok;res.status(ok?200:503).json({ok,db:true,auth_hardening:ok,version:'0.8.6-profile-governance'})}catch{res.status(503).json({ok:false,db:false,auth_hardening:false,version:'0.8.6-profile-governance'})}})
app.get('/profile-governance.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','profile-governance.css'),'utf8')))
app.get('/profile-governance-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','profile-governance-ui.js'),'utf8')))
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers}});const html=await r.text();res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

async function enforceAssignedTestOnboarding(roleFromRequest,req,res,next){
  try{const me=await identity(req);requireAssignedTestRole(me,roleFromRequest(req));await requireAdultEligibility(pool,me.account.id,{action:'start operational onboarding'});next()}catch(error){next(error)}
}
app.use('/api/governance/service-provider/start',(req,res,next)=>enforceAssignedTestOnboarding(()=> 'service_provider',req,res,next));
app.use('/api/governance/profiles/:role/start',(req,res,next)=>enforceAssignedTestOnboarding(request=>clean(request.params.role,40),req,res,next));
app.use('/api/governance/invitations/:id/accept',async(req,res,next)=>{try{const me=await identity(req),inv=await pool.query(`SELECT role FROM profile_invitations WHERE id=$1`,[Number(req.params.id)]);if(inv.rowCount)requireAssignedTestRole(me,inv.rows[0].role);await requireAdultEligibility(pool,me.account.id,{action:'accept an operational invitation'});next()}catch(error){next(error)}});
app.use('/api/governance/invite/:token/accept',async(req,res,next)=>{try{const me=await identity(req),inv=await pool.query(`SELECT role FROM profile_invitations WHERE token_hash=$1`,[hash(clean(req.params.token,300))]);if(inv.rowCount)requireAssignedTestRole(me,inv.rows[0].role);await requireAdultEligibility(pool,me.account.id,{action:'accept an operational invitation'});next()}catch(error){next(error)}});
app.use('/api/governance/admin/invitations',body,(req,res,next)=>{const mapped=companyTestAccountForEmail(req.body?.target_email);const role=clean(req.body?.role,40);if(mapped&&companyTestProfileRole(mapped.role)!==role)return res.status(409).json({error:`That company test alias is reserved for ${mapped.label}.`});next()});

app.get('/api/governance/state',async(req,res,next)=>{try{const me=await identity(req);res.json(await profileState(me))}catch(e){next(e)}})
app.get('/api/governance/territories',async(req,res,next)=>{try{const me=await identity(req),geo=await accountGeographySnapshot(pool,me.account.id);if(geo.assigned){if(!geo.operational_onboarding_available)return res.json([]);const{rows}=await pool.query(`SELECT id,country_code,parent_id,territory_type,name,code,status,psgc_code FROM territories WHERE id=$1 AND country_code='PH' AND status IN ('onboarding','active')`,[geo.exact_territory.id]);return res.json(rows)}if(me.account.account_mode!=='company_test')return res.json([]);const{rows}=await pool.query(`SELECT id,country_code,parent_id,territory_type,name,code,status,psgc_code FROM territories WHERE country_code='PH' AND status IN ('onboarding','active') ORDER BY name`);res.json(rows)}catch(e){next(e)}})

app.post('/api/governance/invitations/:id/accept',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT i.* FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE i.id=$1 AND i.status='invited' AND i.expires_at>NOW() AND t.country_code='PH' AND t.status IN ('onboarding','active') FOR UPDATE OF i`,[id]);if(!q.rowCount)throw Object.assign(new Error('Invitation is not available because its operating territory is no longer open for onboarding'),{status:409});const inv=q.rows[0];const geo=await accountGeographySnapshot(pool,me.account.id);if(geo.assigned){const assigned=await requireAssignedOpenBarangay(pool,me.account.id);if(Number(inv.territory_id)!==Number(assigned.id))throw Object.assign(new Error('This invitation is for a different Business & Life area than your assigned barangay'),{status:409})}else if(me.account.account_mode!=='company_test')await requireAssignedOpenBarangay(pool,me.account.id);if(email(inv.target_email)!==email(me.account.email))throw Object.assign(new Error('This invitation belongs to a different email address'),{status:403});await client.query(`UPDATE profile_invitations SET status='accepted',accepted_by_account_id=$1,accepted_at=NOW() WHERE id=$2`,[me.account.id,id]);const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,invitation_id,status) VALUES($1,$2,$3,$4,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET invitation_id=EXCLUDED.invitation_id,updated_at=NOW() RETURNING *`,[me.account.id,inv.role,inv.territory_id,id]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id,inv.role]);await client.query('COMMIT');await audit(me.account.id,'invitation_accepted',me.account.id,inv.role,inv.territory_id,{invitation_id:id});res.json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.post('/api/governance/service-provider/start',body,async(req,res,next)=>{try{const me=await identity(req);const assigned=await assignedOnboardingTerritory(me,req.body?.territory_id,'service_provider');const territoryId=Number(assigned.id);const t=await pool.query(`SELECT id FROM territories WHERE id=$1 AND country_code='PH' AND status IN ('onboarding','active')`,[territoryId]);if(!t.rowCount)return res.status(409).json({error:'Your assigned barangay is not open for onboarding'});const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,status) VALUES($1,'service_provider',$2,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET updated_at=NOW() RETURNING *`,[me.account.id,territoryId]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,'service_provider',FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id]);await client.query('COMMIT');await audit(me.account.id,'service_application_started',me.account.id,'service_provider',territoryId);res.status(201).json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.put('/api/governance/applications/:id',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await identity(req),id=Number(req.params.id),data=req.body?.application_data&&typeof req.body.application_data==='object'?req.body.application_data:{};
    await client.query('BEGIN');
    const appRow=await client.query(`SELECT * FROM profile_applications WHERE id=$1 AND account_id=$2 FOR UPDATE`,[id,me.account.id]);
    if(!appRow.rowCount)throw Object.assign(new Error('Application not found'),{status:404});
    const current=appRow.rows[0],status=applicationStatusAfterSave(current.status);
    const{rows}=await client.query(`UPDATE profile_applications SET proposed_business_name=$1,applicant_note=$2,responsibility_acknowledged=$3,application_data=$4::jsonb,status=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,[clean(req.body?.proposed_business_name,180),clean(req.body?.applicant_note,1600),Boolean(req.body?.responsibility_acknowledged),JSON.stringify(data),status,id]);
    await syncProfileApplicationProjection(client,rows[0]);
    const committed=await applicationSnapshot(id,client);
    await client.query('COMMIT');
    res.json(committed);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
})

app.post('/api/governance/applications/:id/documents',body,async(req,res,next)=>{
  let stored=null;
  try{
    const me=await identity(req),id=Number(req.params.id),fileName=clean(req.body?.file_name,220);
    const a=await pool.query(`SELECT role,territory_id,status FROM profile_applications WHERE id=$1 AND account_id=$2 AND status IN ('application_started','requirements_pending','rejected','submitted','under_review')`,[id,me.account.id]);
    if(!a.rowCount)return res.status(409).json({error:'This application is not accepting additional evidence in its current state'});
    if(!fileName)return res.status(400).json({error:'Evidence filename is required'});
    const count=await pool.query(`SELECT COUNT(*)::int n FROM profile_application_documents WHERE application_id=$1`,[id]);
    if(Number(count.rows[0].n)>=8)return res.status(409).json({error:'Application evidence limit reached'});
    await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'upload_private',subjectType:'profile_application',subjectId:id});
    stored=await storePrivateEvidence(pool,{
      dataUrl:req.body?.evidence_data_url,fileName,
      allowedMimes:[...APPLICATION_EVIDENCE_MIMES],maxBytes:MAX_APPLICATION_EVIDENCE_BYTES,
      ownerAccountId:me.account.id,actorAccountId:me.account.id,
      sourceType:'profile_application_document',sourceId:`pending:${id}`,
      purpose:'profile_application_document_upload',classification:'profile_application_document',
      correlationId:correlation(req)
    });
    const duplicate=await pool.query(`
      SELECT d.id
        FROM profile_application_documents d
        JOIN private_evidence_objects pe ON pe.id=d.private_evidence_object_id
       WHERE d.application_id=$1
         AND pe.sha256=$2
         AND pe.scan_status='clean'
         AND pe.retention_state='active'
       ORDER BY d.id
       LIMIT 1
    `,[id,stored.sha256]);
    if(duplicate.rowCount)throw Object.assign(new Error('This exact document is already uploaded to this application.'),{status:409,code:'DUPLICATE_APPLICATION_EVIDENCE'});
    const{rows}=await pool.query(`
      INSERT INTO profile_application_documents(
        application_id,document_type,label,evidence_data_url,private_evidence_object_id
      ) VALUES($1,$2,$3,NULL,$4)
      RETURNING id,document_type,label,created_at
    `,[id,clean(req.body?.document_type,80)||'supporting_document',clean(req.body?.label,180),stored.id]);
    await bindPrivateEvidenceSource(pool,{
      objectId:stored.id,sourceType:'profile_application_document',sourceId:String(rows[0].id),
      actorAccountId:me.account.id,purpose:'profile_application_document_bind',correlationId:correlation(req)
    });
    await pool.query(`UPDATE profile_applications SET updated_at=NOW() WHERE id=$1`,[id]);
    await audit(me.account.id,'application_evidence_added',me.account.id,a.rows[0].role,a.rows[0].territory_id,{application_id:id,document_id:rows[0].id,status:a.rows[0].status});
    res.status(201).json({...rows[0],application_status:a.rows[0].status});
  }catch(e){
    if(stored?.id)await deletePrivateEvidence(pool,{objectId:stored.id,purpose:'profile_application_document_rollback',correlationId:correlation(req)}).catch(()=>{});
    next(e);
  }
})

app.post('/api/governance/applications/:id/submit',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await identity(req),id=Number(req.params.id);
    await requireAdultEligibility(pool,me.account.id,{action:'submit an operational profile application'});
    await client.query('BEGIN');
    const a=await client.query(`SELECT * FROM profile_applications WHERE id=$1 AND account_id=$2 FOR UPDATE`,[id,me.account.id]);
    if(!a.rowCount)throw Object.assign(new Error('Application not found'),{status:404});
    const current=a.rows[0],status=applicationStatusAfterSubmit(current.status);
    if(!current.responsibility_acknowledged)throw Object.assign(new Error('Acknowledge the role responsibility declaration before submitting'),{status:409});
    if(current.role==='merchant'&&!clean(current.proposed_business_name,180))throw Object.assign(new Error('Merchant application needs a business/store name'),{status:409});
    if(current.role==='service_provider'){
      const ids=Array.isArray(current.application_data?.requested_category_ids)?current.application_data.requested_category_ids.map(Number).filter(Number.isInteger):[];
      if(!ids.length)throw Object.assign(new Error('Choose at least one Local Services category'),{status:409});
    }
    const{rows}=await client.query(`UPDATE profile_applications SET status=$1,submitted_at=NOW(),reviewed_by_account_id=NULL,reviewed_at=NULL,decision_reason='',updated_at=NOW() WHERE id=$2 RETURNING *`,[status,id]);
    await syncProfileApplicationProjection(client,rows[0]);
    const committed=await applicationSnapshot(id,client);
    await client.query('COMMIT');
    await audit(me.account.id,'application_submitted',me.account.id,current.role,current.territory_id,{application_id:id,status});
    res.json(committed);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
})

app.get('/api/governance/admin/geography/status',async(req,res,next)=>{try{await requireAdmin(req);res.json(await phGeographicRegistryStatus(pool))}catch(e){next(e)}})
app.get('/api/governance/admin/territory-demand',async(req,res,next)=>{try{await requireAdmin(req);res.json(await territoryDemandOverview(pool,{level:req.query.level,limit:req.query.limit}))}catch(e){next(e)}})
app.get('/api/governance/admin/geography/search',async(req,res,next)=>{try{await requireAdmin(req);res.json(await searchPhGeographicRegistry(pool,{query:req.query.q,level:req.query.level,parentPsgcCode:req.query.parent_psgc_code,limit:req.query.limit}))}catch(e){next(e)}})
app.post('/api/governance/admin/geography/sync',body,async(req,res,next)=>{try{const me=await requireAdmin(req);if(!(await isActiveSuperAdmin(me.account.id)))return res.status(403).json({error:'Active Super Admin assignment required to synchronize the national PSGC registry'});const result=await syncPhGeographicRegistry(pool,{importedByAccountId:Number(me.account.id)});await audit(me.account.id,'ph_psgc_registry_synchronized',null,'',null,{source_version:PH_PSGC_SOURCE.version,row_count:result.latest?.row_count||0});res.json(result)}catch(e){console.error(e);res.status(502).json({error:'PSGC synchronization failed safely. Existing geography was not replaced.',detail:clean(e?.message||e,500)})}})

app.get('/api/governance/admin/overview',async(req,res,next)=>{try{await requireAdmin(req);const[territories,apps,invites,auths]=await Promise.all([
  pool.query(`SELECT t.*,p.name parent_name FROM territories t LEFT JOIN territories p ON p.id=t.parent_id WHERE t.country_code='PH' ORDER BY t.created_at DESC`),
  pool.query(`SELECT pa.*,a.display_name,a.email,t.name territory_name,(SELECT COUNT(*)::int FROM profile_application_documents d WHERE d.application_id=pa.id) document_count FROM profile_applications pa JOIN accounts a ON a.id=pa.account_id JOIN territories t ON t.id=pa.territory_id ORDER BY CASE pa.status WHEN 'submitted' THEN 1 WHEN 'under_review' THEN 2 ELSE 9 END,pa.updated_at DESC LIMIT 250`),
  pool.query(`SELECT i.id,i.target_email,i.role,i.status,i.note,i.expires_at,i.created_at,t.name territory_name FROM profile_invitations i JOIN territories t ON t.id=i.territory_id ORDER BY i.created_at DESC LIMIT 250`),
  pool.query(`SELECT a.id,a.account_id,ac.display_name,ac.email,a.role,a.status,a.territory_id,t.name territory_name,a.approved_at,a.reason,
    CASE WHEN a.role='merchant' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) ORDER BY b.name)
        FROM business_memberships bm JOIN businesses b ON b.id=bm.business_id
       WHERE bm.account_id=a.account_id AND bm.active=TRUE
    ),'[]'::jsonb) ELSE '[]'::jsonb END businesses
    FROM profile_authorizations a
    JOIN accounts ac ON ac.id=a.account_id
    LEFT JOIN territories t ON t.id=a.territory_id
    ORDER BY a.updated_at DESC LIMIT 250`)
]);res.json({territories:territories.rows,applications:apps.rows,invitations:invites.rows,authorizations:auths.rows})}catch(e){next(e)}})

app.post('/api/governance/admin/territories',body,async(req,res,next)=>{try{
  const me=await requireAdmin(req),status=clean(req.body?.status,30)||'onboarding';
  if(!validTerritoryStatus(status))return res.status(400).json({error:'Valid territory status is required'});
  const psgcCode=normalizePsgcCode(req.body?.psgc_code,10);
  if(psgcCode){
    const unit=await resolvePhGeographicUnit(pool,psgcCode);
    if(!unit)return res.status(409).json({error:'Select a geography record from the synchronized official PSGC registry'});
    const type=territoryTypeForPsgcLevel(unit.geographic_level);
    if(!type)return res.status(409).json({error:'This PSGC geographic level cannot be opened as an operating territory'});
    const parent=await findNearestOpenedPhAncestor(pool,unit);
    const{rows}=await pool.query(
      "INSERT INTO territories(country_code,parent_id,territory_type,name,code,status,created_by_account_id,psgc_code,geographic_source,geographic_source_version) VALUES('PH',$1,$2,$3,$4,$5,$6,$7,'PSA_PSGC',$8) RETURNING *",
      [parent,type,unit.name,unit.psgc_code,status,me.account.id,unit.psgc_code,unit.source_version]
    );
    await audit(me.account.id,'territory_created_from_psgc',null,'',rows[0].id,{name:unit.name,type,status,psgc_code:unit.psgc_code,source_version:unit.source_version,parent_territory_id:parent});
    try{const memberIds=await accountIdsInPsgcScope(pool,unit.psgc_code);if(memberIds.length)await emitNotificationEvent(pool,{eventKey:'territory:'+rows[0].id+':opened:'+status,eventCode:['onboarding','active'].includes(status)?'territory.area_available':'territory.area_status',sourceService:'governance',entityType:'territory',entityId:String(rows[0].id),category:'operational',priority:['suspended','closed'].includes(status)?'high':'normal',mandatory:true,emailDefault:false,pushDefault:true,data:{area_name:unit.name,area_status:status,area_message:'Business & Life opened '+unit.name+' with status '+status+'.',action:'manage_profiles'},recipients:memberIds.map(accountId=>({accountId,roleHint:''}))})}catch(error){console.warn('Territory opening member notification suppressed:',error.message)}
    return res.status(201).json(rows[0]);
  }
  const type=clean(req.body?.territory_type,40),name=clean(req.body?.name,180);
  const manualAllowed=type==='custom_cell'||process.env.APP_ENV==='qa'||process.env.NODE_ENV==='test';
  if(!manualAllowed)return res.status(409).json({error:'Official PH administrative territories must be selected from the PSGC registry'});
  if(!name||!validTerritoryType(type))return res.status(400).json({error:'Valid territory name and type are required'});
  const parent=req.body?.parent_id?Number(req.body.parent_id):null;
  if(parent){const p=await pool.query("SELECT 1 FROM territories WHERE id=$1 AND country_code='PH'",[parent]);if(!p.rowCount)return res.status(404).json({error:'Parent territory not found'})}
  const code=clean(req.body?.code,80)||null;
  const{rows}=await pool.query("INSERT INTO territories(country_code,parent_id,territory_type,name,code,status,created_by_account_id) VALUES('PH',$1,$2,$3,$4,$5,$6) RETURNING *",[parent,type,name,code,status,me.account.id]);
  await audit(me.account.id,'territory_created_manual_compatibility',null,'',rows[0].id,{name,type,status});
  res.status(201).json(rows[0]);
}catch(e){if(e.code==='23505')return res.status(409).json({error:'This PSGC geography is already opened as a Business & Life territory'});next(e)}})

app.patch('/api/governance/admin/territories/:id/status',body,async(req,res,next)=>{const client=await pool.connect();try{
  const me=await requireAdmin(req),id=Number(req.params.id),status=clean(req.body?.status,30),reason=clean(req.body?.reason,800);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Valid territory id is required'});
  if(!validTerritoryStatus(status))return res.status(400).json({error:'Choose planned, onboarding, active, paused, suspended or closed'});
  if(['suspended','closed'].includes(status)&&!reason)return res.status(400).json({error:'Add a reason before suspending or closing a territory'});
  await client.query('BEGIN');
  const q=await client.query("SELECT * FROM territories WHERE id=$1 AND country_code='PH' FOR UPDATE",[id]);
  if(!q.rowCount)throw Object.assign(new Error('Territory not found'),{status:404});
  const before=q.rows[0];
  if(before.status===status){await client.query('COMMIT');return res.json(before)}
  if(status==='closed'){
    const child=await client.query("SELECT id,name,status FROM territories WHERE parent_id=$1 AND status<>'closed' ORDER BY id LIMIT 1",[id]);
    if(child.rowCount)throw Object.assign(new Error('Close or re-scope child territories before closing this territory'),{status:409});
  }
  const updated=await client.query("UPDATE territories SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",[status,id]);
  await client.query('COMMIT');
  await audit(me.account.id,'territory_status_changed',null,'',id,{name:before.name,psgc_code:before.psgc_code||null,before_status:before.status,after_status:status,reason});
  if(before.psgc_code){try{const memberIds=await accountIdsInPsgcScope(pool,before.psgc_code);if(memberIds.length){const eventKey='territory:'+id+':status:'+status+':'+String(updated.rows[0].updated_at||Date.now());await emitNotificationEvent(pool,{eventKey,eventCode:['onboarding','active'].includes(status)?'territory.area_available':'territory.area_status',sourceService:'governance',entityType:'territory',entityId:String(id),category:'operational',priority:['suspended','closed'].includes(status)?'high':'normal',mandatory:true,emailDefault:false,pushDefault:true,data:{area_name:before.name,area_status:status,area_message:'Business & Life status for '+before.name+' is now '+status+'.',action:'manage_profiles'},recipients:memberIds.map(accountId=>({accountId,roleHint:''}))})}}catch(error){console.warn('Territory member notification suppressed:',error.message)}}
  res.json(updated.rows[0]);
}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}})

app.post('/api/governance/admin/invitations',body,async(req,res,next)=>{try{const me=await requireAdmin(req),role=clean(req.body?.role,40),target=email(req.body?.target_email),territoryId=Number(req.body?.territory_id);if(!INVITE_ROLES.has(role)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target))return res.status(400).json({error:'Valid invite role and email are required'});const t=await pool.query(`SELECT id,name,status FROM territories WHERE id=$1 AND country_code='PH' AND status IN ('onboarding','active')`,[territoryId]);if(!t.rowCount)return res.status(409).json({error:'Invitation requires an onboarding or active PH territory'});await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'invitation_create',subjectType:'territory',subjectId:territoryId});await pool.query(`UPDATE profile_invitations SET status='revoked',revoked_at=NOW() WHERE LOWER(target_email)=$1 AND role=$2 AND territory_id=$3 AND status='invited'`,[target,role,territoryId]);const raw=randomToken();const days=Math.max(1,Math.min(30,Number(req.body?.expires_days)||7));const{rows}=await pool.query(`INSERT INTO profile_invitations(target_email,role,territory_id,token_hash,status,invited_by_account_id,note,expires_at) VALUES($1,$2,$3,$4,'invited',$5,$6,NOW()+($7*INTERVAL '1 day')) RETURNING id,target_email,role,territory_id,status,note,expires_at,created_at`,[target,role,territoryId,hash(raw),me.account.id,clean(req.body?.note,700),days]);await audit(me.account.id,'invitation_created',null,role,territoryId,{invitation_id:rows[0].id,target_email_hash:hash(target)});res.status(201).json({...rows[0],invite_token:raw})}catch(e){next(e)}})

app.get('/api/governance/invite/:token',async(req,res,next)=>{try{const me=await identity(req),tokenHash=hash(clean(req.params.token,300));const q=await pool.query(`SELECT i.id,i.target_email,i.role,i.territory_id,i.status,i.note,i.expires_at,t.name territory_name FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE i.token_hash=$1 AND i.status='invited' AND i.expires_at>NOW()`,[tokenHash]);if(!q.rowCount)return res.status(404).json({error:'Invitation is invalid or expired'});if(email(q.rows[0].target_email)!==email(me.account.email))return res.status(403).json({error:'Sign in with the invited email address'});res.json(q.rows[0])}catch(e){next(e)}})
app.post('/api/governance/invite/:token/accept',body,async(req,res,next)=>{try{const me=await identity(req),tokenHash=hash(clean(req.params.token,300)),q=await pool.query(`SELECT i.id FROM profile_invitations i JOIN territories t ON t.id=i.territory_id WHERE i.token_hash=$1 AND i.status='invited' AND i.expires_at>NOW() AND t.country_code='PH' AND t.status IN ('onboarding','active')`,[tokenHash]);if(!q.rowCount)return res.status(409).json({error:'Invitation is invalid, expired or its operating territory is no longer open for onboarding'});req.params.id=String(q.rows[0].id);const fake={...req,params:{id:String(q.rows[0].id)}};const inv=await pool.query(`SELECT * FROM profile_invitations WHERE id=$1`,[q.rows[0].id]);const geo=await accountGeographySnapshot(pool,me.account.id);if(geo.assigned){const assigned=await requireAssignedOpenBarangay(pool,me.account.id);if(Number(inv.rows[0].territory_id)!==Number(assigned.id))return res.status(409).json({error:'This invitation is for a different Business & Life area than your assigned barangay'})}else if(me.account.account_mode!=='company_test')await requireAssignedOpenBarangay(pool,me.account.id);if(email(inv.rows[0].target_email)!==email(me.account.email))return res.status(403).json({error:'Sign in with the invited email address'});const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE profile_invitations SET status='accepted',accepted_by_account_id=$1,accepted_at=NOW() WHERE id=$2`,[me.account.id,q.rows[0].id]);const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,invitation_id,status) VALUES($1,$2,$3,$4,'application_started') ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET invitation_id=EXCLUDED.invitation_id,updated_at=NOW() RETURNING *`,[me.account.id,inv.rows[0].role,inv.rows[0].territory_id,q.rows[0].id]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id,inv.rows[0].role]);await client.query('COMMIT');await audit(me.account.id,'invitation_accepted',me.account.id,inv.rows[0].role,inv.rows[0].territory_id,{invitation_id:q.rows[0].id});res.json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.get('/api/governance/admin/applications/:id',async(req,res,next)=>{
  try{
    await requireAdmin(req);
    const id=Number(req.params.id);
    const a=await pool.query(`
      SELECT pa.*,ac.display_name,ac.email,t.name territory_name,reviewer.display_name reviewer_name,
             p.status profile_status,p.enabled profile_enabled
        FROM profile_applications pa
        JOIN accounts ac ON ac.id=pa.account_id
        JOIN territories t ON t.id=pa.territory_id
        LEFT JOIN accounts reviewer ON reviewer.id=pa.reviewed_by_account_id
        LEFT JOIN profiles p ON p.account_id=pa.account_id AND p.role=pa.role
       WHERE pa.id=$1
    `,[id]);
    if(!a.rowCount)return res.status(404).json({error:'Application not found'});
    const application=a.rows[0],serviceProvider=application.role==='service_provider';
    const requestedIds=serviceProvider&&Array.isArray(application.application_data?.requested_category_ids)
      ?application.application_data.requested_category_ids.map(Number).filter(Number.isInteger)
      :[];
    const docsPromise=pool.query(`
      SELECT d.id,d.document_type,d.label,d.created_at,
             pe.original_file_name,pe.detected_mime,pe.byte_size,pe.scan_status,
             (
               SELECT d2.id
                 FROM profile_application_documents d2
                 JOIN private_evidence_objects pe2 ON pe2.id=d2.private_evidence_object_id
                WHERE d2.application_id=d.application_id
                  AND d2.id<d.id
                  AND pe.sha256 IS NOT NULL
                  AND pe2.sha256=pe.sha256
                  AND pe2.scan_status='clean'
                  AND pe2.retention_state='active'
                ORDER BY d2.id
                LIMIT 1
             ) duplicate_of_id
        FROM profile_application_documents d
        LEFT JOIN private_evidence_objects pe ON pe.id=d.private_evidence_object_id
       WHERE d.application_id=$1
       ORDER BY d.created_at,d.id
    `,[id]);
    const servicesPromise=serviceProvider
      ?pool.query(`SELECT s.category_id,c.code,c.name,c.credential_gate,s.service_label FROM service_provider_services s JOIN service_categories c ON c.id=s.category_id WHERE s.account_id=$1 ORDER BY c.sort_order,c.name`,[application.account_id])
      :Promise.resolve({rows:[]});
    const credentialsPromise=serviceProvider
      ?pool.query(`SELECT id,credential_type,title,issuing_body,verification_status,expiry_date FROM profile_credentials WHERE account_id=$1 ORDER BY created_at DESC`,[application.account_id])
      :Promise.resolve({rows:[]});
    const requestedCategoriesPromise=serviceProvider&&requestedIds.length
      ?pool.query(`SELECT id,code,name,credential_gate FROM service_categories WHERE id=ANY($1::bigint[]) AND active=TRUE ORDER BY sort_order,name`,[requestedIds])
      :Promise.resolve({rows:[]});
    const reviewHistoryPromise=applicationReviewHistory(id);
    const[docs,services,credentials,requestedCategories,adultEligibility,reviewHistory]=await Promise.all([
      docsPromise,servicesPromise,credentialsPromise,requestedCategoriesPromise,
      accountAdultEligibilitySnapshot(pool,application.account_id),reviewHistoryPromise
    ]);
    res.json({...application,adult_eligibility:adultEligibility,documents:docs.rows,existing_services:services.rows,credentials:credentials.rows,requested_categories:requestedCategories.rows,review_history:reviewHistory});
  }catch(e){next(e)}
})
app.get('/api/governance/admin/application-documents/:id',async(req,res,next)=>{
  try{
    const me=await requireAdmin(req);
    const q=await pool.query(`
      SELECT d.id,d.private_evidence_object_id
        FROM profile_application_documents d
       WHERE d.id=$1
    `,[Number(req.params.id)]);
    if(!q.rowCount)return res.status(404).json({error:'Document not found'});
    if(!q.rows[0].private_evidence_object_id)return res.status(409).json({error:'Private evidence migration is required before this document can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
    const evidence=await readPrivateEvidence(pool,{
      objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,
      purpose:'profile_application_document_read',correlationId:correlation(req)
    });
    return sendPrivateEvidence(res,evidence);
  }catch(e){next(e)}
})

async function ensureApprovedProfile(client,appRow,adminId,approvedCategoryIds=[]){const accountId=Number(appRow.account_id),role=appRow.role,territoryId=Number(appRow.territory_id);await client.query(`INSERT INTO profile_authorizations(account_id,role,territory_id,application_id,status,approved_by_account_id,approved_at,reason) VALUES($1,$2,$3,$4,'active',$5,NOW(),'Approved') ON CONFLICT(account_id,role,COALESCE(territory_id,0)) DO UPDATE SET application_id=EXCLUDED.application_id,status='active',approved_by_account_id=EXCLUDED.approved_by_account_id,approved_at=NOW(),reason='Approved',updated_at=NOW()`,[accountId,role,territoryId,appRow.id,adminId]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,TRUE,'private','active') ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active',visibility=CASE WHEN profiles.visibility='public' THEN 'public' ELSE 'private' END,updated_at=NOW()`,[accountId,role]);if(role==='merchant'){const existing=await client.query(`SELECT 1 FROM business_memberships WHERE account_id=$1 AND active=TRUE LIMIT 1`,[accountId]);if(!existing.rowCount){const name=clean(appRow.proposed_business_name,180)||'My Business';const b=await client.query(`INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',$2) RETURNING id`,[name,territoryId]);await client.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)`,[b.rows[0].id,accountId]);}}
if(role==='supplier')await client.query(`INSERT INTO supplier_profiles(account_id,supplier_name) SELECT id,COALESCE(NULLIF($2,''),display_name) FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`,[accountId,clean(appRow.proposed_business_name,180)]);
if(role==='courier')await client.query(`INSERT INTO courier_profiles(account_id,display_name,eligibility_status) SELECT id,display_name,'pending' FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO UPDATE SET eligibility_status=CASE WHEN courier_profiles.eligibility_status='not_requested' THEN 'pending' ELSE courier_profiles.eligibility_status END`,[accountId]);
if(role==='service_provider'){
  await client.query(`INSERT INTO service_provider_profiles(account_id,display_name,professional_headline,about,service_area,years_experience) SELECT id,display_name,$2,$3,$4,$5 FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO UPDATE SET professional_headline=EXCLUDED.professional_headline,about=EXCLUDED.about,service_area=EXCLUDED.service_area,years_experience=EXCLUDED.years_experience,updated_at=NOW()`,[accountId,clean(appRow.application_data?.professional_headline,160),clean(appRow.application_data?.about,1800),clean(appRow.application_data?.service_area,300),Number.isFinite(Number(appRow.application_data?.years_experience))?Number(appRow.application_data.years_experience):null]);
  const requested=Array.isArray(appRow.application_data?.requested_category_ids)?appRow.application_data.requested_category_ids.map(Number).filter(Number.isInteger):[];const allow=new Set((Array.isArray(approvedCategoryIds)?approvedCategoryIds:[]).map(Number));for(const categoryId of requested){const c=await client.query(`SELECT id,name,credential_gate FROM service_categories WHERE id=$1 AND active=TRUE`,[categoryId]);if(!c.rowCount)continue;let ok=allow.has(categoryId);let reason='Not approved in this review';if(ok&&c.rows[0].credential_gate){const verified=await client.query(`SELECT 1 FROM profile_credentials WHERE account_id=$1 AND verification_status='verified' AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE) LIMIT 1`,[accountId]);if(!verified.rowCount){ok=false;reason='Credential-gated category requires verified evidence before activation'}}await client.query(`INSERT INTO service_category_authorizations(account_id,category_id,territory_id,status,approved_by_account_id,approved_at,reason) VALUES($1,$2,$3,$4,$5,CASE WHEN $4='active' THEN NOW() END,$6) ON CONFLICT(account_id,category_id,territory_id) DO UPDATE SET status=EXCLUDED.status,approved_by_account_id=EXCLUDED.approved_by_account_id,approved_at=EXCLUDED.approved_at,reason=EXCLUDED.reason,updated_at=NOW()`,[accountId,categoryId,territoryId,ok?'active':'pending',adminId,ok?'Approved':reason]);if(ok)await client.query(`INSERT INTO service_provider_services(account_id,category_id,service_label,active) VALUES($1,$2,$3,TRUE) ON CONFLICT(account_id,category_id,service_label) DO UPDATE SET active=TRUE`,[accountId,categoryId,c.rows[0].name]);}
}}

app.post('/api/governance/admin/applications/:id/review',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireAdmin(req),id=Number(req.params.id),decision=clean(req.body?.decision,30),reason=clean(req.body?.reason,1000);
    const evidenceAttested=req.body?.evidence_attested===true;
    const adultEligibilityAttested=req.body?.adult_eligibility_reviewed===true;
    const approvedCategoryIds=[...new Set((Array.isArray(req.body?.approved_category_ids)?req.body.approved_category_ids:[]).map(Number).filter(Number.isSafeInteger))];
    if(decision==='requirements_pending'&&!reason)return res.status(400).json({error:'Explain what information or correction is required'});
    await client.query('BEGIN');
    const q=await client.query(`SELECT * FROM profile_applications WHERE id=$1 FOR UPDATE`,[id]);
    if(!q.rowCount)throw Object.assign(new Error('Application not found'),{status:404});
    const application=q.rows[0],toStatus=applicationStatusAfterReview(application.status,decision);
    let reviewerNote=reason;
    if(decision==='approve'){
      const accountState=await client.query(`SELECT email_verified_at,account_mode FROM accounts WHERE id=$1 FOR UPDATE`,[application.account_id]);
      if(!accountState.rowCount)throw Object.assign(new Error('Applicant account not found'),{status:404});
      if(accountState.rows[0].account_mode!=='company_test'&&!accountState.rows[0].email_verified_at)throw Object.assign(new Error('Email ownership must be verified before an operational profile can be approved'),{status:409,code:'EMAIL_VERIFICATION_REQUIRED'});
      const eligibility=await accountAdultEligibilitySnapshot(client,application.account_id,{lock:true});
      if(!eligibility.company_test_exempt)await recordAdultEligibilityAdminReview(client,{accountId:application.account_id,actorAccountId:me.account.id,confirmed:adultEligibilityAttested,source:'profile_application_review'});
      if(!evidenceAttested)throw Object.assign(new Error('Confirm that the application evidence was reviewed before approval'),{status:400,code:'REVIEW_ATTESTATION_REQUIRED'});
      reviewerNote=reason||'Approved';
      await ensureApprovedProfile(client,application,me.account.id,approvedCategoryIds);
    }else if(decision==='reject'){
      if(!evidenceAttested)throw Object.assign(new Error('Confirm that the application evidence was reviewed before rejection'),{status:400,code:'REVIEW_ATTESTATION_REQUIRED'});
      reviewerNote=reason||'Requirements not approved';
    }
    const updated=await client.query(`
      UPDATE profile_applications
         SET status=$1,reviewed_by_account_id=$2,reviewed_at=NOW(),decision_reason=$3,updated_at=NOW()
       WHERE id=$4
       RETURNING *
    `,[toStatus,me.account.id,reviewerNote,id]);
    await syncProfileApplicationProjection(client,updated.rows[0]);
    const reviewEvent=await recordApplicationReview(client,{
      application,decision,toStatus,reviewerAccountId:me.account.id,reviewerNote,
      evidenceAttested,adultEligibilityAttested,approvedCategoryIds,correlationId:correlation(req)
    });
    const committed=await applicationSnapshot(id,client);
    await client.query('COMMIT');
    await audit(me.account.id,`application_${decision}`,application.account_id,application.role,application.territory_id,{
      application_id:id,review_event_id:reviewEvent.id,from_status:application.status,to_status:toStatus,
      reason:clean(reviewerNote,300),evidence_attested:evidenceAttested,
      adult_eligibility_reviewed:decision==='approve'?adultEligibilityAttested:false
    });
    res.json({...committed,committed:true,review_event_id:Number(reviewEvent.id)});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
})

app.get('/api/governance/admin/readiness/:accountId/:role',async(req,res,next)=>{try{
  await requireAdmin(req);
  const accountId=Number(req.params.accountId),role=clean(req.params.role,40);
  if(!Number.isInteger(accountId)||accountId<1)return res.status(400).json({error:'Valid target account required'});
  if(!['merchant','service_provider'].includes(role))return res.status(400).json({error:'Readiness review is available only for Merchant or Local Services'});
  const businessId=role==='merchant'?Number(req.query?.business_id):null;
  if(role==='merchant'&&(!Number.isInteger(businessId)||businessId<1))return res.status(400).json({error:'Merchant business_id is required'});
  res.json(await microbusinessReadinessSnapshot(pool,{accountId,profileRole:role,businessId,verifyOwnership:true}));
}catch(e){next(e)}})

app.post('/api/governance/admin/readiness/:accountId/:role/review',body,async(req,res,next)=>{try{
  const me=await requireAdmin(req),accountId=Number(req.params.accountId),role=clean(req.params.role,40);
  if(!(await isActiveSuperAdmin(me.account.id)))return res.status(403).json({error:'Active Super Admin assignment required for commerce eligibility review'});
  if(!Number.isInteger(accountId)||accountId<1)return res.status(400).json({error:'Valid target account required'});
  if(!['merchant','service_provider'].includes(role))return res.status(400).json({error:'Readiness review is available only for Merchant or Local Services'});
  const businessId=role==='merchant'?Number(req.body?.business_id):null;
  if(role==='merchant'&&(!Number.isInteger(businessId)||businessId<1))return res.status(400).json({error:'Merchant business_id is required'});
  const commerceState=clean(req.body?.commerce_state,40),reason=clean(req.body?.reason,500);
  const commerceScope=req.body?.commerce_scope&&typeof req.body.commerce_scope==='object'&&!Array.isArray(req.body.commerce_scope)?req.body.commerce_scope:{};
  const evidenceChecklist=Array.isArray(req.body?.eligibility_evidence)?req.body.eligibility_evidence:[];
  if(!['readiness_only','eligible_limited','eligible_full'].includes(commerceState))return res.status(400).json({error:'Choose readiness_only, eligible_limited or eligible_full'});
  if(commerceState==='eligible_limited'&&!Object.keys(commerceScope).length)return res.status(400).json({error:'Define the limited commerce scope before granting limited eligibility'});
  const before=await microbusinessReadinessSnapshot(pool,{accountId,profileRole:role,businessId,verifyOwnership:true});
  const authorization=await activeAuthorization(accountId,role);
  if(commerceState!=='readiness_only'){
    if(!authorization)return res.status(409).json({error:'Active platform profile authorization is required before commerce eligibility can be granted'});
    if(!before.activity_track||!before.operating_context)return res.status(409).json({error:'Complete the activity track and operating context before commerce eligibility review'});
    if(!reason)return res.status(400).json({error:'Review reason is required when granting commerce eligibility'});
  }
  const readiness=await setMicrobusinessCommerceState(pool,{
    accountId,profileRole:role,businessId,actorAccountId:me.account.id,
    commerceState,reason,commerceScope,evidenceChecklist
  });
  if(commerceState==='readiness_only'){
    if(role==='merchant')await pool.query(`UPDATE merchant_storefronts SET publication_status='paused',updated_at=NOW() WHERE business_id=$1`,[businessId]);
    if(role==='service_provider')await pool.query(`UPDATE profiles SET visibility='private',updated_at=NOW() WHERE account_id=$1 AND role='service_provider'`,[accountId]);
  }
  await audit(me.account.id,'microbusiness_commerce_'+commerceState,accountId,role,authorization?.territory_id||null,{
    business_id:businessId||null,reason,commerce_scope:readiness.commerce_scope,
    eligibility_evidence:readiness.eligibility_evidence.map(item=>({code:item.code,outcome:item.outcome,source_authority:item.source_authority})),
    policy_version:readiness.policy_version,
    profile_authorization_separate:true
  });
  res.json(readiness);
}catch(e){next(e)}})

app.post('/api/governance/admin/authorizations/:id/status',body,async(req,res,next)=>{try{const me=await requireAdmin(req),id=Number(req.params.id),status=clean(req.body?.status,30);if(!['active','suspended','revoked'].includes(status))return res.status(400).json({error:'Choose active, suspended or revoked'});const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM profile_authorizations WHERE id=$1 FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Authorization not found'),{status:404});const a=q.rows[0];if(status==='active'){const accountState=await client.query(`SELECT email_verified_at,account_mode FROM accounts WHERE id=$1 FOR UPDATE`,[a.account_id]);if(!accountState.rowCount)throw Object.assign(new Error('Profile account not found'),{status:404});if(accountState.rows[0].account_mode!=='company_test'&&!accountState.rows[0].email_verified_at)throw Object.assign(new Error('Email ownership must be verified before an operational profile can be reactivated'),{status:409,code:'EMAIL_VERIFICATION_REQUIRED'});await requireAdultEligibility(client,a.account_id,{action:'reactivate an operational profile'});}await client.query(`UPDATE profile_authorizations SET status=$1,reason=$2,updated_at=NOW() WHERE id=$3`,[status,clean(req.body?.reason,1000),id]);if(status==='active')await client.query(`UPDATE profiles SET enabled=TRUE,status='active',updated_at=NOW() WHERE account_id=$1 AND role=$2`,[a.account_id,a.role]);else{await client.query(`UPDATE profiles SET enabled=FALSE,status=$1,visibility='private',updated_at=NOW() WHERE account_id=$2 AND role=$3`,[status,a.account_id,a.role]);if(a.role==='merchant')await client.query(`UPDATE merchant_storefronts ms SET publication_status='paused',updated_at=NOW() FROM business_memberships bm WHERE bm.business_id=ms.business_id AND bm.account_id=$1`,[a.account_id]);if(a.role==='courier'){await client.query(`UPDATE courier_profiles SET available=FALSE,eligibility_status=CASE WHEN eligibility_status='approved' THEN 'suspended' ELSE eligibility_status END,updated_at=NOW() WHERE account_id=$1`,[a.account_id]);const offersTable=await client.query(`SELECT to_regclass('public.delivery_offers') table_name`);if(offersTable.rows[0]?.table_name)await client.query(`UPDATE delivery_offers SET status='withdrawn',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW() WHERE courier_account_id=$1 AND status='pending'`,[a.account_id]);}}await client.query('COMMIT');await audit(me.account.id,`authorization_${status}`,a.account_id,a.role,a.territory_id,{authorization_id:id,reason:clean(req.body?.reason,300)});res.json({ok:true,status})}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

async function forwardJson(req,res,path=req.originalUrl,bodyValue=req.body){const r=await upstream(path,{method:req.method,headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(bodyValue??{})});const b=await r.json().catch(()=>({}));res.status(r.status).json(b)}
app.post('/api/governance/super-admin/self-test/profiles/:role/activate',body,async(req,res,next)=>{try{
  const me=await identity(req),role=clean(req.params.role,40);
  if(!['merchant','customer','supplier','courier','service_provider'].includes(role))return res.status(400).json({error:'Unknown profile role'});
  if(!(await isActiveSuperAdmin(me.account.id)))return res.status(403).json({error:'Active Super Admin assignment required'});
  await requireAdultEligibility(pool,me.account.id,{action:'activate a Super Admin test profile'});
  const client=await pool.connect();
  try{await client.query('BEGIN');await ensureSuperAdminSelfProfile(client,me,role);await client.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2`,[role,me.account.id]);await client.query('COMMIT')}
  catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  await audit(me.account.id,'super_admin_self_test_profile_activated',me.account.id,role,null,{bypass:['email_verification','invitation','onboarding','documents'],visibility:'private'});
  res.status(201).json(await identity(req));
}catch(e){next(e)}})
app.put('/api/profiles/:role',body,async(req,res,next)=>{try{const role=clean(req.params.role,40);if(role==='customer')return forwardJson(req,res);if(!GOVERNED_ROLES.has(role))return forwardJson(req,res);const me=await identity(req);if(req.body?.enabled===false){return forwardJson(req,res)}await requireAdultEligibility(pool,me.account.id,{action:'reactivate an operational profile'});const auth=await activeAuthorization(me.account.id,role);if(!auth)return res.status(403).json({error:role==='service_provider'?'Submit and obtain approval for your Local Services application first.':role==='merchant'?'Merchant approval is required before this profile can become operational.':'This profile is invitation-only and requires Admin approval.'});return forwardJson(req,res)}catch(e){next(e)}})
app.put('/api/service-provider/services',body,async(req,res,next)=>{try{const me=await identity(req),auth=await activeAuthorization(me.account.id,'service_provider');if(!auth)return res.status(403).json({error:'Service Provider approval required'});const allowed=await pool.query(`SELECT category_id FROM service_category_authorizations WHERE account_id=$1 AND status='active'`,[me.account.id]);const set=new Set(allowed.rows.map(x=>Number(x.category_id)));const requested=Array.isArray(req.body?.services)?req.body.services:[];const filtered=requested.filter(x=>set.has(Number(x.category_id)));if(filtered.length!==requested.length)return res.status(403).json({error:'One or more selected service categories are not approved for this profile'});if(!authHardeningApp)return res.status(503).json({error:'Auth Hardening runtime is not ready'});req.body={...req.body,services:filtered};return authHardeningApp(req,res,next)}catch(e){next(e)}})

function proxy(req,res,next){
  if(!authHardeningApp)return res.status(503).json({error:'Auth Hardening runtime is not ready'});
  return authHardeningApp(req,res,next);
}
app.post('/api/governance/profiles/:role/start',body,async(req,res,next)=>{try{const me=await identity(req),role=clean(req.params.role,40);const assigned=await assignedOnboardingTerritory(me,req.body?.territory_id,role);const territoryId=Number(assigned.id);if(!['merchant','supplier','courier','service_provider'].includes(role))return res.status(400).json({error:'This profile does not use operational onboarding'});if(['supplier','courier'].includes(role)&&!me.account.is_test_account)return res.status(403).json({error:'This launch profile requires an invitation before onboarding can start'});const t=await pool.query(`SELECT id FROM territories WHERE id=$1 AND country_code=$2 AND status IN ('onboarding','active')`,[territoryId,me.account.country_code||'PH']);if(!t.rowCount)return res.status(409).json({error:'Choose an available operating territory'});const client=await pool.connect();try{await client.query('BEGIN');const a=await client.query(`INSERT INTO profile_applications(account_id,role,territory_id,status,application_data) VALUES($1,$2,$3,'application_started',$4::jsonb) ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked') DO UPDATE SET updated_at=NOW() RETURNING *`,[me.account.id,role,territoryId,JSON.stringify({onboarding_version:'person-first-v1'})]);await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,FALSE,'private','application_started') ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()`,[me.account.id,role]);await client.query('COMMIT');await audit(me.account.id,'profile_onboarding_started',me.account.id,role,territoryId,{application_id:a.rows[0].id});res.status(201).json(a.rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.use(proxy)
app.use((err,_req,res,_next)=>{const status=Number(err?.status)||500;if(status>=500)console.error(err);if(res.headersSent)return;if(err?.code==='HIGH_RISK_VELOCITY_LIMIT')res.set('Retry-After',String(Math.max(1,Number(err.retryAfterSeconds)||1)));const payload=err?.code==='HIGH_RISK_VELOCITY_LIMIT'?highRiskVelocityErrorBody(err):{error:status<500?err.message:'Unexpected governance error'};res.status(status).json(payload)})

let embeddedStartPromise=null;
export async function startEmbeddedProfileGovernance(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      authHardeningApp=await startEmbeddedAuthHardening();
      authHardeningReady=true;
      await initDb();
      console.log('Business & Life profile governance mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopProfileGovernance(){
  if(shuttingDown)return;
  shuttingDown=true;
  authHardeningReady=false;
  authHardeningApp=null;
  await stopEmbeddedAuthHardening().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedProfileGovernance(){await stopProfileGovernance()}

async function shutdown(sig){console.log(`Received ${sig}`);await stopProfileGovernance();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedProfileGovernance().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life profile governance gateway listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
}
