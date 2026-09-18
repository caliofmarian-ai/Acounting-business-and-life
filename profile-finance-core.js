const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

export const PROFILE_FINANCE_ROLES=Object.freeze(['customer','merchant','supplier','courier','service_provider']);
export const BUSINESS_FINANCE_ROLES=Object.freeze(['merchant','supplier']);
export const FINANCIAL_ACCOUNT_KINDS=Object.freeze(['cash','bank','e_wallet','paymongo_wallet','provider_clearing','other']);
export const FINANCIAL_ACCOUNT_PURPOSES=Object.freeze(['pay','receive','payout']);
export const MONEY_METHODS=Object.freeze(['cash','ewallet','bank_transfer','card','external_transfer','online_other']);
export const PAYOUT_SCHEDULES=Object.freeze(['provider_default','daily','weekly','biweekly','monthly','custom']);
export const BUDGET_PURPOSES=Object.freeze(['operating','procurement','inventory','delivery','personal_spending','earnings_reserve','tax_reserve','emergency','custom']);
export const MONEY_MOVEMENT_TYPES=Object.freeze(['transfer','withdrawal','payout']);
export const MONEY_MOVEMENT_STATUSES=Object.freeze(['draft','pending_provider','processing','succeeded','failed','reversed','cancelled','manual_review']);

const ROLE_SET=new Set(PROFILE_FINANCE_ROLES);
const BUSINESS_ROLE_SET=new Set(BUSINESS_FINANCE_ROLES);
const KIND_SET=new Set(FINANCIAL_ACCOUNT_KINDS);
const METHOD_SET=new Set(MONEY_METHODS);
const SCHEDULE_SET=new Set(PAYOUT_SCHEDULES);
const BUDGET_PURPOSE_SET=new Set(BUDGET_PURPOSES);
const MOVEMENT_TYPE_SET=new Set(MONEY_MOVEMENT_TYPES);

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

