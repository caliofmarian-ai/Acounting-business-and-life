import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);
const sha=v=>crypto.createHash('sha256').update(String(v??''),'utf8').digest('hex');

export const LEGAL_DOCUMENT_DEFINITIONS=Object.freeze([
  {code:'platform_terms',title:'Platform Terms Framework',docClass:'terms',source:'PLATFORM_TERMS_FRAMEWORK.md',withdrawable:false},
  {code:'privacy_notice',title:'Privacy Notice Framework',docClass:'privacy',source:'PRIVACY_NOTICE_FRAMEWORK.md',withdrawable:false},
  {code:'code_of_conduct',title:'Code of Conduct',docClass:'community_rules',source:'CODE_OF_CONDUCT.md',withdrawable:false},
  {code:'merchant_agreement',title:'Merchant Agreement',docClass:'role_agreement',source:'MERCHANT_AGREEMENT.md',withdrawable:false},
  {code:'supplier_agreement',title:'Supplier Agreement',docClass:'role_agreement',source:'SUPPLIER_AGREEMENT.md',withdrawable:false},
  {code:'courier_agreement',title:'Courier Agreement',docClass:'role_agreement',source:'COURIER_AGREEMENT.md',withdrawable:false},
  {code:'service_provider_agreement',title:'Service Provider Agreement',docClass:'role_agreement',source:'SERVICE_PROVIDER_AGREEMENT.md',withdrawable:false},
  {code:'admin_confidentiality',title:'Admin Access & Confidentiality',docClass:'admin_agreement',source:'ADMIN_ACCESS_CONFIDENTIALITY.md',withdrawable:false},
  {code:'conflict_of_interest',title:'Conflict of Interest Declaration',docClass:'admin_agreement',source:'CONFLICT_OF_INTEREST_DECLARATION.md',withdrawable:false},
  {code:'evidence_truthfulness',title:'Evidence Truthfulness Declaration',docClass:'declaration',source:'EVIDENCE_TRUTHFULNESS_DECLARATION.md',withdrawable:false},
  {code:'training_sop_ack',title:'Training / SOP Acknowledgement',docClass:'training_ack',source:'TRAINING_SOP_ACKNOWLEDGEMENT.md',withdrawable:false},
  {code:'location_tracking_notice',title:'Location Tracking Notice',docClass:'privacy_consent',source:null,withdrawable:true},
  {code:'marketing_consent',title:'Marketing Communications Consent',docClass:'optional_consent',source:null,withdrawable:true},
  {code:'platform_fee_terms',title:'Platform Fee / Commercial Terms',docClass:'commercial_terms',source:null,withdrawable:false}
]);

export const LEGAL_REQUIREMENT_DEFINITIONS=Object.freeze([
  {action:'order.create',role:'customer',docs:['platform_terms','privacy_notice']},
  {action:'profile.submit',role:'merchant',docs:['merchant_agreement','code_of_conduct','evidence_truthfulness']},
  {action:'profile.submit',role:'supplier',docs:['supplier_agreement','code_of_conduct','evidence_truthfulness']},
  {action:'profile.submit',role:'courier',docs:['courier_agreement','code_of_conduct','location_tracking_notice']},
  {action:'profile.submit',role:'service_provider',docs:['service_provider_agreement','code_of_conduct','evidence_truthfulness']},
  {action:'admin.access',role:'admin',docs:['admin_confidentiality','conflict_of_interest']},
  {action:'location.share',role:'customer',docs:['privacy_notice','location_tracking_notice']},
  {action:'location.share',role:'courier',docs:['privacy_notice','location_tracking_notice']},
  {action:'marketing.opt_in',role:'*',docs:['marketing_consent']},
  {action:'platform_fee.accept',role:'merchant',docs:['platform_fee_terms']},
  {action:'platform_fee.accept',role:'supplier',docs:['platform_fee_terms']}
]);

