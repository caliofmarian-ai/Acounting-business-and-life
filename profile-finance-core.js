const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

export const PROFILE_FINANCE_ROLES=Object.freeze(['customer','merchant','supplier','courier','service_provider']);
export const BUSINESS_FINANCE_ROLES=Object.freeze(['merchant','supplier']);
export const FINANCIAL_ACCOUNT_KINDS=Object.freeze(['cash','bank','e_wallet','paymongo_wallet','provider_clearing','other']);
export const FINANCIAL_ACCOUNT_PURPOSES=Object.freeze(['pay','receive','payout']);
export const MONEY_METHODS=Object.freeze(['cash','ewallet','bank_transfer','card','external_transfer','online_other']);
export const PAYOUT_SCHEDULES=Object.freeze(['provider_default','daily','weekly','biweekly','monthly','custom']);

const ROLE_SET=new Set(PROFILE_FINANCE_ROLES);
const BUSINESS_ROLE_SET=new Set(BUSINESS_FINANCE_ROLES);
const KIND_SET=new Set(FINANCIAL_ACCOUNT_KINDS);
const METHOD_SET=new Set(MONEY_METHODS);
const SCHEDULE_SET=new Set(PAYOUT_SCHEDULES);

export function isBusinessFinanceRole(role){return BUSINESS_ROLE_SET.has(String(role||''))}
export function publicFinancialAccount(row){
  return{
    id:Number(row.id),public_id:row.public_id,profile_role:row.profile_role,
    owner_scope:row.owner_scope,business_id:row.business_id==null?null:Number(row.business_id),
    business_name:row.business_name||'',account_kind:row.account_kind,provider_code:row.provider_code||'',
    display_name:row.display_name||'',institution_name:row.institution_name||'',
    account_name:row.account_name||'',reference_last4:row.reference_last4||'',
    can_pay:Boolean(row.can_pay),can_receive:Boolean(row.can_receive),can_payout:Boolean(row.can_payout),
    currency_code:row.currency_code||'PHP',verification_status:row.verification_status,
    status:row.status,provider_destination_configured:Boolean(row.provider_destination_ref),
    created_at:row.created_at,updated_at:row.updated_at
  };
}
function normalizeRole(role){
  const r=clean(role,40);
  if(!ROLE_SET.has(r))fail('Unsupported profile finance role');
  return r;
}
function normalizeKind(kind){
  const k=clean(kind,40);
  if(!KIND_SET.has(k))fail('Unsupported financial account type');
  return k;
}
function normalizeLast4(value){
  const v=clean(value,4);
  if(v&&!/^[A-Za-z0-9]{1,4}$/.test(v))fail('Reference must contain only the last 1–4 letters or digits');
  return v;
}
function normalizeCurrency(value){
  const v=clean(value||'PHP',3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(v))fail('Currency code must use three letters');
  return v;
}
function normalizeMethods(values){
  const list=Array.isArray(values)?values:[];
  return [...new Set(list.map(x=>clean(x,40)).filter(x=>METHOD_SET.has(x)))];
}
function normalizeSchedule(value){
  const v=clean(value||'provider_default',40);
  if(!SCHEDULE_SET.has(v))fail('Unsupported payout schedule preference');
  return v;
}

