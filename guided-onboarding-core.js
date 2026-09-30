import {accountGeographySnapshot} from './account-geography.js';

export const GUIDED_ONBOARDING_JOURNEY='first_account_first_profile_v1';
export const GUIDED_ONBOARDING_STEPS=Object.freeze([
  'language',
  'welcome',
  'complete_account',
  'area_status',
  'account_settings',
  'manage_profiles',
  'choose_profile'
]);
export const GUIDED_ONBOARDING_LOCALES=Object.freeze(['en-PH','fil-PH']);
export const GUIDED_ONBOARDING_PROFILE_VERSION=1;
export const GUIDED_ONBOARDING_PROFILE_STEPS=Object.freeze(['profile_welcome','profile_settings']);
export const GUIDED_ONBOARDING_CUSTOMER_STEPS=Object.freeze([
  'profile_welcome',
  'customer_address_privacy',
  'customer_price_payment',
  'customer_order_commitment',
  'customer_tracking',
  'customer_support_safety',
  'customer_money',
  'customer_discovery',
  'customer_services',
  'profile_settings'
]);
export const GUIDED_ONBOARDING_MERCHANT_STEPS=Object.freeze([
  'profile_welcome',
  'merchant_storefront_visibility',
  'merchant_catalog_ai',
  'merchant_orders_fulfilment',
  'merchant_delivery_pricing',
  'merchant_refunds',
  'merchant_finance_settlement',
  'merchant_supplier_sourcing',
  'merchant_reputation_safety',
  'merchant_promotion',
  'profile_settings'
]);
export const GUIDED_ONBOARDING_SUPPLIER_STEPS=Object.freeze([
  'profile_welcome',
  'supplier_workspace_identity',
  'supplier_catalog_availability',
  'supplier_relationships_quotes',
  'supplier_orders_eta',
  'supplier_exceptions',
  'supplier_money_receivables',
  'supplier_settlement_payout',
  'supplier_support_safety',
  'profile_settings'
]);
export const GUIDED_ONBOARDING_COURIER_STEPS=Object.freeze([
  'profile_welcome',
  'courier_eligibility_vehicle',
  'courier_availability_area',
  'courier_assignments_workflow',
  'courier_customer_privacy',
  'courier_navigation_location',
  'courier_handoff_evidence',
  'courier_money_earnings',
  'courier_settlement_payout',
  'courier_safety_support',
  'profile_settings'
]);
export const GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS=Object.freeze([
  'profile_welcome',
  'service_readiness_credentials',
  'service_visibility_area',
  'service_offers_pricing',
  'service_quotes_changes',
  'service_jobs_privacy',
  'service_work_evidence_consent',
  'service_money_payments',
  'service_safety_compliance',
  'profile_settings'
]);
export const GUIDED_ONBOARDING_PROFILE_DEFINITIONS=Object.freeze({
  customer:Object.freeze({version:2,steps:GUIDED_ONBOARDING_CUSTOMER_STEPS}),
  merchant:Object.freeze({version:2,steps:GUIDED_ONBOARDING_MERCHANT_STEPS}),
  supplier:Object.freeze({version:2,steps:GUIDED_ONBOARDING_SUPPLIER_STEPS}),
  courier:Object.freeze({version:2,steps:GUIDED_ONBOARDING_COURIER_STEPS}),
  service_provider:Object.freeze({version:2,steps:GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS})
});

const ROLE_ORDER=Object.freeze(['customer','merchant','supplier','courier','service_provider']);
const ROLE_SET=new Set(ROLE_ORDER);
const STEP_SET=new Set(GUIDED_ONBOARDING_STEPS);
const LOCALE_SET=new Set(GUIDED_ONBOARDING_LOCALES);
const STATUS_SET=new Set(['active','paused','completed']);
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const normalizeLocale=value=>LOCALE_SET.has(clean(value,20))?clean(value,20):'en-PH';
const profileDefinition=role=>GUIDED_ONBOARDING_PROFILE_DEFINITIONS[role]||{version:GUIDED_ONBOARDING_PROFILE_VERSION,steps:GUIDED_ONBOARDING_PROFILE_STEPS};
const profileJourneyKey=role=>`profile:${role}:v${profileDefinition(role).version}`;