export async function ensureLegalSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS legal_documents(
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      document_class TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'PH',
      authoritative_locale TEXT NOT NULL DEFAULT 'en-PH',
      withdrawable BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS legal_document_versions(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
      version_label TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'en-PH',
      content_markdown TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      authoritative BOOLEAN NOT NULL DEFAULT FALSE,
      translation_review_status TEXT NOT NULL DEFAULT 'not_applicable',
      legal_review_status TEXT NOT NULL DEFAULT 'pending',
      legal_review_reference TEXT NOT NULL DEFAULT '',
      reviewer_account_id BIGINT REFERENCES accounts(id),
      effective_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      source_ref TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id,version_label,locale),
      CHECK(status IN ('draft','review_pending','approved','active','superseded','withdrawn')),
      CHECK(translation_review_status IN ('not_applicable','pending','reviewed','rejected')),
      CHECK(legal_review_status IN ('pending','reviewed','rejected'))
    );
    CREATE INDEX IF NOT EXISTS legal_versions_current_idx ON legal_document_versions(document_id,status,locale,effective_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS legal_requirements(
      id BIGSERIAL PRIMARY KEY,
      action_code TEXT NOT NULL,
      role_scope TEXT NOT NULL DEFAULT '*',
      document_code TEXT NOT NULL REFERENCES legal_documents(code) ON DELETE CASCADE,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id) ON DELETE CASCADE,
      required BOOLEAN NOT NULL DEFAULT TRUE,
      blocking_mode TEXT NOT NULL DEFAULT 'hard',
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(blocking_mode IN ('hard','warning'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS legal_requirement_scope_unique
      ON legal_requirements(action_code,role_scope,document_code,country_code,COALESCE(territory_id,0));

    CREATE TABLE IF NOT EXISTS legal_acceptances(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      document_version_id BIGINT NOT NULL REFERENCES legal_document_versions(id) ON DELETE RESTRICT,
      state TEXT NOT NULL,
      role_context TEXT NOT NULL DEFAULT '',
      business_id BIGINT REFERENCES businesses(id),
      admin_assignment_id BIGINT REFERENCES platform_admin_assignments(id),
      territory_id BIGINT REFERENCES territories(id),
      action_code TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      content_sha256 TEXT NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT '',
      device_hash TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(state IN ('accepted','declined','withdrawn'))
    );
    CREATE INDEX IF NOT EXISTS legal_acceptance_account_idx ON legal_acceptances(account_id,document_version_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS legal_document_events(
      id BIGSERIAL PRIMARY KEY,
      actor_account_id BIGINT REFERENCES accounts(id),
      document_version_id BIGINT REFERENCES legal_document_versions(id),
      event_code TEXT NOT NULL,
      before_json JSONB,
      after_json JSONB,
      reason TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for(const d of LEGAL_DOCUMENT_DEFINITIONS){
    await pool.query(`
      INSERT INTO legal_documents(code,title,document_class,country_code,authoritative_locale,withdrawable)
      VALUES($1,$2,$3,'PH','en-PH',$4)
      ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,document_class=EXCLUDED.document_class,withdrawable=EXCLUDED.withdrawable,updated_at=NOW()
    `,[d.code,d.title,d.docClass,d.withdrawable]);
  }

  for(const r of LEGAL_REQUIREMENT_DEFINITIONS){
    for(const code of r.docs){
      await pool.query(`
        INSERT INTO legal_requirements(action_code,role_scope,document_code,country_code,required,blocking_mode)
        VALUES($1,$2,$3,'PH',TRUE,'hard')
        ON CONFLICT(action_code,role_scope,document_code,country_code,COALESCE(territory_id,0))
        DO UPDATE SET required=TRUE,blocking_mode='hard',updated_at=NOW()
      `,[r.action,r.role,code]);
    }
  }
}

export async function seedRepositoryLegalDrafts(pool,baseDir){
  for(const d of LEGAL_DOCUMENT_DEFINITIONS){
    if(!d.source)continue;
    let content='';
    try{content=readFileSync(join(baseDir,'docs','agreements',d.source),'utf8')}catch{continue}
    const digest=sha(content);
    const doc=await pool.query(`SELECT id FROM legal_documents WHERE code=$1`,[d.code]);
    if(!doc.rowCount)continue;
    const versionLabel=`repo-draft-${digest.slice(0,12)}`;
    await pool.query(`
      INSERT INTO legal_document_versions(
        document_id,version_label,locale,content_markdown,content_sha256,status,authoritative,
        translation_review_status,legal_review_status,source_ref
      ) VALUES($1,$2,'en-PH',$3,$4,'draft',TRUE,'not_applicable','pending',$5)
      ON CONFLICT(document_id,version_label,locale) DO NOTHING
    `,[doc.rows[0].id,versionLabel,content,digest,`docs/agreements/${d.source}`]);
  }
}

export function hashEvidence(value,secret=''){
  if(!value)return'';
  return crypto.createHmac('sha256',secret||'business-life-minimized-metadata').update(String(value)).digest('hex');
}

async function activeVersionFor(pool,documentCode,preferredLocale='en-PH'){
  const q=await pool.query(`
    SELECT v.*,d.code,d.title,d.document_class,d.authoritative_locale,d.withdrawable
    FROM legal_documents d
    JOIN legal_document_versions v ON v.document_id=d.id
    WHERE d.code=$1 AND d.country_code='PH' AND d.active=TRUE
      AND v.status='active'
      AND v.legal_review_status='reviewed'
      AND (v.effective_at IS NULL OR v.effective_at<=NOW())
      AND (
        v.locale=$2 OR
        (v.locale=d.authoritative_locale AND v.authoritative=TRUE)
      )
      AND (
        v.authoritative=TRUE OR v.translation_review_status='reviewed'
      )
    ORDER BY (v.locale=$2) DESC,v.authoritative DESC,v.effective_at DESC NULLS LAST,v.id DESC
    LIMIT 1
  `,[documentCode,preferredLocale]);
  return q.rows[0]||null;
}

async function latestAcceptance(pool,accountId,versionId,{actionCode='',role='',businessId=null,adminAssignmentId=null,territoryId=null}={}){
  const q=await pool.query(`
    SELECT * FROM legal_acceptances
    WHERE account_id=$1 AND document_version_id=$2
      AND action_code=$3 AND role_context=$4
      AND COALESCE(business_id,0)=COALESCE($5::bigint,0)
      AND COALESCE(admin_assignment_id,0)=COALESCE($6::bigint,0)
      AND COALESCE(territory_id,0)=COALESCE($7::bigint,0)
    ORDER BY created_at DESC,id DESC LIMIT 1
  `,[accountId,versionId,clean(actionCode,100),clean(role,40),businessId,adminAssignmentId,territoryId]);
  return q.rows[0]||null;
}

export async function resolveLegalGate(pool,accountId,{
  actionCode,role='*',territoryId=null,businessId=null,adminAssignmentId=null,preferredLocale='en-PH'
}){
  const params=[clean(actionCode,100),clean(role||'*',40)];
  let territoryClause='r.territory_id IS NULL';
  if(territoryId!=null){params.push(Number(territoryId));territoryClause=`(r.territory_id IS NULL OR r.territory_id=$${params.length})`}
  const req=await pool.query(`
    SELECT r.*,d.title,d.document_class,d.authoritative_locale,d.withdrawable
    FROM legal_requirements r JOIN legal_documents d ON d.code=r.document_code
    WHERE r.action_code=$1 AND r.country_code='PH' AND r.required=TRUE
      AND r.role_scope IN ($2,'*')
      AND ${territoryClause}
      AND r.effective_from<=NOW()
      AND (r.effective_until IS NULL OR r.effective_until>NOW())
    ORDER BY (r.role_scope=$2) DESC,r.id
  `,params);
  const requirements=[],missing=[],reviewPending=[];
  for(const r of req.rows){
    const v=await activeVersionFor(pool,r.document_code,preferredLocale);
    if(!v){
      reviewPending.push({document_code:r.document_code,title:r.title,reason:'No legally reviewed active version is published'});
      continue;
    }
    const accepted=await latestAcceptance(pool,accountId,Number(v.id),{actionCode,role,businessId,adminAssignmentId,territoryId});
    const item={
      document_code:r.document_code,title:r.title,document_class:r.document_class,
      version_id:Number(v.id),version_label:v.version_label,locale:v.locale,content_sha256:v.content_sha256,
      authoritative:Boolean(v.authoritative),fallback_locale:v.locale!==preferredLocale,blocking_mode:r.blocking_mode,
      accepted:Boolean(accepted&&accepted.state==='accepted'&&accepted.content_sha256===v.content_sha256),
      last_state:accepted?.state||null
    };
    requirements.push(item);
    if(!item.accepted&&r.blocking_mode==='hard')missing.push(item);
  }
  return{action_code:actionCode,role,territory_id:territoryId,business_id:businessId,admin_assignment_id:adminAssignmentId,preferred_locale:preferredLocale,requirements,missing,review_pending:reviewPending,blocked:missing.length>0};
}

export async function getCurrentLegalDocument(pool,code,preferredLocale='en-PH'){
  const v=await activeVersionFor(pool,code,preferredLocale);
  if(v)return{...v,review_required:false,fallback_locale:v.locale!==preferredLocale};
  const draft=await pool.query(`
    SELECT v.*,d.code,d.title,d.document_class,d.authoritative_locale,d.withdrawable
    FROM legal_documents d LEFT JOIN LATERAL(
      SELECT * FROM legal_document_versions x WHERE x.document_id=d.id
      ORDER BY CASE x.status WHEN 'active' THEN 0 WHEN 'approved' THEN 1 WHEN 'review_pending' THEN 2 ELSE 3 END,x.id DESC LIMIT 1
    ) v ON TRUE WHERE d.code=$1
  `,[code]);
  if(!draft.rowCount)return null;
  return{...draft.rows[0],review_required:true,fallback_locale:false};
}

export async function recordLegalAcceptance(pool,{
  accountId,versionId,state='accepted',role='',businessId=null,adminAssignmentId=null,territoryId=null,
  actionCode='',purpose='',contentSha256,ip='',device='',correlationId='',metadataSecret=''
}){
  const v=await pool.query(`
    SELECT v.*,d.code,d.withdrawable FROM legal_document_versions v
    JOIN legal_documents d ON d.id=v.document_id WHERE v.id=$1
  `,[Number(versionId)]);
  if(!v.rowCount)throw Object.assign(new Error('Legal document version not found'),{status:404});
  const version=v.rows[0];
  if(state==='accepted'){
    if(version.status!=='active'||version.legal_review_status!=='reviewed')throw Object.assign(new Error('Only a legally reviewed active document can be accepted'),{status:409});
    if(clean(contentSha256,64)!==version.content_sha256)throw Object.assign(new Error('Document changed. Reload the current version before accepting.'),{status:409});
  }else if(state==='withdrawn'&&!version.withdrawable){
    throw Object.assign(new Error('This acknowledgment is historical and cannot be withdrawn through optional-consent settings'),{status:409});
  }
  const q=await pool.query(`
    INSERT INTO legal_acceptances(
      account_id,document_version_id,state,role_context,business_id,admin_assignment_id,territory_id,
      action_code,purpose,content_sha256,ip_hash,device_hash,correlation_id,accepted_at,revoked_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      CASE WHEN $3='accepted' THEN NOW() END,
      CASE WHEN $3='withdrawn' THEN NOW() END)
    RETURNING *
  `,[
    accountId,Number(versionId),state,clean(role,40),businessId,adminAssignmentId,territoryId,
    clean(actionCode,100),clean(purpose,300),version.content_sha256,hashEvidence(ip,metadataSecret),hashEvidence(device,metadataSecret),
    clean(correlationId,120)
  ]);
  return q.rows[0];
}

export async function legalAcceptanceHistory(pool,accountId){
  const {rows}=await pool.query(`
    SELECT a.id,a.state,a.role_context,a.business_id,a.admin_assignment_id,a.territory_id,a.action_code,a.purpose,
      a.content_sha256,a.accepted_at,a.revoked_at,a.created_at,
      d.code document_code,d.title,v.version_label,v.locale,v.status version_status
    FROM legal_acceptances a
    JOIN legal_document_versions v ON v.id=a.document_version_id
    JOIN legal_documents d ON d.id=v.document_id
    WHERE a.account_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 500
  `,[accountId]);
  return rows;
}

export async function legalAdminOverview(pool){
  const [docs,requirements]=await Promise.all([
    pool.query(`
      SELECT d.id,d.code,d.title,d.document_class,d.authoritative_locale,d.withdrawable,d.active,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id',v.id,'version_label',v.version_label,'locale',v.locale,'status',v.status,
          'content_sha256',v.content_sha256,'authoritative',v.authoritative,
          'translation_review_status',v.translation_review_status,'legal_review_status',v.legal_review_status,
          'legal_review_reference',v.legal_review_reference,'effective_at',v.effective_at,'published_at',v.published_at,
          'source_ref',v.source_ref,'created_at',v.created_at
        ) ORDER BY v.id DESC) FILTER(WHERE v.id IS NOT NULL),'[]'::jsonb) versions
      FROM legal_documents d LEFT JOIN legal_document_versions v ON v.document_id=d.id
      WHERE d.country_code='PH' GROUP BY d.id ORDER BY d.document_class,d.title
    `),
    pool.query(`SELECT * FROM legal_requirements WHERE country_code='PH' ORDER BY action_code,role_scope,document_code`)
  ]);
  return{documents:docs.rows,requirements:requirements.rows};
}

export async function createLegalVersion(pool,{
  documentCode,versionLabel,locale='en-PH',content,authoritative=false,effectiveAt=null,sourceRef='',createdBy=null
}){
  const d=await pool.query(`SELECT * FROM legal_documents WHERE code=$1 AND country_code='PH'`,[clean(documentCode,100)]);
  if(!d.rowCount)throw Object.assign(new Error('Legal document definition not found'),{status:404});
  const body=String(content??'').trim();
  if(body.length<40)throw Object.assign(new Error('Legal document content is too short'),{status:400});
  const q=await pool.query(`
    INSERT INTO legal_document_versions(
      document_id,version_label,locale,content_markdown,content_sha256,status,authoritative,
      translation_review_status,legal_review_status,effective_at,source_ref,created_by_account_id
    ) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,'pending',$8,$9,$10)
    RETURNING *
  `,[
    d.rows[0].id,clean(versionLabel,80),clean(locale,32),body,sha(body),Boolean(authoritative),
    authoritative?'not_applicable':'pending',effectiveAt||null,clean(sourceRef,300),createdBy||null
  ]);
  return q.rows[0];
}

export async function reviewLegalVersion(pool,id,{actorAccountId,reviewType='legal',approved=true,reference='',reason=''}){
  const q=await pool.query(`SELECT * FROM legal_document_versions WHERE id=$1`,[Number(id)]);
  if(!q.rowCount)throw Object.assign(new Error('Legal version not found'),{status:404});
  const before=q.rows[0];
  if(reviewType==='translation'){
    if(before.authoritative)throw Object.assign(new Error('Authoritative source does not require translation review'),{status:409});
    const status=approved?'reviewed':'rejected';
    const up=await pool.query(`UPDATE legal_document_versions SET translation_review_status=$1,status=CASE WHEN $1='rejected' THEN 'review_pending' ELSE status END,updated_at=NOW() WHERE id=$2 RETURNING *`,[status,id]);
    await appendLegalEvent(pool,{actorAccountId,versionId:id,eventCode:`translation_${status}`,before,after:up.rows[0],reason});
    return up.rows[0];
  }
  if(!clean(reference,300))throw Object.assign(new Error('Legal review reference is required before approval'),{status:400});
  const review=approved?'reviewed':'rejected',status=approved?'approved':'review_pending';
  const up=await pool.query(`UPDATE legal_document_versions SET legal_review_status=$1,legal_review_reference=$2,reviewer_account_id=$3,status=$4,updated_at=NOW() WHERE id=$5 RETURNING *`,[review,clean(reference,300),actorAccountId,status,id]);
  await appendLegalEvent(pool,{actorAccountId,versionId:id,eventCode:approved?'legal_review_approved':'legal_review_rejected',before,after:up.rows[0],reason});
  return up.rows[0];
}

export async function activateLegalVersion(pool,id,{actorAccountId,reason='',effectiveAt=null,correlationId=''}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query(`
      SELECT v.*,d.code,d.authoritative_locale FROM legal_document_versions v
      JOIN legal_documents d ON d.id=v.document_id WHERE v.id=$1 FOR UPDATE
    `,[Number(id)]);
    if(!q.rowCount)throw Object.assign(new Error('Legal version not found'),{status:404});
    const v=q.rows[0];
    if(v.legal_review_status!=='reviewed'||!v.legal_review_reference)throw Object.assign(new Error('Legal review approval is required before activation'),{status:409});
    if(!v.authoritative&&v.translation_review_status!=='reviewed')throw Object.assign(new Error('Reviewed translation is required before translated legal copy can be activated'),{status:409});
    await client.query(`UPDATE legal_document_versions SET status='superseded',superseded_at=NOW(),updated_at=NOW() WHERE document_id=$1 AND locale=$2 AND status='active' AND id<>$3`,[v.document_id,v.locale,v.id]);
    const up=await client.query(`UPDATE legal_document_versions SET status='active',effective_at=COALESCE($1,effective_at,NOW()),published_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *`,[effectiveAt||null,v.id]);
    await client.query('COMMIT');
    await appendLegalEvent(pool,{actorAccountId,versionId:id,eventCode:'legal_version_activated',before:v,after:up.rows[0],reason,correlationId});
    return{...up.rows[0],document_code:v.code};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function withdrawLegalVersion(pool,id,{actorAccountId,reason='',correlationId=''}){
  const q=await pool.query(`SELECT * FROM legal_document_versions WHERE id=$1`,[Number(id)]);
  if(!q.rowCount)throw Object.assign(new Error('Legal version not found'),{status:404});
  const before=q.rows[0];
  const up=await pool.query(`UPDATE legal_document_versions SET status='withdrawn',updated_at=NOW() WHERE id=$1 RETURNING *`,[id]);
  await appendLegalEvent(pool,{actorAccountId,versionId:id,eventCode:'legal_version_withdrawn',before,after:up.rows[0],reason,correlationId});
  return up.rows[0];
}

export async function appendLegalEvent(pool,{actorAccountId,versionId,eventCode,before=null,after=null,reason='',correlationId=''}){
  await pool.query(`
    INSERT INTO legal_document_events(actor_account_id,document_version_id,event_code,before_json,after_json,reason,correlation_id)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
  `,[
    actorAccountId||null,versionId||null,clean(eventCode,120),
    before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),
    clean(reason,1200),clean(correlationId,120)
  ]).catch(()=>{});
}
