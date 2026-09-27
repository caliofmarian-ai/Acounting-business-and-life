export const ADULT_ELIGIBILITY_POLICY_VERSION='ph-adult-eligibility-v1';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const positiveId=value=>{
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error('Account eligibility identifier is invalid'),{status:400});
  return id;
};

export function accountAdultEligibilityState(row={}){
  const status=clean(row.safety_eligibility_status||row.status,40)||'pending';
  const policyVersion=clean(row.safety_eligibility_policy_version||row.policy_version,80);
  const companyTest=row.account_mode==='company_test';
  const personal=row.account_mode==='personal';
  const currentPolicy=policyVersion===ADULT_ELIGIBILITY_POLICY_VERSION;
  return Object.freeze({
    account_mode:clean(row.account_mode,40),
    status,
    policy_version:policyVersion,
    required_policy_version:ADULT_ELIGIBILITY_POLICY_VERSION,
    eligible:currentPolicy&&(
      (personal&&['adult_self_attested','adult_reviewed'].includes(status))||
      (companyTest&&status==='company_test_exempt')
    ),
    self_attested:personal&&status==='adult_self_attested'&&currentPolicy,
    admin_reviewed:personal&&status==='adult_reviewed'&&currentPolicy,
    company_test_exempt:companyTest&&status==='company_test_exempt'&&currentPolicy,
    attested_at:row.safety_eligibility_attested_at||row.attested_at||null,
    reviewed_at:row.safety_eligibility_reviewed_at||row.reviewed_at||null,
    source:clean(row.safety_eligibility_source||row.source,80)
  });
}

