import {accountGeographySnapshot} from './account-geography.js';

export const GUIDED_ONBOARDING_JOURNEY='first_account_first_profile_v1';
export const GUIDED_ONBOARDING_STEPS=Object.freeze([
  'welcome',
  'complete_account',
  'area_status',
  'account_settings',
  'manage_profiles',
  'choose_profile',
  'profile_onboarding'
]);
const STEP_SET=new Set(GUIDED_ONBOARDING_STEPS);
const ROLE_SET=new Set(['customer','merchant','supplier','courier','service_provider']);
const STATUS_SET=new Set(['active','paused','completed']);
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);

export async function ensureGuidedOnboardingSchema(pool){
  await pool.query(
    "CREATE TABLE IF NOT EXISTS guided_onboarding_progress("+
    "account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,"+
    "journey_key TEXT NOT NULL,current_step_id TEXT NOT NULL DEFAULT 'welcome',"+
    "completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,status TEXT NOT NULL DEFAULT 'active',"+
    "selected_profile_role TEXT NOT NULL DEFAULT '',auto_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,"+
    "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),paused_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,journey_key),"+
    "CHECK(status IN ('active','paused','completed')));"+
    "CREATE INDEX IF NOT EXISTS guided_onboarding_status_idx ON guided_onboarding_progress(status,updated_at DESC)"
  );
}

function normalizeCompleted(value){
  const values=Array.isArray(value)?value:[];
  return [...new Set(values.map(x=>clean(x,80)).filter(x=>STEP_SET.has(x)))];
}
function nextStep(completed){
  const set=new Set(completed);
  return GUIDED_ONBOARDING_STEPS.find(step=>!set.has(step))||'profile_onboarding';
}
async function accountFacts(pool,accountId){
  const [account,profiles,apps,geo]=await Promise.all([
    pool.query("SELECT display_name,email,address,email_verified_at,account_mode,test_role FROM accounts WHERE id=$1",[Number(accountId)]),
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

function autoCompleted(progress,facts){
  const completed=new Set(normalizeCompleted(progress.completed_steps));
  if(facts.email_verified&&facts.personal_details_ready&&facts.area_assigned)completed.add('complete_account');
  if(facts.started_profile_role)completed.add('choose_profile');
  if(facts.first_profile_meaningful)completed.add('profile_onboarding');
  return [...completed];
}

export async function guidedOnboardingSnapshot(pool,accountId){
  await ensureGuidedOnboardingSchema(pool);
  const facts=await accountFacts(pool,accountId);
  if(facts.company_test){
    return{
      eligible:false,journey_key:GUIDED_ONBOARDING_JOURNEY,status:'completed',auto_start_enabled:false,
      current_step_id:null,completed_steps:GUIDED_ONBOARDING_STEPS,selected_profile_role:facts.started_profile_role||'',facts
    };
  }
  const progress=await ensureProgressRow(pool,accountId);
  const completed=autoCompleted(progress,facts);
  let status=STATUS_SET.has(progress.status)?progress.status:'active';
  if(completed.includes('profile_onboarding'))status='completed';
  const current=status==='completed'?null:nextStep(completed);
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
      [JSON.stringify(completed),current||'profile_onboarding',status,facts.started_profile_role||'',Number(accountId),GUIDED_ONBOARDING_JOURNEY]
    );
  }
  return{
    eligible:true,journey_key:GUIDED_ONBOARDING_JOURNEY,status,
    auto_start_enabled:Boolean(progress.auto_start_enabled),
    current_step_id:current,completed_steps:completed,
    selected_profile_role:progress.selected_profile_role||facts.started_profile_role||'',
    started_at:progress.started_at,paused_at:progress.paused_at,completed_at:status==='completed'?(progress.completed_at||new Date().toISOString()):progress.completed_at,
    facts
  };
}

export async function updateGuidedOnboarding(pool,accountId,input={}){
  await ensureGuidedOnboardingSchema(pool);
  const progress=await ensureProgressRow(pool,accountId);
  const action=clean(input.action,40);
  const step=clean(input.step_id,80);
  const role=clean(input.selected_profile_role,40);
  const completed=new Set(normalizeCompleted(progress.completed_steps));
  let status=progress.status,autoStart=Boolean(progress.auto_start_enabled),selectedRole=progress.selected_profile_role||'';
  if(action==='complete_step'){
    if(!STEP_SET.has(step))throw Object.assign(new Error('Unknown onboarding step'),{status:400});
    completed.add(step);
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
    completed.clear();status='active';autoStart=true;selectedRole='';
  }else{
    throw Object.assign(new Error('Unknown onboarding action'),{status:400});
  }
  const list=[...completed];
  const current=status==='completed'?null:nextStep(list);
  await pool.query(
    "UPDATE guided_onboarding_progress SET completed_steps=$1::jsonb,current_step_id=$2,status=$3,selected_profile_role=$4,"+
    "auto_start_enabled=$5,paused_at=CASE WHEN $3='paused' THEN NOW() WHEN $3='active' THEN NULL ELSE paused_at END,"+
    "completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,NOW()) WHEN $3='active' AND $6='reset' THEN NULL ELSE completed_at END,updated_at=NOW() "+
    "WHERE account_id=$7 AND journey_key=$8",
    [JSON.stringify(list),current||'profile_onboarding',status,selectedRole,autoStart,action,Number(accountId),GUIDED_ONBOARDING_JOURNEY]
  );
  return guidedOnboardingSnapshot(pool,accountId);
}
