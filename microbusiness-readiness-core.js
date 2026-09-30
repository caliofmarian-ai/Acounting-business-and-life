export const MICROBUSINESS_READINESS_POLICY_VERSION='ph-microbusiness-readiness-v1';

export const MICROBUSINESS_ACTIVITY_TRACKS=Object.freeze(['food','non_food','local_services']);
export const MICROBUSINESS_OPERATING_CONTEXTS=Object.freeze([
  'private_property',
  'commercial_space',
  'authorized_sidewalk',
  'home_based',
  'customer_locations',
  'unknown_or_other'
]);
export const MICROBUSINESS_READINESS_STAGES=Object.freeze([
  'starting',
  'building_records',
  'getting_ready',
  'applying',
  'verified',
  'growing'
]);
export const MICROBUSINESS_COMMERCE_STATES=Object.freeze([
  'readiness_only',
  'eligible_limited',
  'eligible_full'
]);

const SELF_SERVICE_STAGES=new Set(['starting','building_records','getting_ready','applying']);
const TRACKS=new Set(MICROBUSINESS_ACTIVITY_TRACKS);
const CONTEXTS=new Set(MICROBUSINESS_OPERATING_CONTEXTS);
const STAGES=new Set(MICROBUSINESS_READINESS_STAGES);
const COMMERCE_STATES=new Set(MICROBUSINESS_COMMERCE_STATES);
const ROLES=new Set(['merchant','service_provider']);
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

function positiveId(value,label='identifier'){
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error(label+' is invalid'),{status:400});
  return id;
}

function normalizeRole(value){
  const role=clean(value,40);
  if(!ROLES.has(role))throw Object.assign(new Error('Microbusiness readiness is available only for Merchant or Local Services'),{status:400});
  return role;
}

function normalizeBusinessId(value){
  if(value==null||value==='')return null;
  return positiveId(value,'Business identifier');
}

function allowedTrackForRole(role,track){
  if(role==='merchant')return track==='food'||track==='non_food';
  return role==='service_provider'&&track==='local_services';
}

export function microbusinessReadinessEnforcementEnabled(env=process.env){
  const value=clean(env?.MICROBUSINESS_READINESS_ENFORCEMENT,20).toLowerCase();
  return ['1','true','yes','on','enabled'].includes(value);
}

export function microbusinessReadinessState(row={}){
  const profileRole=ROLES.has(clean(row.profile_role,40))?clean(row.profile_role,40):'merchant';
  const activityTrack=TRACKS.has(clean(row.activity_track,40))?clean(row.activity_track,40):'';
  const operatingContext=CONTEXTS.has(clean(row.operating_context,60))?clean(row.operating_context,60):'';
  const stage=STAGES.has(clean(row.readiness_stage,40))?clean(row.readiness_stage,40):'starting';
  const commerceState=COMMERCE_STATES.has(clean(row.commerce_state,40))?clean(row.commerce_state,40):'readiness_only';
  return Object.freeze({
    id:Number(row.id)||null,
    persisted:Boolean(row.id),
    account_id:Number(row.account_id)||null,
    profile_role:profileRole,
    business_id:Number(row.business_id)||null,
    activity_track:activityTrack,
    operating_context:operatingContext,
    readiness_stage:stage,
    commerce_state:commerceState,
    commerce_scope:row.commerce_scope_json&&typeof row.commerce_scope_json==='object'?row.commerce_scope_json:{},
    eligibility_reviewed_at:row.eligibility_reviewed_at||null,
    eligibility_reviewed_by_account_id:Number(row.eligibility_reviewed_by_account_id)||null,
    eligibility_reason:clean(row.eligibility_reason,500),
    source:clean(row.source,80)||'readiness_runtime',
    policy_version:clean(row.policy_version,80)||MICROBUSINESS_READINESS_POLICY_VERSION,
    created_at:row.created_at||null,
    updated_at:row.updated_at||null
  });
}

