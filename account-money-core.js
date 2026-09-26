const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

export const ACCOUNT_MONEY_IDENTITY_KINDS=Object.freeze(['unknown','individual','registered_business']);
export const ACCOUNT_DESTINATION_KINDS=Object.freeze(['bank','e_wallet','paymongo_wallet','other']);
export const ACCOUNT_PAYMENT_METHOD_KINDS=Object.freeze(['card','e_wallet','bank','other']);
export const ACCOUNT_MONEY_VERIFICATION_STATUSES=Object.freeze(['unverified','pending','verified','rejected']);
export const PAYOUT_DESTINATION_COOLING_HOURS=24;

const IDENTITY_SET=new Set(ACCOUNT_MONEY_IDENTITY_KINDS);
const DESTINATION_SET=new Set(ACCOUNT_DESTINATION_KINDS);
const METHOD_SET=new Set(ACCOUNT_PAYMENT_METHOD_KINDS);
const VERIFY_SET=new Set(ACCOUNT_MONEY_VERIFICATION_STATUSES);

function normalizeCurrency(v){
  const x=clean(v||'PHP',3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(x))fail('Currency code must use three letters');
  return x;
}
function normalizeLast4(v){
  const x=clean(v,4);
  if(x&&!/^[A-Za-z0-9]{1,4}$/.test(x))fail('Reference must contain only the last 1–4 letters or digits');
  return x;
}
function normalizeIdentityKind(v){
  const x=clean(v||'unknown',40);
  if(!IDENTITY_SET.has(x))fail('Unsupported account money identity type');
  return x;
}
function normalizeDestinationKind(v){
  const x=clean(v,40);
  if(!DESTINATION_SET.has(x))fail('Unsupported external destination type');
  return x;
}
function normalizeVerification(v){
  const x=clean(v||'unverified',30);
  if(!VERIFY_SET.has(x))fail('Unsupported verification status');
  return x;
}
function publicDestination(row){
  return{
    id:Number(row.id),public_id:row.public_id,destination_kind:row.destination_kind,
    provider_code:row.provider_code||'',display_name:row.display_name||'',
    institution_name:row.institution_name||'',account_name:row.account_name||'',
    reference_last4:row.reference_last4||'',currency_code:row.currency_code||'PHP',
    can_receive:Boolean(row.can_receive),can_payout:Boolean(row.can_payout),
    verification_status:row.verification_status,status:row.status,
    provider_destination_configured:Boolean(row.provider_destination_ref),
    is_default_payout:Boolean(row.is_default_payout),
    payout_security_changed_at:row.payout_security_changed_at||null,
    payout_eligible_at:row.payout_eligible_at||null,
    payout_cooling_off:Boolean(row.can_payout&&row.payout_eligible_at&&new Date(row.payout_eligible_at).getTime()>Date.now()),
    created_at:row.created_at,updated_at:row.updated_at
  };
}
function publicSavedMethod(row){
  return{
    id:Number(row.id),public_id:row.public_id,method_kind:row.method_kind,
    provider_code:row.provider_code||'',display_label:row.display_label||'',
    brand:row.brand||'',last4:row.last4||'',expiry_month:row.expiry_month==null?null:Number(row.expiry_month),
    expiry_year:row.expiry_year==null?null:Number(row.expiry_year),
    verification_status:row.verification_status,status:row.status,is_default:Boolean(row.is_default),
    provider_method_configured:Boolean(row.provider_payment_method_ref),
    consented_at:row.consented_at,created_at:row.created_at,updated_at:row.updated_at
  };
}

