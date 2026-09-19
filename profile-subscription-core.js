import crypto from 'node:crypto';

export const SUBSCRIPTION_SERVICE_SCOPES=Object.freeze(['marketplace','supplier','local_services']);
export const SUBSCRIPTION_SCOPE_LABELS=Object.freeze({
  marketplace:'Merchant',
  supplier:'Supplier',
  local_services:'Artisan / Local Services'
});
export const SUBSCRIPTION_SUBJECT_TYPES=Object.freeze({
  marketplace:'business',
  supplier:'account',
  local_services:'account'
});
export const SUBSCRIPTION_POLICY_STATUSES=Object.freeze(['draft','approved','active','superseded','withdrawn']);
export const SUBSCRIPTION_INVOICE_STATUSES=Object.freeze(['draft','open','paid','past_due','waived','void']);

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const publicId=prefix=>prefix+'_'+crypto.randomBytes(10).toString('hex');
const validScope=v=>{
  const x=clean(v,40);
  if(!SUBSCRIPTION_SERVICE_SCOPES.includes(x))throw Object.assign(new Error('Unsupported subscription service scope'),{status:400});
  return x;
};
const nullableMoney=(v,label='monthly amount')=>{
  if(v==null||v==='')return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<0)throw Object.assign(new Error(label+' must be non-negative'),{status:400});
  return money(n);
};

export async function ensureProfileSubscriptionSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_subscription_policy_versions(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      policy_code TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      country_code TEXT NOT NULL DEFAULT 'PH',
      service_scope TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      monthly_amount NUMERIC(14,2),
      billing_interval TEXT NOT NULL DEFAULT 'monthly',
      promo_days INTEGER NOT NULL DEFAULT 90,
      description TEXT NOT NULL DEFAULT '',
      effective_from TIMESTAMPTZ,
      effective_until TIMESTAMPTZ,
      created_by_account_id BIGINT REFERENCES accounts(id),
      approved_by_account_id BIGINT REFERENCES accounts(id),
      activated_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(policy_code,version),
      CHECK(status IN ('draft','approved','active','superseded','withdrawn')),
      CHECK(service_scope IN ('marketplace','supplier','local_services')),
      CHECK(billing_interval='monthly'),
      CHECK(promo_days=90),
      CHECK(monthly_amount IS NULL OR monthly_amount>=0),
      CHECK(status<>'active' OR monthly_amount IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS profile_subscription_policy_scope_idx
      ON profile_subscription_policy_versions(country_code,service_scope,status,version DESC);

    CREATE TABLE IF NOT EXISTS profile_subscription_invoices(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      entitlement_id BIGINT NOT NULL REFERENCES service_monetization_entitlements(id) ON DELETE RESTRICT,
      policy_version_id BIGINT NOT NULL REFERENCES profile_subscription_policy_versions(id) ON DELETE RESTRICT,
      billing_period_start DATE NOT NULL,
      billing_period_end DATE NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),
      status TEXT NOT NULL DEFAULT 'draft',
      due_at TIMESTAMPTZ,
      payment_intent_id BIGINT REFERENCES payment_intents(id),
      policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_account_id BIGINT REFERENCES accounts(id),
      paid_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entitlement_id,billing_period_start),
      CHECK(status IN ('draft','open','paid','past_due','waived','void')),
      CHECK(billing_period_end>billing_period_start)
    );
    CREATE INDEX IF NOT EXISTS profile_subscription_invoice_status_idx
      ON profile_subscription_invoices(status,due_at,created_at DESC);
    CREATE INDEX IF NOT EXISTS profile_subscription_invoice_entitlement_idx
      ON profile_subscription_invoices(entitlement_id,billing_period_start DESC);
  `);
}

export async function createSubscriptionPolicyDraft(pool,input={}){
  const scope=validScope(input.serviceScope);
  const amount=nullableMoney(input.monthlyAmount);
  const code=clean(input.policyCode||('subscription_'+scope),120);
  if(!code)throw Object.assign(new Error('Subscription policy code is required'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[code]);
    const v=await client.query('SELECT COALESCE(MAX(version),0)+1 next_version FROM profile_subscription_policy_versions WHERE policy_code=$1',[code]);
    const version=Number(v.rows[0]?.next_version||1);
    const q=await client.query(`
      INSERT INTO profile_subscription_policy_versions(
        public_id,policy_code,version,status,country_code,service_scope,currency_code,
        monthly_amount,billing_interval,promo_days,description,created_by_account_id
      ) VALUES($1,$2,$3,'draft','PH',$4,'PHP',$5,'monthly',90,$6,$7)
      RETURNING *
    `,[
      publicId('subpol'),code,version,scope,amount,
      clean(input.description,1200),input.createdByAccountId||null
    ]);
    await client.query('COMMIT');
    return q.rows[0];
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

export async function listSubscriptionPolicies(pool){
  const {rows}=await pool.query(`
    SELECT * FROM profile_subscription_policy_versions
    WHERE country_code='PH'
    ORDER BY service_scope,version DESC,id DESC
  `);
  return rows;
}

export function subscriptionReadinessState({promoEndsAt,activePolicy=null,latestInvoiceStatus='',at=new Date()}={}){
  if(!promoEndsAt)return'NOT_STARTED';
  const now=at instanceof Date?at:new Date(at);
  const promoEnd=new Date(promoEndsAt);
  if(Number.isNaN(now.getTime())||Number.isNaN(promoEnd.getTime()))throw Object.assign(new Error('Invalid subscription readiness date'),{status:400});
  if(now<promoEnd)return'PROMOTIONAL';
  const invoice=clean(latestInvoiceStatus,30);
  if(invoice){
    if(!SUBSCRIPTION_INVOICE_STATUSES.includes(invoice))throw Object.assign(new Error('Unsupported subscription invoice status'),{status:400});
    if(invoice==='open')return'OPEN';
    if(invoice==='paid')return'PAID';
    if(invoice==='past_due')return'PAST_DUE';
    if(invoice==='waived')return'WAIVED';
    if(invoice==='void')return'VOID';
  }
  if(!activePolicy||activePolicy.status!=='active'||activePolicy.monthly_amount==null)return'HOLD_NO_ACTIVE_POLICY';
  return'READY_TO_INVOICE';
}

function activePolicySql(alias='e'){
  return `LEFT JOIN LATERAL (
    SELECT p.*
    FROM profile_subscription_policy_versions p
    WHERE p.country_code='PH'
      AND p.service_scope=${alias}.service_scope
      AND p.status='active'
      AND (p.effective_from IS NULL OR p.effective_from<=NOW())
      AND (p.effective_until IS NULL OR p.effective_until>NOW())
    ORDER BY p.version DESC,p.id DESC
    LIMIT 1
  ) ap ON TRUE`;
}

export async function subscriptionBillingReadiness(pool,{at=new Date()}={}){
  const now=at instanceof Date?at:new Date(at);
  if(Number.isNaN(now.getTime()))throw Object.assign(new Error('Invalid subscription readiness date'),{status:400});
  const {rows}=await pool.query(`
    SELECT e.*,
      ap.id active_policy_id,ap.public_id active_policy_public_id,ap.policy_code active_policy_code,
      ap.version active_policy_version,ap.status active_policy_status,ap.monthly_amount active_policy_monthly_amount,
      ap.currency_code active_policy_currency,
      li.status latest_invoice_status,li.public_id latest_invoice_public_id,li.amount latest_invoice_amount,
      li.billing_period_start latest_invoice_period_start,li.billing_period_end latest_invoice_period_end,
      (
        SELECT p.public_id FROM profile_subscription_policy_versions p
        WHERE p.country_code='PH' AND p.service_scope=e.service_scope
        ORDER BY p.version DESC,p.id DESC LIMIT 1
      ) latest_policy_public_id,
      (
        SELECT p.status FROM profile_subscription_policy_versions p
        WHERE p.country_code='PH' AND p.service_scope=e.service_scope
        ORDER BY p.version DESC,p.id DESC LIMIT 1
      ) latest_policy_status,
      (
        SELECT p.monthly_amount FROM profile_subscription_policy_versions p
        WHERE p.country_code='PH' AND p.service_scope=e.service_scope
        ORDER BY p.version DESC,p.id DESC LIMIT 1
      ) latest_policy_monthly_amount
    FROM service_monetization_entitlements e
    ${activePolicySql('e')}
    LEFT JOIN LATERAL (
      SELECT i.* FROM profile_subscription_invoices i
      WHERE i.entitlement_id=e.id
      ORDER BY i.billing_period_start DESC,i.id DESC LIMIT 1
    ) li ON TRUE
    WHERE e.country_code='PH'
      AND e.service_scope=ANY($1::text[])
    ORDER BY e.service_scope,e.id
  `,[SUBSCRIPTION_SERVICE_SCOPES]);

  const subjects=rows.map(r=>{
    const activePolicy=r.active_policy_id?{
      id:Number(r.active_policy_id),public_id:r.active_policy_public_id,policy_code:r.active_policy_code,
      version:Number(r.active_policy_version),status:r.active_policy_status,
      monthly_amount:r.active_policy_monthly_amount==null?null:money(r.active_policy_monthly_amount),
      currency_code:r.active_policy_currency||'PHP'
    }:null;
    const state=subscriptionReadinessState({
      promoEndsAt:r.promo_ends_at,activePolicy,latestInvoiceStatus:r.latest_invoice_status||'',at:now
    });
    return{
      entitlement_id:Number(r.id),
      service_scope:r.service_scope,
      profile_label:SUBSCRIPTION_SCOPE_LABELS[r.service_scope],
      subject_type:r.subject_type,
      subject_id:Number(r.subject_id),
      territory_id:r.territory_id==null?null:Number(r.territory_id),
      promo_started_at:r.promo_started_at,
      promo_ends_at:r.promo_ends_at,
      state,
      active_policy:activePolicy,
      latest_policy:{
        public_id:r.latest_policy_public_id||'',
        status:r.latest_policy_status||'',
        monthly_amount:r.latest_policy_monthly_amount==null?null:money(r.latest_policy_monthly_amount)
      },
      latest_invoice:r.latest_invoice_status?{
        public_id:r.latest_invoice_public_id,status:r.latest_invoice_status,
        amount:r.latest_invoice_amount==null?null:money(r.latest_invoice_amount),
        period_start:r.latest_invoice_period_start,period_end:r.latest_invoice_period_end
      }:null
    };
  });

  const summary={};
  for(const scope of SUBSCRIPTION_SERVICE_SCOPES){
    const scoped=subjects.filter(x=>x.service_scope===scope);
    const states={};
    for(const x of scoped)states[x.state]=(states[x.state]||0)+1;
    const activeAmount=scoped.find(x=>x.active_policy?.monthly_amount!=null)?.active_policy?.monthly_amount??null;
    summary[scope]={
      label:SUBSCRIPTION_SCOPE_LABELS[scope],
      entitlement_count:scoped.length,
      states,
      active_monthly_amount:activeAmount,
      ready_to_invoice:states.READY_TO_INVOICE||0,
      promotional:states.PROMOTIONAL||0,
      hold_no_active_policy:states.HOLD_NO_ACTIVE_POLICY||0,
      projected_monthly_revenue_if_ready:activeAmount==null?null:money((states.READY_TO_INVOICE||0)*activeAmount)
    };
  }
  return{
    as_of:now.toISOString(),
    country_code:'PH',
    scopes:summary,
    subjects,
    guardrails:{
      customer_subscription:false,
      delivery_subscription:false,
      promotional_days:90,
      invoice_generation:'NOT_PERFORMED',
      live_policy_activation:'NOT_AVAILABLE_IN_THIS_SLICE'
    }
  };
}
