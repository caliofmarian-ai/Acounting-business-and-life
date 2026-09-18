import crypto from 'node:crypto';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const hash=v=>crypto.createHash('sha256').update(String(v??''),'utf8').digest('hex');

export const PAYMENT_COMPONENTS=Object.freeze([
  'merchandise','delivery','platform_fee','country_operator_fee','territory_operator_fee',
  'processor_fee','tax','withholding','refund','merchant_net','supplier_net','service_provider_net','courier_net'
]);

export async function ensurePaymentSchema(pool){
  const statements=[
    "CREATE TABLE IF NOT EXISTS payment_provider_configs(id BIGSERIAL PRIMARY KEY,provider_code TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,adapter_version TEXT NOT NULL DEFAULT 'unconfigured',status TEXT NOT NULL DEFAULT 'disabled',country_code TEXT NOT NULL DEFAULT 'PH',supported_methods JSONB NOT NULL DEFAULT '[]'::jsonb,ledger_account TEXT NOT NULL DEFAULT 'other',config_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(status IN ('disabled','sandbox','active','suspended')),CHECK(ledger_account IN ('cash','gcash','bank','other')))",
    "CREATE TABLE IF NOT EXISTS fee_policy_versions(id BIGSERIAL PRIMARY KEY,policy_code TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',country_code TEXT NOT NULL DEFAULT 'PH',territory_id BIGINT REFERENCES territories(id),business_id BIGINT REFERENCES businesses(id),service_scope TEXT NOT NULL DEFAULT 'marketplace',currency_code TEXT NOT NULL DEFAULT 'PHP',description TEXT NOT NULL DEFAULT '',protected_platform_policy BOOLEAN NOT NULL DEFAULT TRUE,effective_from TIMESTAMPTZ,effective_until TIMESTAMPTZ,created_by_account_id BIGINT REFERENCES accounts(id),activated_by_account_id BIGINT REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(policy_code,version),CHECK(status IN ('draft','approved','active','superseded','withdrawn')),CHECK(service_scope IN ('marketplace','delivery','supplier','local_services','all')))",
    "CREATE TABLE IF NOT EXISTS payment_intents(id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,source_type TEXT NOT NULL,source_id BIGINT NOT NULL,payer_account_id BIGINT REFERENCES accounts(id),business_id BIGINT REFERENCES businesses(id),territory_id BIGINT REFERENCES territories(id),provider_code TEXT NOT NULL DEFAULT '',provider_intent_id TEXT NOT NULL DEFAULT '',logical_method TEXT NOT NULL,currency_code TEXT NOT NULL DEFAULT 'PHP',amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),status TEXT NOT NULL DEFAULT 'requires_provider',provider_status TEXT NOT NULL DEFAULT '',fee_policy_version_id BIGINT REFERENCES fee_policy_versions(id),client_reference TEXT NOT NULL DEFAULT '',failure_code TEXT NOT NULL DEFAULT '',failure_message TEXT NOT NULL DEFAULT '',expires_at TIMESTAMPTZ,succeeded_at TIMESTAMPTZ,cancelled_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(source_type IN ('order','purchase_order','service_job','external')),CHECK(logical_method IN ('cash','external_transfer','ewallet','bank_transfer','card','online_other')),CHECK(status IN ('requires_provider','requires_action','processing','succeeded','failed','cancelled','refunded','partially_refunded')))",
    "CREATE INDEX IF NOT EXISTS payment_intents_source_idx ON payment_intents(source_type,source_id,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS payment_intents_provider_idx ON payment_intents(provider_code,provider_intent_id)",
    "CREATE TABLE IF NOT EXISTS payment_attempts(id BIGSERIAL PRIMARY KEY,payment_intent_id BIGINT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,attempt_no INTEGER NOT NULL,provider_code TEXT NOT NULL DEFAULT '',provider_attempt_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'created',amount NUMERIC(14,2) NOT NULL,currency_code TEXT NOT NULL DEFAULT 'PHP',failure_code TEXT NOT NULL DEFAULT '',failure_message TEXT NOT NULL DEFAULT '',started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,UNIQUE(payment_intent_id,attempt_no),CHECK(status IN ('created','requires_action','processing','succeeded','failed','cancelled')))",
    "CREATE TABLE IF NOT EXISTS provider_events(id BIGSERIAL PRIMARY KEY,provider_code TEXT NOT NULL,provider_event_id TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT '',payment_intent_id BIGINT REFERENCES payment_intents(id),payload_sha256 TEXT NOT NULL,sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,signature_verified BOOLEAN NOT NULL DEFAULT FALSE,replay_key TEXT NOT NULL DEFAULT '',processing_status TEXT NOT NULL DEFAULT 'received',error_code TEXT NOT NULL DEFAULT '',received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),processed_at TIMESTAMPTZ,UNIQUE(provider_code,provider_event_id),CHECK(processing_status IN ('received','processed','ignored','failed','manual_review')))",
    "CREATE TABLE IF NOT EXISTS fee_policy_rules(id BIGSERIAL PRIMARY KEY,fee_policy_version_id BIGINT NOT NULL REFERENCES fee_policy_versions(id) ON DELETE CASCADE,component_code TEXT NOT NULL,base_component TEXT NOT NULL,charged_to TEXT NOT NULL,beneficiary_type TEXT NOT NULL,beneficiary_ref TEXT NOT NULL DEFAULT '',calculation_type TEXT NOT NULL,rate NUMERIC(18,8),fixed_amount NUMERIC(14,2),min_amount NUMERIC(14,2),max_amount NUMERIC(14,2),sort_order INTEGER NOT NULL DEFAULT 100,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(component_code IN ('platform_fee','country_operator_fee','territory_operator_fee','processor_fee','tax','withholding')),CHECK(base_component IN ('merchandise','delivery','gross_payment')),CHECK(charged_to IN ('payer_addon','merchant_deduction','supplier_deduction','service_provider_deduction','courier_deduction','platform_cost')),CHECK(beneficiary_type IN ('platform','country_operator','territory_operator','processor','tax_authority','other')),CHECK(calculation_type IN ('percentage','fixed')))",
    "CREATE TABLE IF NOT EXISTS payment_allocations(id BIGSERIAL PRIMARY KEY,payment_intent_id BIGINT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,component_code TEXT NOT NULL,economic_party_type TEXT NOT NULL,economic_party_id TEXT NOT NULL DEFAULT '',gross_base NUMERIC(14,2) NOT NULL DEFAULT 0,amount NUMERIC(14,2) NOT NULL,currency_code TEXT NOT NULL DEFAULT 'PHP',fee_policy_version_id BIGINT REFERENCES fee_policy_versions(id),rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,settlement_status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(component_code IN ('merchandise','delivery','platform_fee','country_operator_fee','territory_operator_fee','processor_fee','tax','withholding','refund','merchant_net','supplier_net','service_provider_net','courier_net')),CHECK(settlement_status IN ('pending','eligible','held','processing','paid','failed','reversed','manual_review')))",
    "CREATE INDEX IF NOT EXISTS payment_allocations_intent_idx ON payment_allocations(payment_intent_id,id)",
    "CREATE TABLE IF NOT EXISTS refunds(id BIGSERIAL PRIMARY KEY,payment_intent_id BIGINT NOT NULL REFERENCES payment_intents(id) ON DELETE RESTRICT,public_id TEXT NOT NULL UNIQUE,provider_refund_id TEXT NOT NULL DEFAULT '',amount NUMERIC(14,2) NOT NULL CHECK(amount>0),currency_code TEXT NOT NULL DEFAULT 'PHP',reason TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'requested',requested_by_account_id BIGINT REFERENCES accounts(id),provider_status TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),processed_at TIMESTAMPTZ,CHECK(status IN ('requested','processing','succeeded','failed','cancelled','manual_review')))",
    "CREATE TABLE IF NOT EXISTS settlements(id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,beneficiary_type TEXT NOT NULL,beneficiary_ref TEXT NOT NULL,provider_code TEXT NOT NULL DEFAULT '',provider_settlement_id TEXT NOT NULL DEFAULT '',currency_code TEXT NOT NULL DEFAULT 'PHP',gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',evidence_reference TEXT NOT NULL DEFAULT '',period_start TIMESTAMPTZ,period_end TIMESTAMPTZ,created_by_account_id BIGINT REFERENCES accounts(id),paid_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(status IN ('pending','eligible','held','processing','paid','failed','reversed','manual_review')))",
    "CREATE TABLE IF NOT EXISTS settlement_lines(id BIGSERIAL PRIMARY KEY,settlement_id BIGINT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,payment_allocation_id BIGINT NOT NULL REFERENCES payment_allocations(id) ON DELETE RESTRICT,amount NUMERIC(14,2) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(settlement_id,payment_allocation_id))",
    "CREATE TABLE IF NOT EXISTS reconciliation_runs(id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,provider_code TEXT NOT NULL,period_start TIMESTAMPTZ NOT NULL,period_end TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'running',internal_payment_total NUMERIC(14,2) NOT NULL DEFAULT 0,provider_payment_total NUMERIC(14,2) NOT NULL DEFAULT 0,internal_settlement_total NUMERIC(14,2) NOT NULL DEFAULT 0,provider_settlement_total NUMERIC(14,2) NOT NULL DEFAULT 0,mismatch_count INTEGER NOT NULL DEFAULT 0,statement_sha256 TEXT NOT NULL DEFAULT '',started_by_account_id BIGINT REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,CHECK(status IN ('running','matched','mismatch','failed','manual_review')))",
    "CREATE TABLE IF NOT EXISTS reconciliation_items(id BIGSERIAL PRIMARY KEY,reconciliation_run_id BIGINT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,item_type TEXT NOT NULL,internal_ref TEXT NOT NULL DEFAULT '',provider_ref TEXT NOT NULL DEFAULT '',internal_amount NUMERIC(14,2),provider_amount NUMERIC(14,2),variance NUMERIC(14,2),status TEXT NOT NULL,detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(item_type IN ('payment','refund','settlement','balance')),CHECK(status IN ('matched','missing_internal','missing_provider','amount_mismatch','manual_review')))",
    "CREATE TABLE IF NOT EXISTS payment_audit_events(id BIGSERIAL PRIMARY KEY,actor_account_id BIGINT REFERENCES accounts(id),payment_intent_id BIGINT REFERENCES payment_intents(id),event_code TEXT NOT NULL,provider_code TEXT NOT NULL DEFAULT '',before_json JSONB,after_json JSONB,reason TEXT NOT NULL DEFAULT '',correlation_id TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    "ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS payment_intent_id BIGINT",
    "CREATE UNIQUE INDEX IF NOT EXISTS order_payments_payment_intent_unique ON order_payments(payment_intent_id) WHERE payment_intent_id IS NOT NULL"
  ];
  for(const sql of statements)await pool.query(sql);
  const fk=await pool.query("SELECT 1 FROM pg_constraint WHERE conname='order_payments_payment_intent_id_fkey'");
  if(!fk.rowCount)await pool.query("ALTER TABLE order_payments ADD CONSTRAINT order_payments_payment_intent_id_fkey FOREIGN KEY(payment_intent_id) REFERENCES payment_intents(id) ON DELETE RESTRICT");
}