export async function ensureAccountMoneySchema(pool){
  const statements=[
    `CREATE TABLE IF NOT EXISTS account_money_identities(
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      country_code TEXT NOT NULL DEFAULT 'PH',
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      identity_kind TEXT NOT NULL DEFAULT 'unknown',
      legal_name TEXT NOT NULL DEFAULT '',
      provider_code TEXT NOT NULL DEFAULT '',
      provider_customer_ref TEXT NOT NULL DEFAULT '',
      provider_wallet_ref TEXT NOT NULL DEFAULT '',
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(identity_kind IN ('unknown','individual','registered_business')),
      CHECK(verification_status IN ('unverified','pending','verified','rejected'))
    )`,
    `CREATE TABLE IF NOT EXISTS account_financial_destinations(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      destination_kind TEXT NOT NULL,
      provider_code TEXT NOT NULL DEFAULT '',
      provider_destination_ref TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      institution_name TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      reference_last4 TEXT NOT NULL DEFAULT '',
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      can_receive BOOLEAN NOT NULL DEFAULT TRUE,
      can_payout BOOLEAN NOT NULL DEFAULT TRUE,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      status TEXT NOT NULL DEFAULT 'active',
      is_default_payout BOOLEAN NOT NULL DEFAULT FALSE,
      payout_security_changed_at TIMESTAMPTZ,
      payout_eligible_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(destination_kind IN ('bank','e_wallet','paymongo_wallet','other')),
      CHECK(verification_status IN ('unverified','pending','verified','rejected')),
      CHECK(status IN ('active','inactive'))
    )`,
    `CREATE INDEX IF NOT EXISTS account_financial_destinations_owner_idx
      ON account_financial_destinations(account_id,status,created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_financial_destinations_default_unique
      ON account_financial_destinations(account_id) WHERE is_default_payout=TRUE AND status='active'`,
    `ALTER TABLE account_financial_destinations ADD COLUMN IF NOT EXISTS payout_security_changed_at TIMESTAMPTZ`,
    `ALTER TABLE account_financial_destinations ADD COLUMN IF NOT EXISTS payout_eligible_at TIMESTAMPTZ`,
    `UPDATE account_financial_destinations
       SET payout_security_changed_at=COALESCE(payout_security_changed_at,created_at),
           payout_eligible_at=COALESCE(payout_eligible_at,created_at+INTERVAL '24 hours')
     WHERE can_payout=TRUE`,
    `CREATE TABLE IF NOT EXISTS account_saved_payment_methods(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      method_kind TEXT NOT NULL,
      provider_code TEXT NOT NULL,
      provider_customer_ref TEXT NOT NULL DEFAULT '',
      provider_payment_method_ref TEXT NOT NULL DEFAULT '',
      display_label TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      last4 TEXT NOT NULL DEFAULT '',
      expiry_month INTEGER,
      expiry_year INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'active',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      consented_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(method_kind IN ('card','e_wallet','bank','other')),
      CHECK(verification_status IN ('unverified','pending','verified','rejected')),
      CHECK(status IN ('active','inactive')),
      CHECK(expiry_month IS NULL OR (expiry_month BETWEEN 1 AND 12)),
      CHECK(expiry_year IS NULL OR expiry_year BETWEEN 2020 AND 2200)
    )`,
    `CREATE INDEX IF NOT EXISTS account_saved_payment_methods_owner_idx
      ON account_saved_payment_methods(account_id,status,created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_saved_payment_methods_provider_unique
      ON account_saved_payment_methods(provider_code,provider_payment_method_ref)
      WHERE provider_payment_method_ref<>''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_saved_payment_methods_default_unique
      ON account_saved_payment_methods(account_id) WHERE is_default=TRUE AND status='active'`,
    `CREATE TABLE IF NOT EXISTS account_money_audit_events(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      event_code TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS account_money_audit_owner_idx
      ON account_money_audit_events(account_id,created_at DESC,id DESC)`
  ];
  for(const sql of statements)await pool.query(sql);
}

export async function ensureAccountMoneyIdentity(pool,{accountId,legalName=''}){
  const q=await pool.query(`
    INSERT INTO account_money_identities(account_id,legal_name)
    VALUES($1,$2)
    ON CONFLICT(account_id) DO UPDATE SET
      legal_name=CASE WHEN account_money_identities.legal_name='' AND EXCLUDED.legal_name<>'' THEN EXCLUDED.legal_name ELSE account_money_identities.legal_name END,
      updated_at=account_money_identities.updated_at
    RETURNING *
  `,[Number(accountId),clean(legalName,180)]);
  return q.rows[0];
}