export async function ensureGuidedOnboardingSchema(pool){
  await pool.query(
    "CREATE TABLE IF NOT EXISTS guided_onboarding_progress("+
    "account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,"+
    "journey_key TEXT NOT NULL,current_step_id TEXT NOT NULL DEFAULT 'welcome',"+
    "completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,status TEXT NOT NULL DEFAULT 'active',"+
    "selected_profile_role TEXT NOT NULL DEFAULT '',auto_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,"+
    "locale_confirmed BOOLEAN NOT NULL DEFAULT FALSE,"+
    "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),paused_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,journey_key),"+
    "CHECK(status IN ('active','paused','completed')));"+
    "ALTER TABLE guided_onboarding_progress ADD COLUMN IF NOT EXISTS locale_confirmed BOOLEAN NOT NULL DEFAULT FALSE;"+
    "CREATE INDEX IF NOT EXISTS guided_onboarding_status_idx ON guided_onboarding_progress(status,updated_at DESC);"+
    "CREATE TABLE IF NOT EXISTS guided_onboarding_profile_progress("+
    "account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,"+
    "profile_role TEXT NOT NULL,journey_version INTEGER NOT NULL DEFAULT 1,"+
    "current_step_id TEXT NOT NULL DEFAULT 'profile_welcome',"+
    "completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,status TEXT NOT NULL DEFAULT 'active',"+
    "auto_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,"+
    "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),paused_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
    "PRIMARY KEY(account_id,profile_role,journey_version),"+
    "CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider')),"+
    "CHECK(status IN ('active','paused','completed')));"+
    "CREATE INDEX IF NOT EXISTS guided_onboarding_profile_status_idx "+
    "ON guided_onboarding_profile_progress(account_id,status,updated_at DESC)"
  );
}

function normalizeCompleted(value){
  const values=Array.isArray(value)?value:[];
  return [...new Set(values.map(x=>clean(x,80)).filter(x=>STEP_SET.has(x)))];
}
function normalizeProfileCompleted(value,role){
  const allowed=new Set(profileDefinition(role).steps);
  const values=Array.isArray(value)?value:[];
  return [...new Set(values.map(x=>clean(x,80)).filter(x=>allowed.has(x)))];
}
function nextStep(completed){
  const set=new Set(completed);
  return GUIDED_ONBOARDING_STEPS.find(step=>!set.has(step))||null;
}
function nextProfileStep(completed,role){
  const steps=profileDefinition(role).steps,set=new Set(completed);
  return steps.find(step=>!set.has(step))||steps.at(-1)||'profile_settings';
}