export async function ensureAccountSafetyEligibilitySchema(pool){
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_policy_version TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_attested_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_reviewed_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_reviewed_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safety_eligibility_source TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_safety_eligibility_status_check;
    ALTER TABLE accounts ADD CONSTRAINT accounts_safety_eligibility_status_check
      CHECK(safety_eligibility_status IN ('pending','adult_self_attested','adult_reviewed','company_test_exempt','restricted'));

    CREATE TABLE IF NOT EXISTS account_safety_eligibility_events (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      event_code TEXT NOT NULL,
      status_before TEXT NOT NULL DEFAULT '',
      status_after TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS account_safety_eligibility_events_account_idx
      ON account_safety_eligibility_events(account_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS account_safety_eligibility_events_actor_idx
      ON account_safety_eligibility_events(actor_account_id,created_at DESC);

    WITH exempted AS (
      UPDATE accounts
         SET safety_eligibility_status='company_test_exempt',
             safety_eligibility_policy_version='${ADULT_ELIGIBILITY_POLICY_VERSION}',
             safety_eligibility_attested_at=NULL,
             safety_eligibility_reviewed_at=NULL,
             safety_eligibility_reviewed_by_account_id=NULL,
             safety_eligibility_source='company_test_policy',
             updated_at=NOW()
       WHERE account_mode='company_test'
         AND safety_eligibility_status<>'restricted'
         AND (safety_eligibility_status<>'company_test_exempt'
           OR safety_eligibility_policy_version<>'${ADULT_ELIGIBILITY_POLICY_VERSION}')
      RETURNING id
    )
    INSERT INTO account_safety_eligibility_events(
      account_id,actor_account_id,event_code,status_before,status_after,policy_version,source,detail_json
    )
    SELECT id,NULL,'company_test_exempted','','company_test_exempt','${ADULT_ELIGIBILITY_POLICY_VERSION}',
           'company_test_policy','{"scope":"controlled_qa_only"}'::jsonb
      FROM exempted;
  `);
}

export async function accountAdultEligibilitySnapshot(db,accountId,{lock=false}={}){
  const id=positiveId(accountId);
  const q=await db.query(`
    SELECT account_mode,safety_eligibility_status,safety_eligibility_policy_version,
           safety_eligibility_attested_at,safety_eligibility_reviewed_at,safety_eligibility_source
      FROM accounts WHERE id=$1${lock?' FOR UPDATE':''}
  `,[id]);
  if(!q.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
  return accountAdultEligibilityState(q.rows[0]);
}

export async function requireAdultEligibility(db,accountId,{action='use an operational profile'}={}){
  const state=await accountAdultEligibilitySnapshot(db,accountId);
  if(state.eligible)return state;
  throw Object.assign(new Error(`Confirm that you are 18 or older in Account Settings before you ${clean(action,120)}.`),{
    status:403,
    code:'ADULT_ELIGIBILITY_REQUIRED',
    adult_eligibility:state
  });
}

async function withEligibilityTransaction(db,work){
  if(typeof db.connect!=='function')return work(db);
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

async function appendEligibilityEvent(db,{accountId,actorAccountId,eventCode,before,after,source,detail={}}){
  await db.query(`
    INSERT INTO account_safety_eligibility_events(
      account_id,actor_account_id,event_code,status_before,status_after,policy_version,source,detail_json
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
  `,[accountId,actorAccountId||null,clean(eventCode,80),clean(before,40),clean(after,40),ADULT_ELIGIBILITY_POLICY_VERSION,clean(source,80),JSON.stringify(detail)]);
}

export async function recordAdultEligibilityAttestation(db,{
  accountId,actorAccountId=accountId,attested=false,policyVersion='',source='account_settings'
}={}){
  const id=positiveId(accountId),actor=positiveId(actorAccountId);
  if(attested!==true)throw Object.assign(new Error('Explicit confirmation that you are 18 or older is required'),{status:422});
  if(clean(policyVersion,80)!==ADULT_ELIGIBILITY_POLICY_VERSION){
    throw Object.assign(new Error('The adult eligibility policy changed. Review the current notice and confirm again.'),{status:409});
  }
  return withEligibilityTransaction(db,async client=>{
    const before=await accountAdultEligibilitySnapshot(client,id,{lock:true});
    if(before.company_test_exempt)return before;
    if(before.status==='restricted')throw Object.assign(new Error('This account requires Trust & Safety review before profile access'),{status:403});
    if(before.account_mode!=='personal')throw Object.assign(new Error('Only a personal account can record an adult eligibility declaration'),{status:409});
    if(before.eligible)return before;
    const updated=await client.query(`
      UPDATE accounts
         SET safety_eligibility_status='adult_self_attested',
             safety_eligibility_policy_version=$1,
             safety_eligibility_attested_at=NOW(),
             safety_eligibility_reviewed_at=NULL,
             safety_eligibility_reviewed_by_account_id=NULL,
             safety_eligibility_source=$2,
             updated_at=NOW()
       WHERE id=$3 AND account_mode='personal'
       RETURNING id
    `,[ADULT_ELIGIBILITY_POLICY_VERSION,clean(source,80),id]);
    if(!updated.rowCount)throw Object.assign(new Error('Adult eligibility classification changed before the declaration was recorded'),{status:409});
    await appendEligibilityEvent(client,{accountId:id,actorAccountId:actor,eventCode:'adult_eligibility_self_attested',before:before.status,after:'adult_self_attested',source,detail:{declaration:'18_or_older',date_of_birth_collected:false}});
    return accountAdultEligibilitySnapshot(client,id);
  });
}

export async function recordCompanyTestEligibilityExemption(db,{accountId,source='company_test_provisioning'}={}){
  const id=positiveId(accountId);
  return withEligibilityTransaction(db,async client=>{
    const before=await accountAdultEligibilitySnapshot(client,id,{lock:true});
    if(before.company_test_exempt)return before;
    if(before.status==='restricted')throw Object.assign(new Error('A restricted account cannot receive the controlled QA exemption'),{status:403});
    const updated=await client.query(`
      UPDATE accounts
         SET safety_eligibility_status='company_test_exempt',
             safety_eligibility_policy_version=$1,
             safety_eligibility_attested_at=NULL,
             safety_eligibility_reviewed_at=NULL,
             safety_eligibility_reviewed_by_account_id=NULL,
             safety_eligibility_source=$2,
             updated_at=NOW()
       WHERE id=$3 AND account_mode='company_test'
       RETURNING id
    `,[ADULT_ELIGIBILITY_POLICY_VERSION,clean(source,80),id]);
    if(!updated.rowCount)throw Object.assign(new Error('Only a classified company test account can receive the QA eligibility exemption'),{status:409});
    await appendEligibilityEvent(client,{accountId:id,actorAccountId:null,eventCode:'company_test_exempted',before:before.status,after:'company_test_exempt',source,detail:{scope:'controlled_qa_only'}});
    return accountAdultEligibilitySnapshot(client,id);
  });
}

export async function recordAdultEligibilityAdminReview(db,{
  accountId,actorAccountId,confirmed=false,source='profile_application_review'
}={}){
  const id=positiveId(accountId),actor=positiveId(actorAccountId);
  if(confirmed!==true)throw Object.assign(new Error('Explicit Admin confirmation of the adult eligibility review is required before approval'),{status:422});
  return withEligibilityTransaction(db,async client=>{
    const before=await accountAdultEligibilitySnapshot(client,id,{lock:true});
    if(before.company_test_exempt||before.admin_reviewed)return before;
    if(!before.self_attested){
      throw Object.assign(new Error('The applicant must complete the current adult eligibility declaration before Admin approval'),{status:409});
    }
    await client.query(`
      UPDATE accounts
         SET safety_eligibility_status='adult_reviewed',
             safety_eligibility_policy_version=$1,
             safety_eligibility_reviewed_at=NOW(),
             safety_eligibility_reviewed_by_account_id=$2,
             safety_eligibility_source=$3,
             updated_at=NOW()
       WHERE id=$4
    `,[ADULT_ELIGIBILITY_POLICY_VERSION,actor,clean(source,80),id]);
    await appendEligibilityEvent(client,{accountId:id,actorAccountId:actor,eventCode:'adult_eligibility_admin_reviewed',before:before.status,after:'adult_reviewed',source,detail:{human_reviewed:true,identity_proofing_claimed:false}});
    return accountAdultEligibilitySnapshot(client,id);
  });
}