function normalizeBudgetPurpose(value){
  const v=clean(value||'custom',40);
  if(!BUDGET_PURPOSE_SET.has(v))fail('Unsupported budget purpose');
  return v;
}
function normalizePositiveMoney(value,label='Amount'){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)fail(label+' must be greater than zero');
  return Math.round((n+Number.EPSILON)*100)/100;
}
function normalizeBudgetScope(profileRole,businessId){
  const role=normalizeRole(profileRole);
  if(BUSINESS_ROLE_SET.has(role)){
    const id=Number(businessId);
    if(!Number.isInteger(id)||id<=0)fail('Business profile budget requires a business workspace');
    return{role,businessId:id};
  }
  if(businessId!=null&&businessId!=='')fail('Personal/profile budget cannot use a business workspace');
  return{role,businessId:null};
}
async function validateLinkedFinancialAccount(pool,{accountId,profileRole,businessId,financialAccountId,currencyCode,purpose='link'}){
  if(financialAccountId==null||financialAccountId==='')return null;
  const q=await pool.query(`
    SELECT * FROM profile_financial_accounts
    WHERE id=$1 AND account_id=$2 AND profile_role=$3 AND COALESCE(business_id,0)=COALESCE($4::bigint,0) AND status='active'
  `,[Number(financialAccountId),Number(accountId),profileRole,businessId]);
  if(!q.rowCount)fail('Financial account is outside this profile/business scope',403);
  const a=q.rows[0];
  if(String(a.currency_code||'PHP')!==String(currencyCode||'PHP'))fail('Budget and financial account currencies must match',409);
  if(purpose==='source'&&!a.can_pay&&!['provider_clearing','paymongo_wallet'].includes(a.account_kind))fail('Source account is not enabled to move money',409);
  if(purpose==='transfer_destination'&&!a.can_receive)fail('Destination account is not enabled to receive money',409);
  if(purpose==='payout_destination'&&!a.can_payout)fail('Destination account is not enabled for payout/withdrawal',409);
  return a;
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
    )`,
    `CREATE TABLE IF NOT EXISTS profile_budget_envelopes(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      linked_financial_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE SET NULL,
      label TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'custom',
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider')),
      CHECK(purpose IN ('operating','procurement','inventory','delivery','personal_spending','earnings_reserve','tax_reserve','emergency','custom')),
      CHECK(status IN ('active','inactive')),
      CHECK((profile_role IN ('merchant','supplier') AND business_id IS NOT NULL) OR (profile_role IN ('customer','courier','service_provider') AND business_id IS NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS profile_budget_envelopes_scope_idx
      ON profile_budget_envelopes(account_id,profile_role,business_id,status)`,
    `CREATE TABLE IF NOT EXISTS profile_budget_entries(
      id BIGSERIAL PRIMARY KEY,
      entry_key TEXT NOT NULL UNIQUE,
      envelope_id BIGINT NOT NULL REFERENCES profile_budget_envelopes(id) ON DELETE RESTRICT,
      direction TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      source_type TEXT NOT NULL DEFAULT 'manual_plan',
      source_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      actor_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(direction IN ('credit','debit')),
      CHECK(entry_type IN ('allocation','release','adjustment','reallocation_in','reallocation_out'))
    )`,
    `CREATE INDEX IF NOT EXISTS profile_budget_entries_envelope_idx
      ON profile_budget_entries(envelope_id,created_at,id)`,
    `CREATE TABLE IF NOT EXISTS profile_budget_transfers(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      transfer_key TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      source_envelope_id BIGINT NOT NULL REFERENCES profile_budget_envelopes(id) ON DELETE RESTRICT,
      destination_envelope_id BIGINT NOT NULL REFERENCES profile_budget_envelopes(id) ON DELETE RESTRICT,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      transfer_type TEXT NOT NULL DEFAULT 'internal_budget_reallocation',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(transfer_type='internal_budget_reallocation'),
      CHECK(source_envelope_id<>destination_envelope_id)
    )`,
    `CREATE TABLE IF NOT EXISTS profile_money_movements(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL,
      source_financial_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE RESTRICT,
      destination_financial_account_id BIGINT REFERENCES profile_financial_accounts(id) ON DELETE RESTRICT,
      source_profile_role TEXT NOT NULL DEFAULT '',
      source_business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
      destination_profile_role TEXT NOT NULL DEFAULT '',
      destination_business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      provider_code TEXT NOT NULL DEFAULT '',
      provider_reference TEXT NOT NULL DEFAULT '',
      evidence_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_provider',
      hold_code TEXT NOT NULL DEFAULT 'PROVIDER_MONEY_MOVEMENT_ADAPTER_NOT_CONNECTED',
      failure_code TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      succeeded_at TIMESTAMPTZ,
      reversed_at TIMESTAMPTZ,
      CHECK(movement_type IN ('transfer','withdrawal','payout')),
      CHECK(status IN ('draft','pending_provider','processing','succeeded','failed','reversed','cancelled','manual_review'))
    )`,
    `CREATE INDEX IF NOT EXISTS profile_money_movements_owner_idx
      ON profile_money_movements(account_id,created_at DESC,status)`
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


export async function listProfileBudgetEnvelopes(pool,accountId){
  const {rows}=await pool.query(`
    SELECT e.*,f.display_name linked_account_display_name,f.account_kind linked_account_kind,
      f.verification_status linked_account_verification_status,
      COALESCE(SUM(CASE WHEN be.direction='credit' THEN be.amount ELSE -be.amount END),0) allocated_budget
    FROM profile_budget_envelopes e
    LEFT JOIN profile_financial_accounts f ON f.id=e.linked_financial_account_id
    LEFT JOIN profile_budget_entries be ON be.envelope_id=e.id
    WHERE e.account_id=$1
    GROUP BY e.id,f.display_name,f.account_kind,f.verification_status
    ORDER BY e.status='active' DESC,e.profile_role,e.business_id NULLS FIRST,e.created_at,e.id
  `,[Number(accountId)]);
  return rows.map(r=>({
    id:Number(r.id),public_id:r.public_id,profile_role:r.profile_role,
    business_id:r.business_id==null?null:Number(r.business_id),
    linked_financial_account_id:r.linked_financial_account_id==null?null:Number(r.linked_financial_account_id),
    linked_account_display_name:r.linked_account_display_name||'',
    linked_account_kind:r.linked_account_kind||'',
    linked_account_verification_status:r.linked_account_verification_status||'',
    label:r.label,purpose:r.purpose,currency_code:r.currency_code,status:r.status,
    allocated_budget:Math.round((Number(r.allocated_budget||0)+Number.EPSILON)*100)/100,
    balance_type:'planned_allocation',
    provider_cash_balance:null,
    provider_balance_status:'NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE',
    created_at:r.created_at,updated_at:r.updated_at
  }));
}

export async function createProfileBudgetEnvelope(pool,{
  publicId,accountId,profileRole,businessId=null,linkedFinancialAccountId=null,
  label,purpose='custom',currencyCode='PHP'
}){
  const scope=normalizeBudgetScope(profileRole,businessId),currency=normalizeCurrency(currencyCode);
  const name=clean(label,120);
  if(!name)fail('Budget label is required');
  const p=normalizeBudgetPurpose(purpose);
  await validateLinkedFinancialAccount(pool,{
    accountId,profileRole:scope.role,businessId:scope.businessId,
    financialAccountId:linkedFinancialAccountId,currencyCode:currency
  });
  const {rows}=await pool.query(`
    INSERT INTO profile_budget_envelopes(
      public_id,account_id,profile_role,business_id,linked_financial_account_id,label,purpose,currency_code
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `,[
    clean(publicId,120),Number(accountId),scope.role,scope.businessId,
    linkedFinancialAccountId==null?null:Number(linkedFinancialAccountId),name,p,currency
  ]);
  await pool.query(`
    INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,financial_account_id,event_code,detail_json)
    VALUES($1,$2,$3,$4,'budget_envelope_created',$5::jsonb)
  `,[
    Number(accountId),scope.role,scope.businessId,linkedFinancialAccountId==null?null:Number(linkedFinancialAccountId),
    JSON.stringify({budget_envelope_id:Number(rows[0].id),label:name,purpose:p,currency_code:currency})
  ]);
  return (await listProfileBudgetEnvelopes(pool,accountId)).find(x=>x.id===Number(rows[0].id));
}

export async function postProfileBudgetEntry(pool,{
  accountId,envelopeId,entryKey,direction='credit',entryType='allocation',amount,
  sourceType='manual_plan',sourceId='',note='',actorAccountId=null
}){
  if(!['credit','debit'].includes(direction))fail('Unsupported budget entry direction');
  if(!['allocation','release','adjustment'].includes(entryType))fail('Unsupported manual budget entry type');
  const value=normalizePositiveMoney(amount,'Budget amount'),key=clean(entryKey,220);
  if(!key)fail('Idempotency key is required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT * FROM profile_budget_entries WHERE entry_key=$1',[key]);
    if(existing.rowCount){await client.query('COMMIT');return existing.rows[0]}
    const env=await client.query('SELECT * FROM profile_budget_envelopes WHERE id=$1 AND account_id=$2 FOR UPDATE',[Number(envelopeId),Number(accountId)]);
    if(!env.rowCount)fail('Budget envelope not found',404);
    if(env.rows[0].status!=='active')fail('Budget envelope is inactive',409);
    const bal=await client.query(`
      SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) balance
      FROM profile_budget_entries WHERE envelope_id=$1
    `,[Number(envelopeId)]);
    const current=Math.round((Number(bal.rows[0].balance||0)+Number.EPSILON)*100)/100;
    if(direction==='debit'&&value>current+0.001)fail('Budget reduction exceeds the allocated budget',409);
    const q=await client.query(`
      INSERT INTO profile_budget_entries(entry_key,envelope_id,direction,entry_type,amount,source_type,source_id,note,actor_account_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `,[
      key,Number(envelopeId),direction,entryType,value,clean(sourceType,80),clean(sourceId,160),clean(note,500),actorAccountId||Number(accountId)
    ]);
    await client.query(`
      INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,event_code,detail_json)
      VALUES($1,$2,$3,'budget_allocation_changed',$4::jsonb)
    `,[
      Number(accountId),env.rows[0].profile_role,env.rows[0].business_id,
      JSON.stringify({budget_envelope_id:Number(envelopeId),direction,entry_type:entryType,amount:value,balance_before:current})
    ]);
    await client.query('COMMIT');
    return q.rows[0];
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

export async function transferProfileBudgetAllocation(pool,{
  publicId,transferKey,accountId,sourceEnvelopeId,destinationEnvelopeId,amount,actorAccountId=null,note=''
}){
  const value=normalizePositiveMoney(amount,'Transfer amount'),key=clean(transferKey,220);
  if(!key)fail('Idempotency key is required');
  if(Number(sourceEnvelopeId)===Number(destinationEnvelopeId))fail('Choose two different budget envelopes');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT * FROM profile_budget_transfers WHERE transfer_key=$1',[key]);
    if(existing.rowCount){await client.query('COMMIT');return existing.rows[0]}
    const ids=[Number(sourceEnvelopeId),Number(destinationEnvelopeId)].sort((a,b)=>a-b);
    const q=await client.query(`
      SELECT * FROM profile_budget_envelopes
      WHERE id=ANY($1::bigint[]) AND account_id=$2
      ORDER BY id FOR UPDATE
    `,[ids,Number(accountId)]);
    if(q.rowCount!==2)fail('Budget envelope not found in this account',404);
    const source=q.rows.find(x=>Number(x.id)===Number(sourceEnvelopeId));
    const destination=q.rows.find(x=>Number(x.id)===Number(destinationEnvelopeId));
    if(source.status!=='active'||destination.status!=='active')fail('Both budget envelopes must be active',409);
    if(source.currency_code!==destination.currency_code)fail('Budget reallocation requires the same currency',409);
    const bal=await client.query(`
      SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) balance
      FROM profile_budget_entries WHERE envelope_id=$1
    `,[source.id]);
    const available=Math.round((Number(bal.rows[0].balance||0)+Number.EPSILON)*100)/100;
    if(value>available+0.001)fail('Budget reallocation exceeds the source allocated budget',409);
    const t=await client.query(`
      INSERT INTO profile_budget_transfers(public_id,transfer_key,account_id,source_envelope_id,destination_envelope_id,amount,currency_code)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `,[clean(publicId,120),key,Number(accountId),source.id,destination.id,value,source.currency_code]);
    await client.query(`
      INSERT INTO profile_budget_entries(entry_key,envelope_id,direction,entry_type,amount,source_type,source_id,note,actor_account_id)
      VALUES
      ($1,$2,'debit','reallocation_out',$3,'internal_budget_reallocation',$4,$5,$6),
      ($7,$8,'credit','reallocation_in',$3,'internal_budget_reallocation',$4,$5,$6)
    `,[
      key+':out',source.id,value,String(t.rows[0].id),clean(note,500),actorAccountId||Number(accountId),
      key+':in',destination.id
    ]);
    await client.query(`
      INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,event_code,detail_json)
      VALUES($1,$2,$3,'internal_budget_reallocation',$4::jsonb)
    `,[
      Number(accountId),source.profile_role,source.business_id,
      JSON.stringify({
        transfer_id:Number(t.rows[0].id),source_envelope_id:Number(source.id),
        destination_envelope_id:Number(destination.id),destination_profile_role:destination.profile_role,
        destination_business_id:destination.business_id==null?null:Number(destination.business_id),
        amount:value,currency_code:source.currency_code,budget_only:true
      })
    ]);
    await client.query('COMMIT');
    return{...t.rows[0],execution_type:'INTERNAL_BUDGET_REALLOCATION',provider_money_moved:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

export async function listProfileMoneyMovements(pool,accountId){
  const {rows}=await pool.query(`
    SELECT m.*,
      s.display_name source_account_name,s.reference_last4 source_last4,s.account_kind source_account_kind,
      d.display_name destination_account_name,d.reference_last4 destination_last4,d.account_kind destination_account_kind
    FROM profile_money_movements m
    LEFT JOIN profile_financial_accounts s ON s.id=m.source_financial_account_id
    LEFT JOIN profile_financial_accounts d ON d.id=m.destination_financial_account_id
    WHERE m.account_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 200
  `,[Number(accountId)]);
  return rows.map(r=>({
    id:Number(r.id),public_id:r.public_id,movement_type:r.movement_type,
    source_financial_account_id:r.source_financial_account_id==null?null:Number(r.source_financial_account_id),
    destination_financial_account_id:r.destination_financial_account_id==null?null:Number(r.destination_financial_account_id),
    source_profile_role:r.source_profile_role,source_business_id:r.source_business_id==null?null:Number(r.source_business_id),
    destination_profile_role:r.destination_profile_role,destination_business_id:r.destination_business_id==null?null:Number(r.destination_business_id),
    source_account_name:r.source_account_name||'',source_last4:r.source_last4||'',source_account_kind:r.source_account_kind||'',
    destination_account_name:r.destination_account_name||'',destination_last4:r.destination_last4||'',destination_account_kind:r.destination_account_kind||'',
    amount:Number(r.amount),currency_code:r.currency_code,provider_code:r.provider_code||'',
    status:r.status,hold_code:r.hold_code||'',provider_reference:r.provider_reference||'',
    evidence_reference:r.evidence_reference||'',failure_code:r.failure_code||'',note:r.note||'',
    execution_ready:r.status!=='pending_provider'&&!r.hold_code,created_at:r.created_at,updated_at:r.updated_at
  }));
}

export async function createProfileMoneyMovementRequest(pool,{
  publicId,idempotencyKey,accountId,movementType,sourceFinancialAccountId,destinationFinancialAccountId,
  amount,currencyCode='PHP',providerCode='',note=''
}){
  const type=clean(movementType,30);
  if(!MOVEMENT_TYPE_SET.has(type))fail('Unsupported money movement type');
  const value=normalizePositiveMoney(amount,'Transfer amount'),currency=normalizeCurrency(currencyCode),key=clean(idempotencyKey,220);
  if(!key)fail('Idempotency key is required');
  const existing=await pool.query('SELECT * FROM profile_money_movements WHERE idempotency_key=$1',[key]);
  if(existing.rowCount)return (await listProfileMoneyMovements(pool,accountId)).find(x=>x.id===Number(existing.rows[0].id));
  if(sourceFinancialAccountId==null||destinationFinancialAccountId==null)fail('Source and destination financial accounts are required');
  const sourceQ=await pool.query('SELECT * FROM profile_financial_accounts WHERE id=$1 AND account_id=$2 AND status=\'active\'',[Number(sourceFinancialAccountId),Number(accountId)]);
  const destQ=await pool.query('SELECT * FROM profile_financial_accounts WHERE id=$1 AND account_id=$2 AND status=\'active\'',[Number(destinationFinancialAccountId),Number(accountId)]);
  if(!sourceQ.rowCount||!destQ.rowCount)fail('Financial account is outside this account or inactive',403);
  const source=sourceQ.rows[0],destination=destQ.rows[0];
  if(Number(source.id)===Number(destination.id))fail('Choose different source and destination accounts');
  if(source.currency_code!==currency||destination.currency_code!==currency)fail('Movement currency must match both financial accounts',409);
  if(type==='transfer'){
    if(!source.can_pay&&!['provider_clearing','paymongo_wallet'].includes(source.account_kind))fail('Source account is not enabled to transfer money',409);
    if(!destination.can_receive)fail('Destination account is not enabled to receive money',409);
  }else{
    if(!source.can_pay&&!['provider_clearing','paymongo_wallet'].includes(source.account_kind))fail('Source account is not enabled for payout/withdrawal',409);
    if(!destination.can_payout)fail('Destination account is not enabled as a payout/withdrawal destination',409);
  }
  const provider=clean(providerCode||source.provider_code||destination.provider_code,80);
  const {rows}=await pool.query(`
    INSERT INTO profile_money_movements(
      public_id,idempotency_key,account_id,movement_type,
      source_financial_account_id,destination_financial_account_id,
      source_profile_role,source_business_id,destination_profile_role,destination_business_id,
      amount,currency_code,provider_code,status,hold_code,note
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_provider','PROVIDER_MONEY_MOVEMENT_ADAPTER_NOT_CONNECTED',$14)
    RETURNING *
  `,[
    clean(publicId,120),key,Number(accountId),type,Number(source.id),Number(destination.id),
    source.profile_role,source.business_id,destination.profile_role,destination.business_id,
    value,currency,provider,clean(note,500)
  ]);
  await pool.query(`
    INSERT INTO profile_finance_audit_events(account_id,profile_role,business_id,financial_account_id,event_code,detail_json)
    VALUES($1,$2,$3,$4,'money_movement_request_created',$5::jsonb)
  `,[
    Number(accountId),source.profile_role,source.business_id,Number(source.id),
    JSON.stringify({
      movement_id:Number(rows[0].id),movement_type:type,destination_financial_account_id:Number(destination.id),
      destination_profile_role:destination.profile_role,destination_business_id:destination.business_id==null?null:Number(destination.business_id),
      amount:value,currency_code:currency,status:'pending_provider',provider_money_moved:false
    })
  ]);
  return (await listProfileMoneyMovements(pool,accountId)).find(x=>x.id===Number(rows[0].id));
}