async function accountFacts(pool,accountId){
  const [account,profiles,apps,geo]=await Promise.all([
    pool.query("SELECT display_name,email,address,email_verified_at,account_mode,test_role,preferred_locale,active_role FROM accounts WHERE id=$1",[Number(accountId)]),
    pool.query("SELECT role,enabled,status,created_at,updated_at FROM profiles WHERE account_id=$1 ORDER BY created_at,role",[Number(accountId)]),
    pool.query("SELECT role,status,territory_id,created_at,updated_at FROM profile_applications WHERE account_id=$1 ORDER BY created_at",[Number(accountId)]).catch(error=>error?.code==='42P01'?{rows:[]}:Promise.reject(error)),
    accountGeographySnapshot(pool,Number(accountId)).catch(()=>({assigned:false,operational_onboarding_available:false}))
  ]);
  const a=account.rows[0];
  if(!a)throw Object.assign(new Error('Account not found'),{status:404});
  const companyTest=a.account_mode==='company_test';
  const profileRows=profiles.rows||[],applicationRows=apps.rows||[];
  const startedProfile=profileRows.find(p=>p.status&&p.status!=='not_started')||null;
  const startedApp=applicationRows[0]||null;
  const selectedRole=startedApp?.role||startedProfile?.role||'';
  const roleProfile=selectedRole?profileRows.find(p=>p.role===selectedRole):null;
  const roleApp=selectedRole?applicationRows.find(p=>p.role===selectedRole):null;
  const profileMeaningful=Boolean(
    roleProfile?.enabled&&roleProfile?.status==='active'
    ||roleApp&&['submitted','under_review','approved'].includes(roleApp.status)
  );
  return{
    company_test:companyTest,
    preferred_locale:normalizeLocale(a.preferred_locale),
    supported_locales:GUIDED_ONBOARDING_LOCALES,
    active_role:ROLE_SET.has(a.active_role)?a.active_role:'',
    email_verified:companyTest||Boolean(a.email_verified_at),
    personal_details_ready:companyTest||Boolean(clean(a.display_name,120)&&clean(a.email,160)&&clean(a.address,300)),
    area_assigned:companyTest||Boolean(geo?.assigned),
    area_operational:companyTest||Boolean(geo?.operational_onboarding_available),
    geography:geo,
    started_profile_role:selectedRole,
    started_profile_status:roleProfile?.status||roleApp?.status||'',
    first_profile_meaningful:profileMeaningful,
    profiles:profileRows.map(p=>({role:p.role,enabled:Boolean(p.enabled),status:p.status})),
    applications:applicationRows.map(x=>({role:x.role,status:x.status,territory_id:x.territory_id}))
  };
}

async function ensureProgressRow(pool,accountId){
  const q=await pool.query(
    "INSERT INTO guided_onboarding_progress(account_id,journey_key) VALUES($1,$2) "+
    "ON CONFLICT(account_id,journey_key) DO UPDATE SET account_id=EXCLUDED.account_id "+
    "RETURNING *",
    [Number(accountId),GUIDED_ONBOARDING_JOURNEY]
  );
  return q.rows[0];
}

function profileRoleStarted(facts,role){
  const profile=(facts.profiles||[]).find(p=>p.role===role);
  const application=(facts.applications||[]).find(a=>a.role===role);
  return Boolean(
    application
    ||profile?.enabled
    ||profile?.status&&profile.status!=='not_started'
  );
}

async function ensureProfileProgressRows(pool,accountId,facts,legacyProgress){
  const legacyCompletedRaw=new Set(Array.isArray(legacyProgress?.completed_steps)?legacyProgress.completed_steps.map(x=>clean(x,80)):[]);
  const legacyRole=clean(legacyProgress?.selected_profile_role,40)||facts.started_profile_role||'';
  const migratedLegacyProfile=Boolean(legacyRole&&legacyCompletedRaw.has('profile_onboarding'));
  for(const role of ROLE_ORDER){
    if(!profileRoleStarted(facts,role))continue;
    const def=profileDefinition(role);
    const previous=await pool.query(
      "SELECT journey_version,completed_steps,status FROM guided_onboarding_profile_progress "+
      "WHERE account_id=$1 AND profile_role=$2 ORDER BY journey_version DESC LIMIT 1",
      [Number(accountId),role]
    );
    const previousRow=previous.rows[0]||null;
    let migrated=[];
    if(previousRow)migrated=normalizeProfileCompleted(previousRow.completed_steps,role);
    else if(migratedLegacyProfile&&role===legacyRole)migrated=GUIDED_ONBOARDING_PROFILE_STEPS.filter(step=>def.steps.includes(step));
    const completed=new Set(migrated);
    const allDone=def.steps.every(step=>completed.has(step));
    const current=allDone?(def.steps.at(-1)||'profile_settings'):nextProfileStep([...completed],role);
    await pool.query(
      "INSERT INTO guided_onboarding_profile_progress("+
      "account_id,profile_role,journey_version,current_step_id,completed_steps,status,auto_start_enabled,completed_at"+
      ") VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) "+
      "ON CONFLICT(account_id,profile_role,journey_version) DO NOTHING",
      [
        Number(accountId),role,def.version,current,
        JSON.stringify([...completed]),
        allDone?'completed':'active',
        !allDone,
        allDone?new Date():null
      ]
    );
  }
}
function autoCompleted(progress,facts){
  const completed=new Set(normalizeCompleted(progress.completed_steps));
  if(progress.locale_confirmed)completed.add('language');
  if(facts.email_verified&&facts.personal_details_ready&&facts.area_assigned)completed.add('complete_account');
  if(facts.started_profile_role)completed.add('choose_profile');
  return [...completed];
}