export async function ensureProfileFinanceSchema(pool){
  const statements=[
    `CREATE TABLE IF NOT EXISTS profile_financial_accounts(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL,
      owner_scope TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      account_kind TEXT NOT NULL,
      provider_code TEXT NOT NULL DEFAULT '',
      provider_destination_ref TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      institution_name TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      reference_last4 TEXT NOT NULL DEFAULT '',
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      can_pay BOOLEAN NOT NULL DEFAULT FALSE,
      can_receive BOOLEAN NOT NULL DEFAULT FALSE,
      can_payout BOOLEAN NOT NULL DEFAULT FALSE,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider')),
      CHECK(owner_scope IN ('account','business')),
      CHECK(account_kind IN ('cash','bank','e_wallet','paymongo_wallet','provider_clearing','other')),
      CHECK(verification_status IN ('unverified','pending','verified','rejected')),
      CHECK(status IN ('active','inactive')),
      CHECK((owner_scope='business' AND business_id IS NOT NULL) OR (owner_scope='account' AND business_id IS NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS profile_financial_accounts_owner_idx
      ON profile_financial_accounts(account_id,profile_role,business_id,status)`,
    `CREATE TABLE IF NOT EXISTS profile_money_preferences(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      default_receive_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE SET NULL,
      default_spend_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE SET NULL,
      default_payout_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE SET NULL,
      accepted_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
      payout_schedule_preference TEXT NOT NULL DEFAULT 'provider_default',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider')),
      CHECK(payout_schedule_preference IN ('provider_default','daily','weekly','biweekly','monthly','custom'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS profile_money_preferences_scope_unique
      ON profile_money_preferences(account_id,profile_role,COALESCE(business_id,0))`,
    `CREATE TABLE IF NOT EXISTS profile_finance_audit_events(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
      financial_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE SET NULL,
      event_code TEXT NOT NULL,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ];
  for(const sql of statements)await pool.query(sql);
}

export async function listProfileFinancialAccounts(pool,accountId){
  const {rows}=await pool.query(`
    SELECT f.*,b.name business_name
    FROM profile_financial_accounts f
    LEFT JOIN businesses b ON b.id=f.business_id
    WHERE f.account_id=$1
    ORDER BY f.status='active' DESC,f.profile_role,f.created_at DESC
  `,[Number(accountId)]);
  return rows.map(publicFinancialAccount);
}

export async function listMoneyPreferences(pool,accountId){
  const {rows}=await pool.query(`
    SELECT * FROM profile_money_preferences
    WHERE account_id=$1
    ORDER BY profile_role,business_id NULLS FIRST,id
  `,[Number(accountId)]);
  return rows.map(r=>({
    id:Number(r.id),profile_role:r.profile_role,business_id:r.business_id==null?null:Number(r.business_id),
    default_receive_account_id:r.default_receive_account_id==null?null:Number(r.default_receive_account_id),
    default_spend_account_id:r.default_spend_account_id==null?null:Number(r.default_spend_account_id),
    default_payout_account_id:r.default_payout_account_id==null?null:Number(r.default_payout_account_id),
    accepted_methods:Array.isArray(r.accepted_methods)?r.accepted_methods:[],
    payout_schedule_preference:r.payout_schedule_preference,updated_at:r.updated_at
  }));
}

export async function createProfileFinancialAccount(pool,{
  publicId,accountId,profileRole,ownerScope,businessId=null,accountKind,providerCode='',
  providerDestinationRef='',displayName='',institutionName='',accountName='',referenceLast4='',
  currencyCode='PHP',canPay=false,canReceive=false,canPayout=false
}){
  const role=normalizeRole(profileRole),kind=normalizeKind(accountKind);
  const scope=clean(ownerScope,20);
  if(!['account','business'].includes(scope))fail('Unsupported financial ownership scope');
  if(scope==='business'&&!Number.isInteger(Number(businessId)))fail('Business financial account requires a business workspace');
  if(scope==='account'&&businessId!=null)fail('Personal financial account cannot use a business workspace');
  const last4=normalizeLast4(referenceLast4),currency=normalizeCurrency(currencyCode);
  const providerRef=clean(providerDestinationRef,220);
  const verification=providerRef?'pending':'unverified';
  const {rows}=await pool.query(`
    INSERT INTO profile_financial_accounts(
      public_id,account_id,profile_role,owner_scope,business_id,account_kind,provider_code,provider_destination_ref,
      display_name,institution_name,account_name,reference_last4,currency_code,can_pay,can_receive,can_payout,verification_status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *
  `,[
    clean(publicId,120),Number(accountId),role,scope,scope==='business'?Number(businessId):null,kind,
    clean(providerCode,80),providerRef,clean(displayName,120),clean(institutionName,120),clean(accountName,160),
    last4,currency,Boolean(canPay),Boolean(canReceive),Boolean(canPayout),verification
  ]);
  await pool.query(`
    INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,financial_account_id,event_code,detail_json)
    VALUES($1,$2,$3,$4,'financial_account_created',$5::jsonb)
  `,[Number(accountId),role,scope==='business'?Number(businessId):null,rows[0].id,JSON.stringify({kind,provider_code:clean(providerCode,80),can_pay:Boolean(canPay),can_receive:Boolean(canReceive),can_payout:Boolean(canPayout)})]);
  return publicFinancialAccount(rows[0]);
}

export async function updateProfileFinancialAccount(pool,{
  accountId,id,displayName,institutionName,accountName,referenceLast4,providerCode,providerDestinationRef,
  canPay,canReceive,canPayout,status
}){
  const current=await pool.query('SELECT * FROM profile_financial_accounts WHERE id=$1 AND account_id=$2',[Number(id),Number(accountId)]);
  if(!current.rowCount)fail('Financial account not found',404);
  const old=current.rows[0];
  const nextStatus=status===undefined?old.status:clean(status,20);
  if(!['active','inactive'].includes(nextStatus))fail('Unsupported financial account status');
  const nextProviderRef=providerDestinationRef===undefined?old.provider_destination_ref:clean(providerDestinationRef,220);
  const nextVerification=nextProviderRef===old.provider_destination_ref
    ?old.verification_status
    :(nextProviderRef?'pending':'unverified');
  const {rows}=await pool.query(`
    UPDATE profile_financial_accounts SET
      display_name=$1,institution_name=$2,account_name=$3,reference_last4=$4,provider_code=$5,provider_destination_ref=$6,
      can_pay=$7,can_receive=$8,can_payout=$9,verification_status=$10,status=$11,updated_at=NOW()
    WHERE id=$12 AND account_id=$13 RETURNING *
  `,[
    displayName===undefined?old.display_name:clean(displayName,120),
    institutionName===undefined?old.institution_name:clean(institutionName,120),
    accountName===undefined?old.account_name:clean(accountName,160),
    referenceLast4===undefined?old.reference_last4:normalizeLast4(referenceLast4),
    providerCode===undefined?old.provider_code:clean(providerCode,80),nextProviderRef,
    canPay===undefined?old.can_pay:Boolean(canPay),canReceive===undefined?old.can_receive:Boolean(canReceive),
    canPayout===undefined?old.can_payout:Boolean(canPayout),nextVerification,nextStatus,Number(id),Number(accountId)
  ]);
  await pool.query(`
    INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,financial_account_id,event_code,detail_json)
    VALUES($1,$2,$3,$4,'financial_account_updated',$5::jsonb)
  `,[Number(accountId),old.profile_role,old.business_id,Number(id),JSON.stringify({status:nextStatus,verification_status:nextVerification})]);
  return publicFinancialAccount(rows[0]);
}

export async function upsertMoneyPreference(pool,{
  accountId,profileRole,businessId=null,defaultReceiveAccountId=null,defaultSpendAccountId=null,
  defaultPayoutAccountId=null,acceptedMethods=[],payoutSchedulePreference='provider_default'
}){
  const role=normalizeRole(profileRole),methods=normalizeMethods(acceptedMethods),schedule=normalizeSchedule(payoutSchedulePreference);
  const {rows}=await pool.query(`
    INSERT INTO profile_money_preferences(
      account_id,profile_role,business_id,default_receive_account_id,default_spend_account_id,default_payout_account_id,
      accepted_methods,payout_schedule_preference
    ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    ON CONFLICT(account_id,profile_role,(COALESCE(business_id,0))) DO UPDATE SET
      default_receive_account_id=EXCLUDED.default_receive_account_id,
      default_spend_account_id=EXCLUDED.default_spend_account_id,
      default_payout_account_id=EXCLUDED.default_payout_account_id,
      accepted_methods=EXCLUDED.accepted_methods,
      payout_schedule_preference=EXCLUDED.payout_schedule_preference,
      updated_at=NOW()
    RETURNING *
  `,[
    Number(accountId),role,businessId==null?null:Number(businessId),
    defaultReceiveAccountId==null?null:Number(defaultReceiveAccountId),
    defaultSpendAccountId==null?null:Number(defaultSpendAccountId),
    defaultPayoutAccountId==null?null:Number(defaultPayoutAccountId),
    JSON.stringify(methods),schedule
  ]);
  await pool.query(`
    INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,event_code,detail_json)
    VALUES($1,$2,$3,'money_preferences_updated',$4::jsonb)
  `,[Number(accountId),role,businessId==null?null:Number(businessId),JSON.stringify({accepted_methods:methods,payout_schedule_preference:schedule})]);
  const r=rows[0];
  return{
    id:Number(r.id),profile_role:r.profile_role,business_id:r.business_id==null?null:Number(r.business_id),
    default_receive_account_id:r.default_receive_account_id==null?null:Number(r.default_receive_account_id),
    default_spend_account_id:r.default_spend_account_id==null?null:Number(r.default_spend_account_id),
    default_payout_account_id:r.default_payout_account_id==null?null:Number(r.default_payout_account_id),
    accepted_methods:Array.isArray(r.accepted_methods)?r.accepted_methods:methods,
    payout_schedule_preference:r.payout_schedule_preference,updated_at:r.updated_at
  };
}