export async function accountMoneySettings(pool,{accountId,legalName=''}){
  const identity=await ensureAccountMoneyIdentity(pool,{accountId,legalName});
  const [destinations,methods,legacy]=await Promise.all([
    pool.query("SELECT * FROM account_financial_destinations WHERE account_id=$1 ORDER BY status='active' DESC,is_default_payout DESC,created_at DESC,id DESC",[Number(accountId)]),
    pool.query("SELECT * FROM account_saved_payment_methods WHERE account_id=$1 ORDER BY status='active' DESC,is_default DESC,created_at DESC,id DESC",[Number(accountId)]),
    pool.query("SELECT COUNT(*)::int count FROM profile_financial_accounts WHERE account_id=$1 AND status='active'",[Number(accountId)])
  ]);
  return{
    identity:{
      account_id:Number(identity.account_id),country_code:identity.country_code,currency_code:identity.currency_code,
      identity_kind:identity.identity_kind,legal_name:identity.legal_name||'',provider_code:identity.provider_code||'',
      verification_status:identity.verification_status,
      provider_customer_configured:Boolean(identity.provider_customer_ref),
      provider_wallet_configured:Boolean(identity.provider_wallet_ref),
      capabilities:identity.capabilities_json&&typeof identity.capabilities_json==='object'?identity.capabilities_json:{},
      updated_at:identity.updated_at
    },
    destinations:destinations.rows.map(publicDestination),
    saved_payment_methods:methods.rows.map(publicSavedMethod),
    legacy_profile_destination_count:Number(legacy.rows[0]?.count||0),
    security:{
      raw_bank_account_storage:false,
      raw_card_storage:false,
      card_vaulting_required:true,
      provider_balance_authority:'provider_adapter_only'
    }
  };
}