function profileJourneySummary(row,facts){
  const def=profileDefinition(row.profile_role),allowed=new Set(def.steps),completed=normalizeProfileCompleted(row.completed_steps,row.profile_role);
  const profile=(facts.profiles||[]).find(p=>p.role===row.profile_role)||null;
  const application=(facts.applications||[]).find(a=>a.role===row.profile_role)||null;
  const status=STATUS_SET.has(row.status)?row.status:'active';
  return{
    journey_key:profileJourneyKey(row.profile_role),
    journey_kind:'profile',
    profile_role:row.profile_role,
    journey_version:Number(row.journey_version)||def.version,
    status,
    auto_start_enabled:Boolean(row.auto_start_enabled),
    current_step_id:status==='completed'?null:(allowed.has(row.current_step_id)?row.current_step_id:nextProfileStep(completed,row.profile_role)),
    completed_steps:completed,
    steps:def.steps,
    progress_total:def.steps.length,
    progress_completed:completed.length,
    profile_enabled:Boolean(profile?.enabled),
    profile_status:profile?.status||application?.status||'not_started',
    is_active_profile:facts.active_role===row.profile_role,
    started_at:row.started_at,
    paused_at:row.paused_at,
    completed_at:row.completed_at
  };
}

async function profileJourneySnapshots(pool,accountId,facts,legacyProgress){
  await ensureProfileProgressRows(pool,accountId,facts,legacyProgress);
  const q=await pool.query(
    "SELECT * FROM guided_onboarding_profile_progress WHERE account_id=$1 ORDER BY updated_at,profile_role,journey_version DESC",
    [Number(accountId)]
  );
  const latest=new Map();
  for(const row of q.rows||[]){
    const def=profileDefinition(row.profile_role);
    if(Number(row.journey_version)!==Number(def.version)||latest.has(row.profile_role))continue;
    latest.set(row.profile_role,row);
  }
  return [...latest.values()]
    .map(row=>profileJourneySummary(row,facts))
    .sort((a,b)=>{
      if(a.is_active_profile!==b.is_active_profile)return a.is_active_profile?-1:1;
      return ROLE_ORDER.indexOf(a.profile_role)-ROLE_ORDER.indexOf(b.profile_role);
    });
}

