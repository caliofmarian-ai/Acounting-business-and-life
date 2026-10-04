export const MICROBUSINESS_READINESS_POLICY_VERSION='ph-microbusiness-readiness-v2';

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

export const MICROBUSINESS_READINESS_REVIEW_ITEMS=Object.freeze({
  activity_scope_confirmed:Object.freeze({
    code:'activity_scope_confirmed',
    label:'Activity scope confirmed',
    description:'Confirm that the declared Food, Non-food or Local Services activity matches the actual activity being reviewed.',
    allow_not_applicable:false
  }),
  operating_context_confirmed:Object.freeze({
    code:'operating_context_confirmed',
    label:'Operating context confirmed',
    description:'Confirm the actual operating context and that it matches the location model already stored by Business & Life.',
    allow_not_applicable:false
  }),
  business_registration_requirements:Object.freeze({
    code:'business_registration_requirements',
    label:'Business registration requirements resolved',
    description:'Resolve which business-registration requirements apply to this exact activity and location. Record verified evidence or a sourced not-applicable decision.',
    allow_not_applicable:true
  }),
  location_permission_requirements:Object.freeze({
    code:'location_permission_requirements',
    label:'Location / vending authority requirements resolved',
    description:'Resolve whether the operating location needs property, market, vending-space or other location authority. Record verified evidence or a sourced not-applicable decision.',
    allow_not_applicable:true
  }),
  food_safety_requirements:Object.freeze({
    code:'food_safety_requirements',
    label:'Food safety / sanitary requirements resolved',
    description:'For Food activity, resolve the applicable food-safety, sanitary and health requirements. Small size never bypasses an applicable food-safety requirement.',
    allow_not_applicable:true
  }),
  regulated_goods_requirements:Object.freeze({
    code:'regulated_goods_requirements',
    label:'Regulated-goods requirements resolved',
    description:'For Non-food activity, resolve whether the goods/category needs a permit, licence, restricted-goods control or other regulated-product evidence.',
    allow_not_applicable:true
  }),
  service_category_requirements:Object.freeze({
    code:'service_category_requirements',
    label:'Service category scope resolved',
    description:'Confirm the exact Local Services categories/tasks that are being enabled and their existing platform category authorization.',
    allow_not_applicable:false
  }),
  professional_licence_requirements:Object.freeze({
    code:'professional_licence_requirements',
    label:'Professional / regulatory credential requirements resolved',
    description:'Resolve whether the exact service task requires a professional or government credential. Business & Life must never treat profile approval as that licence.',
    allow_not_applicable:true
  }),
  tax_record_requirements:Object.freeze({
    code:'tax_record_requirements',
    label:'Tax / receipt record requirements resolved',
    description:'Resolve the applicable registration, invoice/receipt or record-keeping requirements from the competent authority without claiming Business & Life filed or paid them.',
    allow_not_applicable:true
  })
});

const REVIEW_OUTCOMES=new Set(['verified','not_applicable']);
const REVIEW_COMMON=Object.freeze([
  'activity_scope_confirmed',
  'operating_context_confirmed',
  'business_registration_requirements',
  'tax_record_requirements'
]);
const REVIEW_BY_TRACK=Object.freeze({
  food:Object.freeze(['location_permission_requirements','food_safety_requirements']),
  non_food:Object.freeze(['location_permission_requirements','regulated_goods_requirements']),
  local_services:Object.freeze(['service_category_requirements','professional_licence_requirements'])
});

export function microbusinessReadinessReviewRequirements({profile_role='',activity_track='',operating_context=''}={}){
  const role=clean(profile_role,40);
  const track=clean(activity_track,40);
  const context=clean(operating_context,60);
  if(!ROLES.has(role))return[];
  if(!track||!context||!allowedTrackForRole(role,track))return[];
  const codes=[...REVIEW_COMMON,...(REVIEW_BY_TRACK[track]||[])];
  return codes.map(code=>({
    ...MICROBUSINESS_READINESS_REVIEW_ITEMS[code],
    operating_context:context||''
  }));
}

function normalizeEvidenceItem(raw={}){
  return{
    code:clean(raw.code,80),
    outcome:clean(raw.outcome,30),
    reference:clean(raw.reference,240),
    source_authority:clean(raw.source_authority,200),
    note:clean(raw.note,500)
  };
}