export async function updateAccountMoneyIdentity(pool,{accountId,identityKind,legalName}){
  const current=await ensureAccountMoneyIdentity(pool,{accountId});
  const kind=identityKind===undefined?current.identity_kind:normalizeIdentityKind(identityKind);
  const name=legalName===undefined?current.legal_name:clean(legalName,180);
  const q=await pool.query(`
    UPDATE account_money_identities SET identity_kind=$1,legal_name=$2,
      verification_status=CASE WHEN identity_kind<>$1 OR legal_name<>$2 THEN 'unverified' ELSE verification_status END,
      updated_at=NOW()
    WHERE account_id=$3 RETURNING *
  `,[kind,name,Number(accountId)]);
  await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'account_money_identity_updated','account_money_identity',$1::text,$2::jsonb)
  `,[Number(accountId),JSON.stringify({identity_kind:kind,legal_name_changed:name!==current.legal_name})]);
  return accountMoneySettings(pool,{accountId});
}

export async function createAccountFinancialDestination(pool,{
  publicId,accountId,destinationKind,displayName='',institutionName='',accountName='',referenceLast4='',
  currencyCode='PHP',canReceive=true,canPayout=true
}){
  const kind=normalizeDestinationKind(destinationKind),currency=normalizeCurrency(currencyCode),last4=normalizeLast4(referenceLast4);
  const label=clean(displayName,120),payoutEnabled=Boolean(canPayout);
  if(!label)fail('Destination label is required');
  const q=await pool.query(`
    INSERT INTO account_financial_destinations(
      public_id,account_id,destination_kind,display_name,institution_name,account_name,reference_last4,
      currency_code,can_receive,can_payout,verification_status,payout_security_changed_at,payout_eligible_at
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unverified',
      CASE WHEN $10 THEN NOW() END,
      CASE WHEN $10 THEN NOW()+INTERVAL '24 hours' END
    ) RETURNING *
  `,[
    clean(publicId,120),Number(accountId),kind,label,clean(institutionName,120),clean(accountName,160),last4,
    currency,Boolean(canReceive),payoutEnabled
  ]);
  await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'account_financial_destination_created','account_financial_destination',$2,$3::jsonb)
  `,[Number(accountId),String(q.rows[0].id),JSON.stringify({
    destination_kind:kind,currency_code:currency,provider_linked:false,
    payout_cooling_off:payoutEnabled,payout_cooling_hours:payoutEnabled?PAYOUT_DESTINATION_COOLING_HOURS:0
  })]);
  if(payoutEnabled)await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'payout_destination_cooling_started','account_financial_destination',$2,$3::jsonb)
  `,[Number(accountId),String(q.rows[0].id),JSON.stringify({
    reason:'destination_created',payout_eligible_at:q.rows[0].payout_eligible_at,
    cooling_hours:PAYOUT_DESTINATION_COOLING_HOURS
  })]);
  return publicDestination(q.rows[0]);
}

export async function updateAccountFinancialDestination(pool,{
  accountId,id,displayName,institutionName,accountName,referenceLast4,canReceive,canPayout,status
}){
  const cur=await pool.query("SELECT * FROM account_financial_destinations WHERE id=$1 AND account_id=$2",[Number(id),Number(accountId)]);
  if(!cur.rowCount)fail('Account financial destination not found',404);
  const old=cur.rows[0],nextStatus=status===undefined?old.status:clean(status,20);
  if(!['active','inactive'].includes(nextStatus))fail('Unsupported destination status');
  const nextDisplay=displayName===undefined?old.display_name:clean(displayName,120);
  const nextInstitution=institutionName===undefined?old.institution_name:clean(institutionName,120);
  const nextAccountName=accountName===undefined?old.account_name:clean(accountName,160);
  const nextLast4=referenceLast4===undefined?old.reference_last4:normalizeLast4(referenceLast4);
  const nextCanReceive=canReceive===undefined?old.can_receive:Boolean(canReceive);
  const nextCanPayout=canPayout===undefined?old.can_payout:Boolean(canPayout);
  const payoutSecurityChanged=Boolean(nextCanPayout&&(
    nextInstitution!==old.institution_name||
    nextAccountName!==old.account_name||
    nextLast4!==old.reference_last4||
    !old.can_payout||
    (old.status!=='active'&&nextStatus==='active')
  ));
  const q=await pool.query(`
    UPDATE account_financial_destinations SET
      display_name=$1,institution_name=$2,account_name=$3,reference_last4=$4,
      can_receive=$5,can_payout=$6,status=$7,
      is_default_payout=CASE WHEN $7='inactive' OR $6=FALSE OR $8 THEN FALSE ELSE is_default_payout END,
      payout_security_changed_at=CASE
        WHEN $8 THEN NOW()
        WHEN $6=FALSE THEN NULL
        ELSE payout_security_changed_at END,
      payout_eligible_at=CASE
        WHEN $8 THEN NOW()+INTERVAL '24 hours'
        WHEN $6=FALSE THEN NULL
        ELSE payout_eligible_at END,
      verification_status=CASE
        WHEN display_name<>$1 OR institution_name<>$2 OR account_name<>$3 OR reference_last4<>$4 THEN 'unverified'
        ELSE verification_status END,
      updated_at=NOW()
    WHERE id=$9 AND account_id=$10 RETURNING *
  `,[
    nextDisplay,nextInstitution,nextAccountName,nextLast4,nextCanReceive,nextCanPayout,nextStatus,
    payoutSecurityChanged,Number(id),Number(accountId)
  ]);
  await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'account_financial_destination_updated','account_financial_destination',$2,$3::jsonb)
  `,[Number(accountId),String(id),JSON.stringify({
    status:nextStatus,verification_status:q.rows[0].verification_status,
    payout_security_reset:payoutSecurityChanged,payout_eligible_at:q.rows[0].payout_eligible_at||null
  })]);
  if(payoutSecurityChanged)await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'payout_destination_cooling_started','account_financial_destination',$2,$3::jsonb)
  `,[Number(accountId),String(id),JSON.stringify({
    reason:'sensitive_destination_changed',payout_eligible_at:q.rows[0].payout_eligible_at,
    cooling_hours:PAYOUT_DESTINATION_COOLING_HOURS
  })]);
  return publicDestination(q.rows[0]);
}

export async function setDefaultAccountPayoutDestination(pool,{accountId,id}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query("SELECT * FROM account_financial_destinations WHERE id=$1 AND account_id=$2 AND status='active' FOR UPDATE",[Number(id),Number(accountId)]);
    if(!q.rowCount)fail('Active account payout destination not found',404);
    if(!q.rows[0].can_payout)fail('Destination is not enabled for payout',409);
    const eligibleAt=q.rows[0].payout_eligible_at?new Date(q.rows[0].payout_eligible_at).getTime():NaN;
    if(!Number.isFinite(eligibleAt)||eligibleAt>Date.now())fail('For your security, this payout destination can become default only after the 24-hour security hold ends',409);
    await client.query("UPDATE account_financial_destinations SET is_default_payout=FALSE,updated_at=NOW() WHERE account_id=$1 AND is_default_payout=TRUE",[Number(accountId)]);
    await client.query("UPDATE account_financial_destinations SET is_default_payout=TRUE,updated_at=NOW() WHERE id=$1",[Number(id)]);
    await client.query(`
      INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
      VALUES($1,'default_payout_destination_changed','account_financial_destination',$2,'{}'::jsonb)
    `,[Number(accountId),String(id)]);
    await client.query('COMMIT');
    return publicDestination((await pool.query("SELECT * FROM account_financial_destinations WHERE id=$1",[Number(id)])).rows[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

export async function attachProviderFinancialDestination(pool,{
  accountId,id,providerCode,providerDestinationRef,verificationStatus='pending'
}){
  const provider=clean(providerCode,80),ref=clean(providerDestinationRef,240),status=normalizeVerification(verificationStatus);
  if(!provider||!ref)fail('Provider destination reference is required');
  const cur=await pool.query("SELECT * FROM account_financial_destinations WHERE id=$1 AND account_id=$2",[Number(id),Number(accountId)]);
  if(!cur.rowCount)fail('Account financial destination not found',404);
  const old=cur.rows[0],payoutSecurityChanged=Boolean(
    old.can_payout&&(old.provider_code!==provider||old.provider_destination_ref!==ref)
  );
  const q=await pool.query(`
    UPDATE account_financial_destinations SET provider_code=$1,provider_destination_ref=$2,
      verification_status=$3,
      is_default_payout=CASE WHEN $4 THEN FALSE ELSE is_default_payout END,
      payout_security_changed_at=CASE WHEN $4 THEN NOW() ELSE payout_security_changed_at END,
      payout_eligible_at=CASE WHEN $4 THEN NOW()+INTERVAL '24 hours' ELSE payout_eligible_at END,
      updated_at=NOW()
    WHERE id=$5 AND account_id=$6 RETURNING *
  `,[provider,ref,status,payoutSecurityChanged,Number(id),Number(accountId)]);
  if(payoutSecurityChanged)await pool.query(`
    INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
    VALUES($1,'payout_destination_cooling_started','account_financial_destination',$2,$3::jsonb)
  `,[Number(accountId),String(id),JSON.stringify({
    reason:'provider_destination_changed',payout_eligible_at:q.rows[0].payout_eligible_at,
    cooling_hours:PAYOUT_DESTINATION_COOLING_HOURS
  })]);
  return publicDestination(q.rows[0]);
}

export async function upsertProviderSavedPaymentMethod(pool,{
  publicId,accountId,methodKind,providerCode,providerCustomerRef='',providerPaymentMethodRef,
  displayLabel='',brand='',last4='',expiryMonth=null,expiryYear=null,verificationStatus='verified',consentedAt=null,isDefault=false
}){
  const kind=clean(methodKind,30),provider=clean(providerCode,80),methodRef=clean(providerPaymentMethodRef,240);
  if(!METHOD_SET.has(kind))fail('Unsupported saved payment method type');
  if(!provider||!methodRef)fail('Provider-tokenized payment method reference is required');
  const last=normalizeLast4(last4),verify=normalizeVerification(verificationStatus);
  const month=expiryMonth==null?null:Number(expiryMonth),year=expiryYear==null?null:Number(expiryYear);
  if(month!=null&&(!Number.isInteger(month)||month<1||month>12))fail('Invalid expiry month');
  if(year!=null&&(!Number.isInteger(year)||year<2020||year>2200))fail('Invalid expiry year');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(isDefault)await client.query("UPDATE account_saved_payment_methods SET is_default=FALSE,updated_at=NOW() WHERE account_id=$1",[Number(accountId)]);
    const q=await client.query(`
      INSERT INTO account_saved_payment_methods(
        public_id,account_id,method_kind,provider_code,provider_customer_ref,provider_payment_method_ref,
        display_label,brand,last4,expiry_month,expiry_year,verification_status,status,is_default,consented_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$14)
      ON CONFLICT(provider_code,provider_payment_method_ref) WHERE provider_payment_method_ref<>'' DO UPDATE SET
        account_id=EXCLUDED.account_id,method_kind=EXCLUDED.method_kind,provider_customer_ref=EXCLUDED.provider_customer_ref,
        display_label=EXCLUDED.display_label,brand=EXCLUDED.brand,last4=EXCLUDED.last4,
        expiry_month=EXCLUDED.expiry_month,expiry_year=EXCLUDED.expiry_year,
        verification_status=EXCLUDED.verification_status,status='active',is_default=EXCLUDED.is_default,
        consented_at=COALESCE(EXCLUDED.consented_at,account_saved_payment_methods.consented_at),updated_at=NOW()
      RETURNING *
    `,[
      clean(publicId,120),Number(accountId),kind,provider,clean(providerCustomerRef,240),methodRef,
      clean(displayLabel,120),clean(brand,60),last,month,year,verify,Boolean(isDefault),consentedAt||null
    ]);
    await client.query(`
      INSERT INTO account_money_audit_events(account_id,event_code,entity_type,entity_id,detail_json)
      VALUES($1,'provider_payment_method_attached','account_saved_payment_method',$2,$3::jsonb)
    `,[Number(accountId),String(q.rows[0].id),JSON.stringify({provider_code:provider,method_kind:kind,last4:last,raw_card_storage:false})]);
    await client.query('COMMIT');
    return publicSavedMethod(q.rows[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}
