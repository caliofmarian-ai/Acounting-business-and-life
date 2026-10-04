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
export const SUBSCRIPTION_MONTHLY_TARGET_PHP=99;
export const SUBSCRIPTION_PROMO_DAYS=90;
export const SUBSCRIPTION_LIFECYCLE_RULES=Object.freeze({
  renewal:'monthly_on_cycle_anchor_after_promo',
  cancellation:'cancel_at_period_end_no_new_cycle',
  payment_failure:'retry_days_1_3_7_then_hold',
  grace_days:7,
  retry_schedule_days:Object.freeze([1,3,7]),
  grandfathering:'invoice_keeps_policy_snapshot_new_cycles_use_current_accepted_active_policy',
  promo_transition:'no_bill_before_promo_end_and_notice_before_first_bill',
  first_bill_notice_days:7
});
export const SUBSCRIPTION_CANONICAL_PLAN_DRAFTS=Object.freeze({
  marketplace:Object.freeze({policy_code:'subscription_marketplace',label:'Merchant',monthly_amount:99}),
  supplier:Object.freeze({policy_code:'subscription_supplier',label:'Supplier',monthly_amount:99}),
  local_services:Object.freeze({policy_code:'subscription_local_services',label:'Artisan / Local Services',monthly_amount:99})
});

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
      policy_hash TEXT NOT NULL DEFAULT '',
      lifecycle_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      activation_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
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

    ALTER TABLE profile_subscription_policy_versions
      ADD COLUMN IF NOT EXISTS policy_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE profile_subscription_policy_versions
      ADD COLUMN IF NOT EXISTS lifecycle_rules JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE profile_subscription_policy_versions
      ADD COLUMN IF NOT EXISTS activation_requirements JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await ensureCanonicalSubscriptionPlanDrafts(pool);
}

function canonicalPolicyPayload({serviceScope,policyCode,monthlyAmount,description=''}) {
  const scope=validScope(serviceScope);
  const amount=nullableMoney(monthlyAmount);
  const payload={
    country_code:'PH',
    service_scope:scope,
    currency_code:'PHP',
    monthly_amount:amount,
    billing_interval:'monthly',
    promo_days:SUBSCRIPTION_PROMO_DAYS,
    description:clean(description,1200),
    lifecycle_rules:SUBSCRIPTION_LIFECYCLE_RULES,
    activation_requirements:{
      legal_reviewed_terms:true,
      provider_live_evidence:true,
      explicit_policy_approval:true,
      profile_acceptance_before_charge:true
    }
  };
  const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return{...payload,policy_code:clean(policyCode||('subscription_'+scope),120),policy_hash:hash};
}

export async function ensureCanonicalSubscriptionPlanDrafts(pool){
  for(const scope of SUBSCRIPTION_SERVICE_SCOPES){
    const draft=SUBSCRIPTION_CANONICAL_PLAN_DRAFTS[scope];
    const existing=await pool.query(
      `SELECT id FROM profile_subscription_policy_versions WHERE country_code='PH' AND policy_code=$1 ORDER BY version DESC LIMIT 1`,
      [draft.policy_code]
    );
    if(existing.rowCount)continue;
    const payload=canonicalPolicyPayload({
      serviceScope:scope,policyCode:draft.policy_code,monthlyAmount:draft.monthly_amount,
      description:`Owner pricing draft: ${draft.label} · PHP ${draft.monthly_amount}/month after the 90-day promotion. Billing remains gated.`
    });
    await pool.query(`
      INSERT INTO profile_subscription_policy_versions(
        public_id,policy_code,version,status,country_code,service_scope,currency_code,
        monthly_amount,billing_interval,promo_days,description,policy_hash,lifecycle_rules,activation_requirements
      ) VALUES($1,$2,1,'draft','PH',$3,'PHP',$4,'monthly',$5,$6,$7,$8::jsonb,$9::jsonb)
      ON CONFLICT(policy_code,version) DO NOTHING
    `,[
      publicId('subpol'),payload.policy_code,scope,payload.monthly_amount,SUBSCRIPTION_PROMO_DAYS,
      payload.description,payload.policy_hash,JSON.stringify(payload.lifecycle_rules),
      JSON.stringify(payload.activation_requirements)
    ]);
  }
}