export async function guidedOnboardingSnapshot(pool,accountId){
  await ensureGuidedOnboardingSchema(pool);
  const facts=await accountFacts(pool,accountId);
  if(facts.company_test){
    return{
      eligible:false,journey_key:GUIDED_ONBOARDING_JOURNEY,journey_kind:'account',status:'completed',auto_start_enabled:false,
      current_step_id:null,completed_steps:GUIDED_ONBOARDING_STEPS,steps:GUIDED_ONBOARDING_STEPS,
      selected_profile_role:facts.started_profile_role||'',
      preferred_locale:facts.preferred_locale,locale_confirmed:true,supported_locales:GUIDED_ONBOARDING_LOCALES,
      profile_journeys:[],facts
    };
  }
  const progress=await ensureProgressRow(pool,accountId);
  const completed=autoCompleted(progress,facts);
  let status=STATUS_SET.has(progress.status)?progress.status:'active';
  const current=nextStep(completed);
  if(!current)status='completed';
  else if(status==='completed')status='active';
  if(
    JSON.stringify(completed)!==JSON.stringify(normalizeCompleted(progress.completed_steps))
    ||current!==progress.current_step_id
    ||status!==progress.status
    ||(!progress.selected_profile_role&&facts.started_profile_role)
  ){
    await pool.query(
      "UPDATE guided_onboarding_progress SET completed_steps=$1::jsonb,current_step_id=$2,status=$3,"+
      "selected_profile_role=CASE WHEN selected_profile_role='' THEN $4 ELSE selected_profile_role END,"+
      "completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END,updated_at=NOW() "+
      "WHERE account_id=$5 AND journey_key=$6",
      [JSON.stringify(completed),current||'choose_profile',status,facts.started_profile_role||'',Number(accountId),GUIDED_ONBOARDING_JOURNEY]
    );
  }
  const profileJourneys=await profileJourneySnapshots(pool,accountId,facts,{...progress,completed_steps:completed,status});
  return{
    eligible:true,journey_key:GUIDED_ONBOARDING_JOURNEY,journey_kind:'account',status,
    auto_start_enabled:Boolean(progress.auto_start_enabled),
    current_step_id:current,completed_steps:completed,steps:GUIDED_ONBOARDING_STEPS,
    selected_profile_role:progress.selected_profile_role||facts.started_profile_role||'',
    preferred_locale:facts.preferred_locale,locale_confirmed:Boolean(progress.locale_confirmed),supported_locales:GUIDED_ONBOARDING_LOCALES,
    profile_journeys:profileJourneys,
    started_at:progress.started_at,paused_at:progress.paused_at,completed_at:status==='completed'?(progress.completed_at||new Date().toISOString()):progress.completed_at,
    facts
  };
}

async function updateProfileJourney(pool,accountId,input){
  const role=clean(input.profile_role,40);
  if(!ROLE_SET.has(role))throw Object.assign(new Error('Unknown profile role'),{status:400});
  const facts=await accountFacts(pool,accountId);
  if(!profileRoleStarted(facts,role))throw Object.assign(new Error('Activate or start this profile before opening its tutorial'),{status:409});
  const legacy=await ensureProgressRow(pool,accountId);
  await ensureProfileProgressRows(pool,accountId,facts,legacy);
  const def=profileDefinition(role);
  const rowResult=await pool.query(
    "SELECT * FROM guided_onboarding_profile_progress WHERE account_id=$1 AND profile_role=$2 AND journey_version=$3",
    [Number(accountId),role,def.version]
  );
  const row=rowResult.rows[0];
  if(!row)throw Object.assign(new Error('Profile tutorial is unavailable'),{status:404});
  const action=clean(input.action,40);
  const step=clean(input.step_id,80);
  const completed=new Set(normalizeProfileCompleted(row.completed_steps,role));
  let status=STATUS_SET.has(row.status)?row.status:'active';
  let autoStart=Boolean(row.auto_start_enabled);
  if(action==='profile_complete_step'){
    if(!def.steps.includes(step))throw Object.assign(new Error('Unknown profile tutorial step'),{status:400});
    completed.add(step);
    if(def.steps.every(x=>completed.has(x))){status='completed';autoStart=false}
    else status='active';
  }else if(action==='profile_pause'){
    status='paused';autoStart=false;
  }else if(action==='profile_resume'){
    status='active';autoStart=true;
  }else if(action==='profile_reset'){
    completed.clear();status='active';autoStart=true;
  }else if(action==='profile_complete'){
    def.steps.forEach(x=>completed.add(x));status='completed';autoStart=false;
  }else{
    throw Object.assign(new Error('Unknown profile tutorial action'),{status:400});
  }
  const list=[...completed];
  const current=status==='completed'?null:nextProfileStep(list,role);
  await pool.query(
    "UPDATE guided_onboarding_profile_progress SET completed_steps=$1::jsonb,current_step_id=$2,status=$3,auto_start_enabled=$4,"+
    "paused_at=CASE WHEN $3='paused' THEN NOW() WHEN $3='active' THEN NULL ELSE paused_at END,"+
    "completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,NOW()) WHEN $3='active' AND $5='profile_reset' THEN NULL ELSE completed_at END,"+
    "updated_at=NOW() WHERE account_id=$6 AND profile_role=$7 AND journey_version=$8",
    [JSON.stringify(list),current||def.steps.at(-1)||'profile_settings',status,autoStart,action,Number(accountId),role,def.version]
  );
  return guidedOnboardingSnapshot(pool,accountId);
}