function evidenceBlocker(requirement,item,errorCode,field,message,status=400){
  return Object.freeze({
    requirement_code:requirement.code,
    label:requirement.label,
    error_code:errorCode,
    field,
    message,
    status,
    source_authority_required:true,
    reference_required:item?.outcome==='verified',
    note_required:item?.outcome==='not_applicable',
    allow_not_applicable:Boolean(requirement.allow_not_applicable)
  });
}

export function assessMicrobusinessEligibilityEvidence(state,evidenceChecklist=[]){
  const normalized=microbusinessReadinessState(state||{});
  const requirements=microbusinessReadinessReviewRequirements(normalized);
  if(!requirements.length){
    return Object.freeze({
      context_ready:false,
      complete:false,
      total_count:0,
      resolved_count:0,
      missing:[],
      accepted_evidence:[],
      blockers:Object.freeze([Object.freeze({
        requirement_code:null,
        label:'Business setup',
        error_code:'READINESS_CONTEXT_REQUIRED',
        field:'activity_track_or_operating_context',
        message:'Complete the activity type and operating context before commerce eligibility can be reviewed.',
        status:409,
        source_authority_required:false,
        reference_required:false,
        note_required:false,
        allow_not_applicable:false
      })]),
      items:Object.freeze([])
    });
  }
  const items=Array.isArray(evidenceChecklist)?evidenceChecklist.map(normalizeEvidenceItem):[];
  const byCode=new Map(items.map(item=>[item.code,item]));
  const blockers=[];
  const missing=[];
  const assessed=[];
  const accepted=[];
  let resolvedCount=0;

  for(const requirement of requirements){
    const item=byCode.get(requirement.code)||normalizeEvidenceItem({code:requirement.code});
    const itemBlockers=[];
    if(!REVIEW_OUTCOMES.has(item.outcome)){
      missing.push(requirement.code);
      itemBlockers.push(evidenceBlocker(
        requirement,item,'READINESS_EVIDENCE_INCOMPLETE','outcome',
        requirement.label+': choose Verified, or Not applicable only when the review allows it.',409
      ));
    }else if(item.outcome==='not_applicable'&&!requirement.allow_not_applicable){
      itemBlockers.push(evidenceBlocker(
        requirement,item,'READINESS_EVIDENCE_NOT_APPLICABLE_DENIED','outcome',
        requirement.label+' must be verified for this review and cannot be marked Not applicable.'
      ));
    }else if(item.outcome==='verified'&&!item.reference){
      itemBlockers.push(evidenceBlocker(
        requirement,item,'READINESS_EVIDENCE_REFERENCE_REQUIRED','reference',
        requirement.label+': identify the evidence or platform/official record you checked.'
      ));
    }else if(!item.source_authority){
      itemBlockers.push(evidenceBlocker(
        requirement,item,'READINESS_EVIDENCE_SOURCE_REQUIRED','source_authority',
        requirement.label+': name the issuer, competent authority, official source or Business & Life platform record that supports this decision.'
      ));
    }else if(item.outcome==='not_applicable'&&!item.note){
      itemBlockers.push(evidenceBlocker(
        requirement,item,'READINESS_EVIDENCE_NA_SOURCE_REQUIRED','note',
        requirement.label+': explain why the sourced requirement does not apply to this exact business.'
      ));
    }

    const resolved=itemBlockers.length===0;
    if(resolved){
      resolvedCount+=1;
      accepted.push(item);
    }else blockers.push(...itemBlockers);
    assessed.push(Object.freeze({
      ...requirement,
      evidence:item,
      resolved,
      blockers:Object.freeze(itemBlockers)
    }));
  }

  return Object.freeze({
    context_ready:true,
    complete:resolvedCount===requirements.length,
    total_count:requirements.length,
    resolved_count:resolvedCount,
    missing:Object.freeze(missing),
    accepted_evidence:Object.freeze(accepted),
    blockers:Object.freeze(blockers),
    items:Object.freeze(assessed)
  });
}