export async function subscriptionActivationEvidence(pool){
  const provider=await pool.query(`
    SELECT provider_code,status,config_metadata,updated_at
      FROM payment_provider_configs
     WHERE country_code='PH' AND provider_code='paymongo'
     LIMIT 1
  `).catch(error=>error?.code==='42P01'?{rows:[]}:(()=>{throw error})());
  const legal=await pool.query(`
    SELECT COUNT(*)::int count
      FROM legal_document_versions v
      JOIN legal_documents d ON d.id=v.document_id
     WHERE d.country_code='PH'
       AND d.code='platform_fee_terms'
       AND d.active=TRUE
       AND v.status='active'
       AND v.authoritative=TRUE
       AND v.legal_review_status='reviewed'
       AND (v.effective_at IS NULL OR v.effective_at<=NOW())
  `).catch(error=>error?.code==='42P01'?{rows:[{count:0}]}:(()=>{throw error})());
  const p=provider.rows[0]||null,meta=p?.config_metadata||{};
  const providerReady=Boolean(
    p&&p.status==='active'&&String(meta.mode||'').toLowerCase()==='live'
    &&meta.secret_ready===true&&meta.webhook_ready===true
  );
  const legalReady=Number(legal.rows[0]?.count||0)>0;
  return{
    provider:{
      ready:providerReady,
      code:p?.provider_code||'paymongo',
      status:p?.status||'missing',
      mode:String(meta.mode||''),
      secret_ready:meta.secret_ready===true,
      webhook_ready:meta.webhook_ready===true,
      updated_at:p?.updated_at||null
    },
    legal:{
      ready:legalReady,
      document_code:'platform_fee_terms',
      active_reviewed_versions:Number(legal.rows[0]?.count||0)
    }
  };
}

export function subscriptionPolicyActivationState({policy=null,evidence={}}={}){
  if(!policy)return{state:'MISSING_DRAFT',ready:false,blockers:['plan_draft_missing']};
  if(policy.status==='active')return{state:'ACTIVE',ready:true,blockers:[]};
  const blockers=[];
  if(policy.monthly_amount==null)blockers.push('monthly_amount_missing');
  if(policy.status!=='approved')blockers.push('explicit_policy_approval_required');
  if(!evidence?.legal?.ready)blockers.push('legal_terms_not_active_reviewed');
  if(!evidence?.provider?.ready)blockers.push('live_provider_evidence_missing');
  return{state:blockers.length?'HOLD':'READY',ready:blockers.length===0,blockers};
}