export function normalizeMethod(method){
  const m=clean(method,40).toLowerCase();
  if(m==='cash')return'cash';
  if(['gcash','maya','ewallet','wallet'].includes(m))return'ewallet';
  if(['bank','bank_transfer'].includes(m))return'bank_transfer';
  if(['card','credit_card','debit_card'].includes(m))return'card';
  if(['external_transfer','manual_external'].includes(m))return'external_transfer';
  return'online_other';
}

export function sanitizeProviderPayload(payload){
  const blocked=/secret|password|token|authorization|card|pan|cvv|cvc|expiry|account_number|routing|bank_account|customer_email|customer_phone/i;
  function walk(v,depth=0){
    if(depth>5)return'[truncated]';
    if(Array.isArray(v))return v.slice(0,50).map(x=>walk(x,depth+1));
    if(v&&typeof v==='object'){
      const out={};
      for(const [k,val] of Object.entries(v))out[clean(k,80)]=blocked.test(k)?'[redacted]':walk(val,depth+1);
      return out;
    }
    if(typeof v==='string')return clean(v,1000);
    if(typeof v==='number'||typeof v==='boolean'||v==null)return v;
    return clean(v,300);
  }
  return walk(payload);
}

export async function backfillLegacyOrderPayments(pool){
  const {rows}=await pool.query("SELECT p.id legacy_payment_id,p.order_id,p.amount,p.merchandise_amount,p.delivery_amount,p.account,p.method_code,p.provider_code,p.provider_reference,p.status,p.created_at,o.customer_account_id,o.business_id,o.currency_code,b.territory_id FROM order_payments p JOIN orders o ON o.id=p.order_id JOIN businesses b ON b.id=o.business_id WHERE p.status='confirmed' AND p.payment_intent_id IS NULL ORDER BY p.id LIMIT 5000");
  for(const p of rows){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const key='legacy-order-payment:'+p.legacy_payment_id;
      const q=await client.query("INSERT INTO payment_intents(public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,territory_id,provider_code,provider_intent_id,logical_method,currency_code,amount,status,provider_status,succeeded_at,created_at,updated_at) VALUES($1,$2,'order',$3,$4,$5,$6,$7,$8,$9,$10,$11,'succeeded','legacy_confirmed',$12,$12,$12) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=payment_intents.updated_at RETURNING id",[
        'pi_legacy_'+p.legacy_payment_id,key,p.order_id,p.customer_account_id,p.business_id,p.territory_id,clean(p.provider_code,80),clean(p.provider_reference,160),normalizeMethod(p.method_code),p.currency_code||'PHP',money(p.amount),p.created_at
      ]);
      const intentId=Number(q.rows[0].id);
      if(Number(p.merchandise_amount)>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) SELECT $1,'merchandise','merchant_business',$2,$3,$3,$4,'eligible','{\"source\":\"legacy_order_payment\"}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='merchandise')",[intentId,String(p.business_id),money(p.merchandise_amount),p.currency_code||'PHP']);
      if(Number(p.delivery_amount)>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) SELECT $1,'delivery','delivery_service','',$2,$2,$3,'eligible','{\"source\":\"legacy_order_payment\"}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='delivery')",[intentId,money(p.delivery_amount),p.currency_code||'PHP']);
      await client.query("UPDATE order_payments SET payment_intent_id=$1 WHERE id=$2 AND payment_intent_id IS NULL",[intentId,p.legacy_payment_id]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  }
  return rows.length;
}

async function insertBaseOrderAllocations(client,intent,order){
  const existing=await client.query("SELECT COALESCE(SUM(merchandise_amount),0) merchandise,COALESCE(SUM(delivery_amount),0) delivery FROM order_payments WHERE order_id=$1 AND status='confirmed'",[order.id]);
  let remaining=money(intent.amount);
  const merchRemaining=Math.max(0,money(Number(order.subtotal)-Number(existing.rows[0].merchandise)));
  const deliveryRemaining=Math.max(0,money(Number(order.delivery_fee)-Number(existing.rows[0].delivery)));
  const merchandise=money(Math.min(remaining,merchRemaining));remaining=money(remaining-merchandise);
  const delivery=money(Math.min(remaining,deliveryRemaining));remaining=money(remaining-delivery);
  if(Math.abs(remaining)>0.001)throw Object.assign(new Error('Order allocation does not equal payment amount'),{status:409});
  if(merchandise>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) VALUES($1,'merchandise','merchant_business',$2,$3,$3,$4,'pending','{\"policy\":\"none\",\"kind\":\"base\"}'::jsonb)",[intent.id,String(order.business_id),merchandise,order.currency_code||'PHP']);
  if(delivery>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) VALUES($1,'delivery','delivery_service','',$2,$2,$3,'pending','{\"policy\":\"none\",\"kind\":\"base\"}'::jsonb)",[intent.id,delivery,order.currency_code||'PHP']);
}

export async function createOrderPaymentIntent(pool,{orderId,payerAccountId,idempotencyKey,logicalMethod='online_other',providerCode='',clientReference=''}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query("SELECT o.*,b.territory_id FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1 FOR UPDATE OF o",[Number(orderId)]);
    if(!q.rowCount)throw Object.assign(new Error('Order not found'),{status:404});
    const o=q.rows[0];
    if(Number(o.customer_account_id)!==Number(payerAccountId))throw Object.assign(new Error('This order belongs to another Customer'),{status:403});
    if(o.payment_method!=='online')throw Object.assign(new Error('This order is not configured for online payment'),{status:409});
    const outstanding=money(o.outstanding_amount);
    if(outstanding<=0)throw Object.assign(new Error('Order is already paid'),{status:409});
    const key=clean(idempotencyKey,220);
    if(!key)throw Object.assign(new Error('Idempotency key is required'),{status:400});
    const existing=await client.query("SELECT * FROM payment_intents WHERE idempotency_key=$1",[key]);
    if(existing.rowCount){await client.query('COMMIT');return existing.rows[0]}
    const provider=clean(providerCode,80);
    const configured=provider?await client.query("SELECT 1 FROM payment_provider_configs WHERE provider_code=$1 AND status IN ('sandbox','active')",[provider]):{rowCount:0};
    const ins=await client.query("INSERT INTO payment_intents(public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,territory_id,provider_code,logical_method,currency_code,amount,status,client_reference,expires_at) VALUES($1,$2,'order',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()+INTERVAL '30 minutes') RETURNING *",[
      'pi_'+crypto.randomBytes(16).toString('hex'),key,o.id,payerAccountId,o.business_id,o.territory_id,provider,normalizeMethod(logicalMethod),o.currency_code||'PHP',outstanding,configured.rowCount?'requires_action':'requires_provider',clean(clientReference,200)
    ]);
    await insertBaseOrderAllocations(client,ins.rows[0],o);
    await client.query('COMMIT');
    return ins.rows[0];
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}


export async function mirrorConfirmedOrderPayment(pool,orderPaymentId){
  const q=await pool.query("SELECT p.id legacy_payment_id,p.payment_intent_id,p.order_id,p.amount,p.merchandise_amount,p.delivery_amount,p.account,p.method_code,p.provider_code,p.provider_reference,p.status,p.created_at,o.customer_account_id,o.business_id,o.currency_code,b.territory_id FROM order_payments p JOIN orders o ON o.id=p.order_id JOIN businesses b ON b.id=o.business_id WHERE p.id=$1 AND p.status='confirmed'",[Number(orderPaymentId)]);
  if(!q.rowCount)return null;
  const p=q.rows[0];
  if(p.payment_intent_id)return paymentIntentDetail(pool,p.payment_intent_id);
  const client=await pool.connect();
  let intentId=null;
  try{
    await client.query('BEGIN');
    const locked=await client.query("SELECT payment_intent_id FROM order_payments WHERE id=$1 FOR UPDATE",[p.legacy_payment_id]);
    if(locked.rows[0]?.payment_intent_id){
      intentId=Number(locked.rows[0].payment_intent_id);
      await client.query('COMMIT');
      return paymentIntentDetail(pool,intentId);
    }
    const key='legacy-order-payment:'+p.legacy_payment_id;
    const ins=await client.query("INSERT INTO payment_intents(public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,territory_id,provider_code,provider_intent_id,logical_method,currency_code,amount,status,provider_status,succeeded_at,created_at,updated_at) VALUES($1,$2,'order',$3,$4,$5,$6,$7,$8,$9,$10,$11,'succeeded','legacy_confirmed',$12,$12,$12) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=payment_intents.updated_at RETURNING id",[
      'pi_legacy_'+p.legacy_payment_id,key,p.order_id,p.customer_account_id,p.business_id,p.territory_id,clean(p.provider_code,80),clean(p.provider_reference,160),normalizeMethod(p.method_code),p.currency_code||'PHP',money(p.amount),p.created_at
    ]);
    intentId=Number(ins.rows[0].id);
    if(Number(p.merchandise_amount)>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) SELECT $1,'merchandise','merchant_business',$2,$3,$3,$4,'eligible','{\"source\":\"legacy_order_payment\"}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='merchandise')",[intentId,String(p.business_id),money(p.merchandise_amount),p.currency_code||'PHP']);
    if(Number(p.delivery_amount)>0)await client.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,settlement_status,rule_snapshot) SELECT $1,'delivery','delivery_service','',$2,$2,$3,'eligible','{\"source\":\"legacy_order_payment\"}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='delivery')",[intentId,money(p.delivery_amount),p.currency_code||'PHP']);
    await client.query("UPDATE order_payments SET payment_intent_id=$1 WHERE id=$2",[intentId,p.legacy_payment_id]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  return paymentIntentDetail(pool,intentId);
}

export async function paymentIntentDetail(pool,idOrPublic){
  const q=await pool.query("SELECT i.*,b.name business_name,t.name territory_name,COALESCE((SELECT jsonb_agg(a ORDER BY a.id) FROM payment_allocations a WHERE a.payment_intent_id=i.id),'[]'::jsonb) allocations,COALESCE((SELECT jsonb_agg(x ORDER BY x.id) FROM payment_attempts x WHERE x.payment_intent_id=i.id),'[]'::jsonb) attempts,COALESCE((SELECT jsonb_agg(r ORDER BY r.id) FROM refunds r WHERE r.payment_intent_id=i.id),'[]'::jsonb) refunds FROM payment_intents i LEFT JOIN businesses b ON b.id=i.business_id LEFT JOIN territories t ON t.id=i.territory_id WHERE i.id::text=$1 OR i.public_id=$1",[String(idOrPublic)]);
  return q.rows[0]||null;
}

export async function registerProviderEvent(pool,{providerCode,providerEventId,eventType='',payload={},signatureVerified=false,replayKey='',intentId=null}){
  const raw=JSON.stringify(payload??{});
  const q=await pool.query("INSERT INTO provider_events(provider_code,provider_event_id,event_type,payment_intent_id,payload_sha256,sanitized_payload,signature_verified,replay_key,processing_status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'received') ON CONFLICT(provider_code,provider_event_id) DO UPDATE SET provider_event_id=EXCLUDED.provider_event_id RETURNING *",[
    clean(providerCode,80),clean(providerEventId,200),clean(eventType,100),intentId||null,hash(raw),JSON.stringify(sanitizeProviderPayload(payload)),Boolean(signatureVerified),clean(replayKey,200)
  ]);
  return q.rows[0];
}

export async function createFeePolicy(pool,{policyCode,version,serviceScope='marketplace',territoryId=null,businessId=null,description='',createdBy=null}){
  const q=await pool.query("INSERT INTO fee_policy_versions(policy_code,version,status,country_code,territory_id,business_id,service_scope,currency_code,description,created_by_account_id) VALUES($1,$2,'draft','PH',$3,$4,$5,'PHP',$6,$7) RETURNING *",[
    clean(policyCode,100),Number(version),territoryId||null,businessId||null,clean(serviceScope,40),clean(description,1000),createdBy||null
  ]);
  return q.rows[0];
}

export async function addFeeRule(pool,policyId,rule){
  if(!['percentage','fixed'].includes(rule.calculation_type))throw Object.assign(new Error('Choose percentage or fixed fee calculation'),{status:400});
  const q=await pool.query("INSERT INTO fee_policy_rules(fee_policy_version_id,component_code,base_component,charged_to,beneficiary_type,beneficiary_ref,calculation_type,rate,fixed_amount,min_amount,max_amount,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[
    Number(policyId),clean(rule.component_code,60),clean(rule.base_component,60),clean(rule.charged_to,60),clean(rule.beneficiary_type,60),clean(rule.beneficiary_ref,120),clean(rule.calculation_type,30),
    rule.rate==null?null:Number(rule.rate),rule.fixed_amount==null?null:money(rule.fixed_amount),rule.min_amount==null?null:money(rule.min_amount),rule.max_amount==null?null:money(rule.max_amount),Number(rule.sort_order)||100
  ]);
  return q.rows[0];
}

export async function feePolicyOverview(pool){
  const {rows}=await pool.query("SELECT p.*,COALESCE((SELECT jsonb_agg(r ORDER BY r.sort_order,r.id) FROM fee_policy_rules r WHERE r.fee_policy_version_id=p.id),'[]'::jsonb) rules FROM fee_policy_versions p ORDER BY p.created_at DESC,p.id DESC LIMIT 200");
  return rows;
}

export async function createRefundRequest(pool,{intentId,amount,reason='',requestedBy=null}){
  const i=await paymentIntentDetail(pool,intentId);
  if(!i)throw Object.assign(new Error('Payment intent not found'),{status:404});
  if(!['succeeded','partially_refunded'].includes(i.status))throw Object.assign(new Error('Only confirmed payments can be refunded'),{status:409});
  const done=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE payment_intent_id=$1 AND status IN ('processing','succeeded','requested','manual_review')",[i.id]);
  const remaining=money(Number(i.amount)-Number(done.rows[0].total)),amt=money(amount);
  if(!Number.isFinite(amt)||amt<=0||amt>remaining+0.001)throw Object.assign(new Error('Refund amount exceeds refundable balance'),{status:409});
  const q=await pool.query("INSERT INTO refunds(payment_intent_id,public_id,amount,currency_code,reason,status,requested_by_account_id) VALUES($1,$2,$3,$4,$5,'requested',$6) RETURNING *",[
    i.id,'rf_'+crypto.randomBytes(14).toString('hex'),amt,i.currency_code,clean(reason,1000),requestedBy||null
  ]);
  return q.rows[0];
}

export async function createReconciliationRun(pool,{providerCode,periodStart,periodEnd,statement='',startedBy=null}){
  const provider=clean(providerCode,80);
  const q=await pool.query("INSERT INTO reconciliation_runs(public_id,provider_code,period_start,period_end,status,statement_sha256,started_by_account_id) VALUES($1,$2,$3,$4,'running',$5,$6) RETURNING *",[
    'rec_'+crypto.randomBytes(12).toString('hex'),provider,periodStart,periodEnd,statement?hash(statement):'',startedBy||null
  ]);
  const run=q.rows[0];
  const internal=await pool.query("SELECT COALESCE(SUM(amount),0) total,COUNT(*)::int count FROM payment_intents WHERE provider_code=$1 AND status='succeeded' AND succeeded_at>=$2 AND succeeded_at<$3",[provider,periodStart,periodEnd]);
  await pool.query("UPDATE reconciliation_runs SET internal_payment_total=$1,status='manual_review',completed_at=NOW() WHERE id=$2",[money(internal.rows[0].total),run.id]);
  await pool.query("INSERT INTO reconciliation_items(reconciliation_run_id,item_type,internal_ref,provider_ref,internal_amount,provider_amount,variance,status,detail_json) VALUES($1,'balance','internal_provider_total','statement_adapter_pending',$2,NULL,NULL,'manual_review',$3::jsonb)",[
    run.id,money(internal.rows[0].total),JSON.stringify({internal_payment_count:Number(internal.rows[0].count),reason:'Provider statement parser/adapter not configured'})
  ]);
  return (await pool.query("SELECT * FROM reconciliation_runs WHERE id=$1",[run.id])).rows[0];
}

export async function paymentFinanceOverview(pool){
  const [intents,allocs,refunds,settlements,recon,providers]=await Promise.all([
    pool.query("SELECT status,COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM payment_intents GROUP BY status ORDER BY status"),
    pool.query("SELECT component_code,settlement_status,COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM payment_allocations GROUP BY component_code,settlement_status ORDER BY component_code,settlement_status"),
    pool.query("SELECT status,COUNT(*)::int count,COALESCE(SUM(amount),0) total FROM refunds GROUP BY status ORDER BY status"),
    pool.query("SELECT status,COUNT(*)::int count,COALESCE(SUM(net_amount),0) total FROM settlements GROUP BY status ORDER BY status"),
    pool.query("SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 30"),
    pool.query("SELECT id,provider_code,display_name,adapter_version,status,supported_methods,ledger_account,created_at,updated_at FROM payment_provider_configs ORDER BY provider_code")
  ]);
  return{intents:intents.rows,allocations:allocs.rows,refunds:refunds.rows,settlements:settlements.rows,reconciliation_runs:recon.rows,providers:providers.rows};
}