export function microbusinessReadinessReviewStatus(state,evidenceChecklist=[]){
  const normalized=microbusinessReadinessState(state||{});
  const requirements=microbusinessReadinessReviewRequirements(normalized);
  const items=Array.isArray(evidenceChecklist)?evidenceChecklist.map(normalizeEvidenceItem):[];
  const byCode=new Map(items.map(item=>[item.code,item]));
  const checks=requirements.map(requirement=>{
    const item=byCode.get(requirement.code)||normalizeEvidenceItem({code:requirement.code});
    const missing_fields=[];
    let blocker_code='';
    if(!REVIEW_OUTCOMES.has(item.outcome)){
      missing_fields.push('outcome');
      blocker_code='outcome_required';
    }else{
      if(item.outcome==='not_applicable'&&!requirement.allow_not_applicable){
        missing_fields.push('outcome');
        blocker_code='not_applicable_not_allowed';
      }
      if(item.outcome==='verified'&&!item.reference){
        missing_fields.push('reference');
        blocker_code=blocker_code||'reference_required';
      }
      if(!item.source_authority){
        missing_fields.push('source_authority');
        blocker_code=blocker_code||'source_authority_required';
      }
      if(item.outcome==='not_applicable'&&!item.note){
        missing_fields.push('note');
        blocker_code=blocker_code||'not_applicable_reason_required';
      }
    }
    return Object.freeze({
      code:requirement.code,
      label:requirement.label,
      description:requirement.description,
      allow_not_applicable:Boolean(requirement.allow_not_applicable),
      outcome:item.outcome,
      reference:item.reference,
      source_authority:item.source_authority,
      note:item.note,
      complete:missing_fields.length===0,
      missing_fields:Object.freeze([...new Set(missing_fields)]),
      blocker_code:blocker_code||null
    });
  });
  const resolved=checks.filter(item=>item.complete).length;
  const contextComplete=requirements.length>0;
  return Object.freeze({
    context_complete:contextComplete,
    total:requirements.length,
    resolved,
    complete:contextComplete&&resolved===requirements.length,
    checks:Object.freeze(checks),
    missing:Object.freeze(checks.filter(item=>!item.complete))
  });
}

export function microbusinessCommerceReviewPolicy(state,evidenceChecklist=[],{profileAuthorized=false}={}){
  const normalized=microbusinessReadinessState(state||{});
  const review=microbusinessReadinessReviewStatus(normalized,evidenceChecklist);
  const blockers=[];
  if(!review.context_complete){
    blockers.push(Object.freeze({
      code:'readiness_context_required',
      label:'Activity and operating context are required',
      description:'Set the activity track and operating context before a commerce eligibility decision.'
    }));
  }
  if(!profileAuthorized){
    blockers.push(Object.freeze({
      code:'profile_authorization_required',
      label:'Active Profile Authorization is required',
      description:'Profile approval is a separate prerequisite and does not itself grant public commerce.'
    }));
  }
  for(const item of review.missing){
    blockers.push(Object.freeze({
      code:item.code,
      label:item.label,
      description:item.description,
      missing_fields:item.missing_fields,
      blocker_code:item.blocker_code
    }));
  }
  const canGrant=Boolean(profileAuthorized)&&review.complete;
  return Object.freeze({
    profile_authorized:Boolean(profileAuthorized),
    can_keep_readiness_only:true,
    can_grant_commerce:canGrant,
    allowed_states:Object.freeze({
      readiness_only:true,
      eligible_limited:canGrant,
      eligible_full:canGrant
    }),
    review_status:review,
    blockers:Object.freeze(blockers)
  });
}

export function validateMicrobusinessEligibilityEvidence(state,evidenceChecklist=[]){
  const review=microbusinessReadinessReviewStatus(state,evidenceChecklist);
  if(!review.context_complete){
    throw Object.assign(
      new Error('Complete the activity track and operating context before commerce eligibility review'),
      {status:409,code:'READINESS_CONTEXT_REQUIRED',review_status:review}
    );
  }
  const first=review.missing[0];
  if(first){
    const requirement=first.code;
    if(first.blocker_code==='not_applicable_not_allowed'){
      throw Object.assign(new Error(first.label+' cannot be marked not applicable'),{
        status:400,code:'READINESS_EVIDENCE_NOT_APPLICABLE_DENIED',requirement,review_status:review
      });
    }
    if(first.blocker_code==='reference_required'){
      throw Object.assign(new Error(first.label+' requires an evidence/reference identifier'),{
        status:400,code:'READINESS_EVIDENCE_REFERENCE_REQUIRED',requirement,review_status:review
      });
    }
    if(first.blocker_code==='source_authority_required'){
      throw Object.assign(new Error(first.label+' requires the source or authority used for the decision'),{
        status:400,code:'READINESS_EVIDENCE_SOURCE_REQUIRED',requirement,review_status:review
      });
    }
    if(first.blocker_code==='not_applicable_reason_required'){
      throw Object.assign(new Error(first.label+' needs a source/authority and reason when marked not applicable'),{
        status:400,code:'READINESS_EVIDENCE_NA_SOURCE_REQUIRED',requirement,review_status:review
      });
    }
    throw Object.assign(
      new Error('Resolve every required readiness review item before commerce eligibility can be granted'),
      {status:409,code:'READINESS_EVIDENCE_INCOMPLETE',missing:review.missing.map(item=>item.code),review_status:review}
    );
  }
  return review.checks.map(item=>normalizeEvidenceItem(item));
}