export function subscriptionLifecycleSimulation({
  scenario='renewal_success',monthlyAmount=SUBSCRIPTION_MONTHLY_TARGET_PHP,promoEndsAt=null,at=new Date()
}={}){
  const allowed=['renewal_success','payment_failure','cancellation','grandfathering'];
  if(!allowed.includes(scenario))throw Object.assign(new Error('Unsupported subscription lifecycle scenario'),{status:400});
  const amount=nullableMoney(monthlyAmount);
  const now=at instanceof Date?at:new Date(at);
  const promo=promoEndsAt?new Date(promoEndsAt):null;
  if(Number.isNaN(now.getTime())||(promo&&Number.isNaN(promo.getTime())))throw Object.assign(new Error('Invalid lifecycle simulation date'),{status:400});
  if(promo&&now<promo)return{
    scenario,state:'PROMOTIONAL',charge_attempted:false,amount:0,
    next_action:'wait_until_promo_end',rules:SUBSCRIPTION_LIFECYCLE_RULES
  };
  const base={scenario,charge_attempted:false,amount:amount??0,rules:SUBSCRIPTION_LIFECYCLE_RULES};
  if(scenario==='renewal_success')return{...base,state:'TEST_RENEWAL_READY',next_action:'create_test_invoice_only_after_all_activation_gates'};
  if(scenario==='payment_failure')return{...base,state:'TEST_PAST_DUE',retry_schedule_days:[1,3,7],grace_days:7,next_action:'retry_in_test_mode_then_hold_without_real_charge'};
  if(scenario==='cancellation')return{...base,state:'CANCEL_AT_PERIOD_END',next_action:'stop_new_cycles_keep_existing_records'};
  return{...base,state:'POLICY_SNAPSHOT_PRESERVED',next_action:'existing_invoice_keeps_snapshot_new_cycle_uses_current_accepted_policy'};
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
        monthly_amount,billing_interval,promo_days,description,policy_hash,lifecycle_rules,activation_requirements,created_by_account_id
      ) VALUES($1,$2,$3,'draft','PH',$4,'PHP',$5,'monthly',$6,$7,$8,$9::jsonb,$10::jsonb,$11)
      RETURNING *
    `,[
      publicId('subpol'),code,version,scope,amount,SUBSCRIPTION_PROMO_DAYS,
      canonicalPolicyPayload({serviceScope:scope,policyCode:code,monthlyAmount:amount,description:input.description}).description,
      canonicalPolicyPayload({serviceScope:scope,policyCode:code,monthlyAmount:amount,description:input.description}).policy_hash,
      JSON.stringify(SUBSCRIPTION_LIFECYCLE_RULES),
      JSON.stringify({legal_reviewed_terms:true,provider_live_evidence:true,explicit_policy_approval:true,profile_acceptance_before_charge:true}),
      input.createdByAccountId||null
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
  const activationEvidence=await subscriptionActivationEvidence(pool);
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
    const latestPolicy=(await pool.query(`
      SELECT * FROM profile_subscription_policy_versions
       WHERE country_code='PH' AND service_scope=$1
       ORDER BY version DESC,id DESC LIMIT 1
    `,[scope])).rows[0]||null;
    const activation=subscriptionPolicyActivationState({policy:latestPolicy,evidence:activationEvidence});
    summary[scope]={
      label:SUBSCRIPTION_SCOPE_LABELS[scope],
      entitlement_count:scoped.length,
      states,
      active_monthly_amount:activeAmount,
      ready_to_invoice:states.READY_TO_INVOICE||0,
      promotional:states.PROMOTIONAL||0,
      hold_no_active_policy:states.HOLD_NO_ACTIVE_POLICY||0,
      projected_monthly_revenue_if_ready:activeAmount==null?null:money((states.READY_TO_INVOICE||0)*activeAmount),
      activation_state:activation.state,
      activation_ready:activation.ready,
      activation_blockers:activation.blockers,
      latest_plan:latestPolicy?{
        public_id:latestPolicy.public_id,policy_code:latestPolicy.policy_code,version:Number(latestPolicy.version),
        status:latestPolicy.status,monthly_amount:latestPolicy.monthly_amount==null?null:money(latestPolicy.monthly_amount),
        promo_days:Number(latestPolicy.promo_days),policy_hash:latestPolicy.policy_hash||'',
        lifecycle_rules:latestPolicy.lifecycle_rules||SUBSCRIPTION_LIFECYCLE_RULES,
        activation_requirements:latestPolicy.activation_requirements||{}
      }:null
    };
  }
  return{
    as_of:now.toISOString(),
    country_code:'PH',
    scopes:summary,
    subjects,
    activation_evidence:activationEvidence,
    lifecycle_rules:SUBSCRIPTION_LIFECYCLE_RULES,
    guardrails:{
      customer_subscription:false,
      delivery_subscription:false,
      promotional_days:SUBSCRIPTION_PROMO_DAYS,
      invoice_generation:'NOT_PERFORMED',
      live_policy_activation:'BLOCKED_UNTIL_LEGAL_PROVIDER_APPROVAL_AND_PROFILE_ACCEPTANCE',
      automatic_collection:false,
      production_charge_path:false
    }
  };
}