export async function updateGuidedOnboarding(pool,accountId,input={}){
  await ensureGuidedOnboardingSchema(pool);
  const action=clean(input.action,40);
  if(action.startsWith('profile_'))return updateProfileJourney(pool,accountId,input);
  const progress=await ensureProgressRow(pool,accountId);
  const step=clean(input.step_id,80);
  const role=clean(input.selected_profile_role,40);
  const completed=new Set(normalizeCompleted(progress.completed_steps));
  let status=progress.status,autoStart=Boolean(progress.auto_start_enabled),selectedRole=progress.selected_profile_role||'',localeConfirmed=Boolean(progress.locale_confirmed);
  if(action==='complete_step'){
    if(!STEP_SET.has(step))throw Object.assign(new Error('Unknown onboarding step'),{status:400});
    if(step==='language')throw Object.assign(new Error('Choose a supported onboarding language'),{status:400});
    completed.add(step);
  }else if(action==='set_locale'){
    const locale=clean(input.locale,20);
    if(!LOCALE_SET.has(locale))throw Object.assign(new Error('Unsupported onboarding language'),{status:400});
    await pool.query("UPDATE accounts SET preferred_locale=$1,updated_at=NOW() WHERE id=$2",[locale,Number(accountId)]);
    localeConfirmed=true;completed.add('language');
  }else if(action==='select_profile'){
    if(!ROLE_SET.has(role))throw Object.assign(new Error('Unknown profile role'),{status:400});
    selectedRole=role;completed.add('choose_profile');
  }else if(action==='pause'){
    status='paused';autoStart=false;
  }else if(action==='resume'){
    status='active';autoStart=true;
  }else if(action==='complete'){
    GUIDED_ONBOARDING_STEPS.forEach(x=>completed.add(x));status='completed';autoStart=false;
  }else if(action==='reset'){
    completed.clear();status='active';autoStart=true;selectedRole='';localeConfirmed=false;
  }else{
    throw Object.assign(new Error('Unknown onboarding action'),{status:400});
  }
  const list=[...completed];
  const current=nextStep(list);
  if(!current)status='completed';
  else if(status==='completed')status='active';
  await pool.query(
    "UPDATE guided_onboarding_progress SET completed_steps=$1::jsonb,current_step_id=$2,status=$3,selected_profile_role=$4,"+
    "auto_start_enabled=$5,locale_confirmed=$6,paused_at=CASE WHEN $3='paused' THEN NOW() WHEN $3='active' THEN NULL ELSE paused_at END,"+
    "completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,NOW()) WHEN $3='active' AND $7='reset' THEN NULL ELSE completed_at END,updated_at=NOW() "+
    "WHERE account_id=$8 AND journey_key=$9",
    [JSON.stringify(list),current||'choose_profile',status,selectedRole,autoStart,localeConfirmed,action,Number(accountId),GUIDED_ONBOARDING_JOURNEY]
  );
  return guidedOnboardingSnapshot(pool,accountId);
}