export function microbusinessReadinessEnforcementMode(env=process.env){
  const value=clean(env?.MICROBUSINESS_READINESS_ENFORCEMENT,40).toLowerCase();
  if(['transition','transitional','new_only'].includes(value))return'transition';
  if(['1','true','yes','on','enabled','full'].includes(value))return'full';
  return'off';
}

function transitionCutoff(env=process.env){
  const raw=clean(env?.MICROBUSINESS_READINESS_TRANSITION_CUTOFF,80);
  if(!raw)return null;
  const d=new Date(raw);
  return Number.isFinite(d.getTime())?d.toISOString():null;
}

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
  return microbusinessReadinessEnforcementMode(env)!=='off';
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
    eligibility_evidence:Array.isArray(row.eligibility_evidence_json)?row.eligibility_evidence_json.map(normalizeEvidenceItem):[],
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
      eligibility_evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT NOT NULL DEFAULT 'readiness_runtime',
      policy_version TEXT NOT NULL DEFAULT 'ph-microbusiness-readiness-v2',
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
    ALTER TABLE microbusiness_readiness
      ADD COLUMN IF NOT EXISTS eligibility_evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE microbusiness_readiness
      ALTER COLUMN policy_version SET DEFAULT 'ph-microbusiness-readiness-v2';
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
  const reviewStatus=microbusinessReadinessReviewStatus(state,state.eligibility_evidence);
  return{
    ...state,
    next_action_code:nextMicrobusinessReadinessAction(state),
    review_requirements:microbusinessReadinessReviewRequirements(state),
    review_status:reviewStatus,
    enforcement_enabled:microbusinessReadinessEnforcementEnabled(),
    enforcement_mode:microbusinessReadinessEnforcementMode()
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
    ||Object.prototype.hasOwnProperty.call(input,'eligibility_reason')
    ||Object.prototype.hasOwnProperty.call(input,'eligibility_evidence')){
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
  commerceScope={},
  evidenceChecklist=[]
}={}){
  await ensureMicrobusinessReadinessSchema(pool);
  const stateValue=clean(commerceState,40);
  if(!COMMERCE_STATES.has(stateValue))throw Object.assign(new Error('Unknown commerce eligibility state'),{status:400});
  const row=await ensureSubjectRow(pool,{accountId,profileRole,businessId});
  const before=microbusinessReadinessState(row);
  const evidence=stateValue==='readiness_only'?[]:validateMicrobusinessEligibilityEvidence(before,evidenceChecklist);
  if(stateValue!=='readiness_only'&&!clean(reason,500))throw Object.assign(new Error('Review reason is required when granting commerce eligibility'),{status:400,code:'READINESS_REVIEW_REASON_REQUIRED'});
  const governedStage=stateValue==='readiness_only'
    ?(SELF_SERVICE_STAGES.has(before.readiness_stage)?before.readiness_stage:'getting_ready')
    :(before.readiness_stage==='growing'?'growing':'verified');
  const updated=await pool.query(
    `UPDATE microbusiness_readiness
        SET commerce_state=$1,
            commerce_scope_json=$2::jsonb,
            eligibility_evidence_json=$3::jsonb,
            eligibility_reviewed_at=NOW(),
            eligibility_reviewed_by_account_id=$4,
            eligibility_reason=$5,
            readiness_stage=$6,
            source='governed_review',
            policy_version=$7,
            updated_at=NOW()
      WHERE id=$8
      RETURNING *`,
    [
      stateValue,JSON.stringify(commerceScope||{}),JSON.stringify(evidence),
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

async function transitionLegacyCommerceAllowed(pool,{accountId=null,profileRole,businessId=null,env=process.env}={}){
  if(microbusinessReadinessEnforcementMode(env)!=='transition')return false;
  const cutoff=transitionCutoff(env);
  if(!cutoff)return false;
  const role=normalizeRole(profileRole);
  if(role==='merchant'){
    const business=normalizeBusinessId(businessId);
    if(!business)return false;
    const q=await pool.query(
      `SELECT 1
         FROM merchant_storefronts ms
         JOIN business_memberships bm ON bm.business_id=ms.business_id AND bm.active=TRUE
         JOIN profile_authorizations pa ON pa.account_id=bm.account_id
              AND pa.role='merchant' AND pa.status='active'
        WHERE ms.business_id=$1
          AND ms.publication_status='published'
          AND pa.approved_at IS NOT NULL
          AND pa.approved_at<=$2::timestamptz
        LIMIT 1`,
      [business,cutoff]
    );
    return Boolean(q.rowCount);
  }
  const account=accountId==null?null:positiveId(accountId,'Account identifier');
  if(!account)return false;
  const q=await pool.query(
    `SELECT 1
       FROM profiles p
       JOIN profile_authorizations pa ON pa.account_id=p.account_id
            AND pa.role='service_provider' AND pa.status='active'
      WHERE p.account_id=$1 AND p.role='service_provider'
        AND p.enabled=TRUE AND p.status='active' AND p.visibility='public'
        AND pa.approved_at IS NOT NULL
        AND pa.approved_at<=$2::timestamptz
      LIMIT 1`,
    [account,cutoff]
  );
  return Boolean(q.rowCount);
}

export async function requireMicrobusinessCommerceEligibility(pool,{
  accountId=null,
  profileRole,
  businessId=null,
  action='use public commerce',
  enforcementEnabled=microbusinessReadinessEnforcementEnabled(),
  env=process.env
}={}){
  const readiness=await microbusinessReadinessSnapshot(pool,{accountId,profileRole,businessId});
  const decision=microbusinessCommerceDecision(readiness,{enforcementEnabled});
  if(decision.allowed)return decision;
  if(enforcementEnabled&&await transitionLegacyCommerceAllowed(pool,{accountId,profileRole,businessId,env})){
    return Object.freeze({...decision,allowed:true,reason:'legacy_production_transition',transition_only:true});
  }
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

export async function filterCommerceEligibleBusinessIds(pool,businessIds,{enforcementEnabled=microbusinessReadinessEnforcementEnabled(),env=process.env}={}){
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
  const allowed=new Set(q.rows.map(row=>Number(row.business_id)));
  const cutoff=transitionCutoff(env);
  if(microbusinessReadinessEnforcementMode(env)==='transition'&&cutoff){
    const legacy=await pool.query(
      `SELECT DISTINCT ms.business_id
         FROM merchant_storefronts ms
         JOIN business_memberships bm ON bm.business_id=ms.business_id AND bm.active=TRUE
         JOIN profile_authorizations pa ON pa.account_id=bm.account_id
              AND pa.role='merchant' AND pa.status='active'
        WHERE ms.business_id=ANY($1::bigint[])
          AND ms.publication_status='published'
          AND pa.approved_at IS NOT NULL
          AND pa.approved_at<=$2::timestamptz`,
      [ids,cutoff]
    );
    for(const row of legacy.rows)allowed.add(Number(row.business_id));
  }
  return allowed;
}


export async function filterCommerceEligibleServiceProviderIds(pool,accountIds,{enforcementEnabled=microbusinessReadinessEnforcementEnabled(),env=process.env}={}){
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
  const allowed=new Set(q.rows.map(row=>Number(row.account_id)));
  const cutoff=transitionCutoff(env);
  if(microbusinessReadinessEnforcementMode(env)==='transition'&&cutoff){
    const legacy=await pool.query(
      `SELECT DISTINCT p.account_id
         FROM profiles p
         JOIN profile_authorizations pa ON pa.account_id=p.account_id
              AND pa.role='service_provider' AND pa.status='active'
        WHERE p.account_id=ANY($1::bigint[])
          AND p.role='service_provider' AND p.enabled=TRUE
          AND p.status='active' AND p.visibility='public'
          AND pa.approved_at IS NOT NULL
          AND pa.approved_at<=$2::timestamptz`,
      [ids,cutoff]
    );
    for(const row of legacy.rows)allowed.add(Number(row.account_id));
  }
  return allowed;
}