export function microbusinessCommerceDecision(state,{enforcementEnabled=microbusinessReadinessEnforcementEnabled()}={}){
  const normalized=microbusinessReadinessState(state||{});
  if(!enforcementEnabled){
    return Object.freeze({
      allowed:true,
      enforcement_enabled:false,
      reason:'enforcement_disabled',
      commerce_state:normalized.commerce_state,
      readiness:normalized
    });
  }
  if(!normalized.persisted){
    return Object.freeze({
      allowed:false,
      enforcement_enabled:true,
      reason:'readiness_state_missing',
      commerce_state:'readiness_only',
      readiness:normalized
    });
  }
  if(['eligible_limited','eligible_full'].includes(normalized.commerce_state)){
    return Object.freeze({
      allowed:true,
      enforcement_enabled:true,
      reason:normalized.commerce_state,
      commerce_state:normalized.commerce_state,
      readiness:normalized
    });
  }
  return Object.freeze({
    allowed:false,
    enforcement_enabled:true,
    reason:'readiness_only',
    commerce_state:normalized.commerce_state,
    readiness:normalized
  });
}

export function nextMicrobusinessReadinessAction(state={}){
  const current=microbusinessReadinessState(state);
  if(!current.activity_track)return 'choose_activity_track';
  if(!current.operating_context)return 'add_operating_context';
  if(current.readiness_stage==='starting')return 'start_building_records';
  if(current.readiness_stage==='building_records')return 'review_readiness_steps';
  if(current.readiness_stage==='getting_ready')return 'prepare_applications';
  if(current.readiness_stage==='applying')return 'track_application_progress';
  if(current.readiness_stage==='verified')return 'review_commerce_capabilities';
  return 'grow_business';
}

export async function ensureMicrobusinessReadinessSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS microbusiness_readiness (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL,
      business_id BIGINT,
      activity_track TEXT NOT NULL DEFAULT '',
      operating_context TEXT NOT NULL DEFAULT '',
      readiness_stage TEXT NOT NULL DEFAULT 'starting',
      commerce_state TEXT NOT NULL DEFAULT 'readiness_only',
      commerce_scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      eligibility_reviewed_at TIMESTAMPTZ,
      eligibility_reviewed_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      eligibility_reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'readiness_runtime',
      policy_version TEXT NOT NULL DEFAULT 'ph-microbusiness-readiness-v1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(profile_role IN ('merchant','service_provider')),
      CHECK(activity_track IN ('','food','non_food','local_services')),
      CHECK(operating_context IN ('','private_property','commercial_space','authorized_sidewalk','home_based','customer_locations','unknown_or_other')),
      CHECK(readiness_stage IN ('starting','building_records','getting_ready','applying','verified','growing')),
      CHECK(commerce_state IN ('readiness_only','eligible_limited','eligible_full'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS microbusiness_readiness_account_profile_idx
      ON microbusiness_readiness(account_id,profile_role)
      WHERE business_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS microbusiness_readiness_business_profile_idx
      ON microbusiness_readiness(business_id,profile_role)
      WHERE business_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS microbusiness_readiness_commerce_idx
      ON microbusiness_readiness(profile_role,commerce_state,updated_at DESC);

    CREATE TABLE IF NOT EXISTS microbusiness_readiness_events (
      id BIGSERIAL PRIMARY KEY,
      readiness_id BIGINT REFERENCES microbusiness_readiness(id) ON DELETE SET NULL,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      event_code TEXT NOT NULL,
      before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS microbusiness_readiness_events_subject_idx
      ON microbusiness_readiness_events(account_id,created_at DESC);
  `);

  const businessTable=await pool.query("SELECT to_regclass('public.businesses') AS table_name");
  if(businessTable.rows[0]?.table_name){
    const fk=await pool.query(
      "SELECT 1 FROM pg_constraint WHERE conname='microbusiness_readiness_business_fk' LIMIT 1"
    );
    if(!fk.rowCount){
      await pool.query(
        "ALTER TABLE microbusiness_readiness ADD CONSTRAINT microbusiness_readiness_business_fk "+
        "FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE"
      );
    }
  }
}

async function subjectOwnership(pool,{accountId,profileRole,businessId}){
  const account=positiveId(accountId,'Account identifier');
  const role=normalizeRole(profileRole);
  const business=normalizeBusinessId(businessId);
  if(business!=null){
    if(role!=='merchant')throw Object.assign(new Error('Local Services readiness is profile-scoped and must not be bound to a Merchant business'),{status:400});
    const membership=await pool.query(
      'SELECT 1 FROM business_memberships WHERE account_id=$1 AND business_id=$2 AND active=TRUE LIMIT 1',
      [account,business]
    );
    if(!membership.rowCount)throw Object.assign(new Error('Business workspace not available for this account'),{status:403});
    return{accountId:account,profileRole:role,businessId:business};
  }
  const profile=await pool.query(
    'SELECT 1 FROM profiles WHERE account_id=$1 AND role=$2 LIMIT 1',
    [account,role]
  );
  const application=await pool.query(
    'SELECT 1 FROM profile_applications WHERE account_id=$1 AND role=$2 LIMIT 1',
    [account,role]
  ).catch(error=>error?.code==='42P01'?{rowCount:0,rows:[]}:Promise.reject(error));
  if(!profile.rowCount&&!application.rowCount)throw Object.assign(new Error('Start this profile before opening its readiness journey'),{status:409});
  return{accountId:account,profileRole:role,businessId:null};
}

async function readSubjectRow(pool,{accountId=null,profileRole,businessId=null}){
  const role=normalizeRole(profileRole);
  const business=normalizeBusinessId(businessId);
  if(business!=null){
    const q=await pool.query(
      `SELECT * FROM microbusiness_readiness
        WHERE profile_role=$1 AND business_id=$2
        ORDER BY updated_at DESC LIMIT 1`,
      [role,business]
    );
    return q.rows[0]||null;
  }
  if(accountId==null)return null;
  const account=positiveId(accountId,'Account identifier');
  const q=await pool.query(
    `SELECT * FROM microbusiness_readiness
      WHERE account_id=$1 AND profile_role=$2 AND business_id IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [account,role]
  );
  return q.rows[0]||null;
}

export async function microbusinessReadinessSnapshot(pool,{accountId=null,profileRole,businessId=null,verifyOwnership=false}={}){
  await ensureMicrobusinessReadinessSchema(pool);
  const role=normalizeRole(profileRole);
  const account=accountId==null?null:positiveId(accountId,'Account identifier');
  const business=normalizeBusinessId(businessId);
  if(verifyOwnership){
    if(account==null)throw Object.assign(new Error('Account identifier is required'),{status:400});
    await subjectOwnership(pool,{accountId:account,profileRole:role,businessId:business});
  }
  let row=await readSubjectRow(pool,{accountId:account,profileRole:role,businessId:business});
  if(!row&&business!=null&&account!=null){
    row=await readSubjectRow(pool,{accountId:account,profileRole:role,businessId:null});
  }
  const state=microbusinessReadinessState(row||{
    account_id:account,
    profile_role:role,
    business_id:business,
    activity_track:role==='service_provider'?'local_services':'',
    readiness_stage:'starting',
    commerce_state:'readiness_only',
    source:'default_readiness'
  });
  return{
    ...state,
    next_action_code:nextMicrobusinessReadinessAction(state),
    enforcement_enabled:microbusinessReadinessEnforcementEnabled()
  };
}

async function appendReadinessEvent(pool,{state,accountId,actorAccountId,eventCode,before,after,source}){
  await pool.query(
    `INSERT INTO microbusiness_readiness_events(
       readiness_id,account_id,actor_account_id,event_code,before_json,after_json,source
     ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      state?.id||null,
      positiveId(accountId,'Account identifier'),
      actorAccountId==null?null:positiveId(actorAccountId,'Actor identifier'),
      clean(eventCode,80),
      JSON.stringify(before||{}),
      JSON.stringify(after||{}),
      clean(source,80)
    ]
  );
}

async function ensureSubjectRow(pool,{accountId,profileRole,businessId}){
  const subject=await subjectOwnership(pool,{accountId,profileRole,businessId});
  const existing=await readSubjectRow(pool,subject);
  if(existing)return existing;

  let seed=null;
  if(subject.businessId!=null){
    seed=await readSubjectRow(pool,{accountId:subject.accountId,profileRole:subject.profileRole,businessId:null});
  }
  const seedState=microbusinessReadinessState(seed||{
    account_id:subject.accountId,
    profile_role:subject.profileRole,
    business_id:subject.businessId,
    activity_track:subject.profileRole==='service_provider'?'local_services':'',
    readiness_stage:'starting',
    commerce_state:'readiness_only'
  });
  const inserted=await pool.query(
    `INSERT INTO microbusiness_readiness(
       account_id,profile_role,business_id,activity_track,operating_context,readiness_stage,
       commerce_state,commerce_scope_json,source,policy_version
     ) VALUES($1,$2,$3,$4,$5,$6,'readiness_only','{}'::jsonb,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      subject.accountId,subject.profileRole,subject.businessId,
      seedState.activity_track,seedState.operating_context,
      SELF_SERVICE_STAGES.has(seedState.readiness_stage)?seedState.readiness_stage:'starting',
      seed?'account_to_business_migration':'readiness_created',
      MICROBUSINESS_READINESS_POLICY_VERSION
    ]
  );
  if(inserted.rowCount)return inserted.rows[0];
  const reread=await readSubjectRow(pool,subject);
  if(!reread)throw Object.assign(new Error('Readiness state could not be created'),{status:409});
  return reread;
}

export async function updateMicrobusinessReadiness(pool,accountId,input={}){
  await ensureMicrobusinessReadinessSchema(pool);
  if(Object.prototype.hasOwnProperty.call(input,'commerce_state')
    ||Object.prototype.hasOwnProperty.call(input,'commerce_scope')
    ||Object.prototype.hasOwnProperty.call(input,'eligibility_reviewed_at')
    ||Object.prototype.hasOwnProperty.call(input,'eligibility_reason')){
    throw Object.assign(new Error('Commerce eligibility can only be changed through a governed review'),{status:403,code:'COMMERCE_ELIGIBILITY_GOVERNED'});
  }

  const profileRole=normalizeRole(input.profile_role);
  const businessId=normalizeBusinessId(input.business_id);
  const row=await ensureSubjectRow(pool,{accountId,profileRole,businessId});
  const before=microbusinessReadinessState(row);

  const track=Object.prototype.hasOwnProperty.call(input,'activity_track')?clean(input.activity_track,40):before.activity_track;
  if(track&&!TRACKS.has(track))throw Object.assign(new Error('Unknown microbusiness activity track'),{status:400});
  if(track&&!allowedTrackForRole(profileRole,track))throw Object.assign(new Error(profileRole==='merchant'?'Merchant readiness track must be Food or Non-food':'Local Services readiness uses the Local Services track'),{status:400});

  const context=Object.prototype.hasOwnProperty.call(input,'operating_context')?clean(input.operating_context,60):before.operating_context;
  if(context&&!CONTEXTS.has(context))throw Object.assign(new Error('Unknown operating context'),{status:400});

  const stage=Object.prototype.hasOwnProperty.call(input,'readiness_stage')?clean(input.readiness_stage,40):before.readiness_stage;
  if(!SELF_SERVICE_STAGES.has(stage))throw Object.assign(new Error('Verified and Growing stages require governed evidence and cannot be self-declared'),{status:403,code:'READINESS_STAGE_GOVERNED'});

  const source=clean(input.source,80)||'user_readiness';
  const updated=await pool.query(
    `UPDATE microbusiness_readiness
        SET activity_track=$1,
            operating_context=$2,
            readiness_stage=$3,
            source=$4,
            policy_version=$5,
            updated_at=NOW()
      WHERE id=$6
      RETURNING *`,
    [track,context,stage,source,MICROBUSINESS_READINESS_POLICY_VERSION,row.id]
  );
  const after=microbusinessReadinessState(updated.rows[0]);
  await appendReadinessEvent(pool,{
    state:after,
    accountId:before.account_id,
    actorAccountId:accountId,
    eventCode:'readiness_self_service_updated',
    before,
    after,
    source
  });
  return{
    ...after,
    next_action_code:nextMicrobusinessReadinessAction(after),
    enforcement_enabled:microbusinessReadinessEnforcementEnabled()
  };
}

export async function setMicrobusinessCommerceState(pool,{
  accountId,
  profileRole,
  businessId=null,
  actorAccountId,
  commerceState,
  reason='',
  commerceScope={}
}={}){
  await ensureMicrobusinessReadinessSchema(pool);
  const stateValue=clean(commerceState,40);
  if(!COMMERCE_STATES.has(stateValue))throw Object.assign(new Error('Unknown commerce eligibility state'),{status:400});
  const row=await ensureSubjectRow(pool,{accountId,profileRole,businessId});
  const before=microbusinessReadinessState(row);
  const governedStage=stateValue==='readiness_only'
    ?(SELF_SERVICE_STAGES.has(before.readiness_stage)?before.readiness_stage:'getting_ready')
    :(before.readiness_stage==='growing'?'growing':'verified');
  const updated=await pool.query(
    `UPDATE microbusiness_readiness
        SET commerce_state=$1,
            commerce_scope_json=$2::jsonb,
            eligibility_reviewed_at=NOW(),
            eligibility_reviewed_by_account_id=$3,
            eligibility_reason=$4,
            readiness_stage=$5,
            source='governed_review',
            policy_version=$6,
            updated_at=NOW()
      WHERE id=$7
      RETURNING *`,
    [
      stateValue,JSON.stringify(commerceScope||{}),
      positiveId(actorAccountId,'Reviewer identifier'),
      clean(reason,500),governedStage,
      MICROBUSINESS_READINESS_POLICY_VERSION,row.id
    ]
  );
  const after=microbusinessReadinessState(updated.rows[0]);
  await appendReadinessEvent(pool,{
    state:after,
    accountId:after.account_id,
    actorAccountId,
    eventCode:'commerce_eligibility_reviewed',
    before,
    after,
    source:'governed_review'
  });
  return after;
}

export async function requireMicrobusinessCommerceEligibility(pool,{
  accountId=null,
  profileRole,
  businessId=null,
  action='use public commerce',
  enforcementEnabled=microbusinessReadinessEnforcementEnabled()
}={}){
  const readiness=await microbusinessReadinessSnapshot(pool,{accountId,profileRole,businessId});
  const decision=microbusinessCommerceDecision(readiness,{enforcementEnabled});
  if(decision.allowed)return decision;
  throw Object.assign(
    new Error('This business is still in readiness mode. Public commerce unlocks only after the required review for this activity and operating context.'),
    {
      status:409,
      code:'MICROBUSINESS_READINESS_REQUIRED',
      action:clean(action,120),
      decision,
      readiness
    }
  );
}

export async function filterCommerceEligibleBusinessIds(pool,businessIds,{enforcementEnabled=microbusinessReadinessEnforcementEnabled()}={}){
  const ids=[...new Set((businessIds||[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))];
  if(!enforcementEnabled)return new Set(ids);
  if(!ids.length)return new Set();
  await ensureMicrobusinessReadinessSchema(pool);
  const q=await pool.query(
    `SELECT DISTINCT business_id
       FROM microbusiness_readiness
      WHERE profile_role='merchant'
        AND business_id=ANY($1::bigint[])
        AND commerce_state IN ('eligible_limited','eligible_full')`,
    [ids]
  );
  return new Set(q.rows.map(row=>Number(row.business_id)));
}


export async function filterCommerceEligibleServiceProviderIds(pool,accountIds,{enforcementEnabled=microbusinessReadinessEnforcementEnabled()}={}){
  const ids=[...new Set((accountIds||[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))];
  if(!enforcementEnabled)return new Set(ids);
  if(!ids.length)return new Set();
  await ensureMicrobusinessReadinessSchema(pool);
  const q=await pool.query(
    `SELECT DISTINCT account_id
       FROM microbusiness_readiness
      WHERE profile_role='service_provider'
        AND business_id IS NULL
        AND account_id=ANY($1::bigint[])
        AND commerce_state IN ('eligible_limited','eligible_full')`,
    [ids]
  );
  return new Set(q.rows.map(row=>Number(row.account_id)));
}
