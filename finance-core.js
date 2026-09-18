import crypto from 'node:crypto';
import { promotionKpi } from './monetization-core.js';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const finiteMoney=v=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0)throw Object.assign(new Error('A positive cost amount is required'),{status:400});
  return money(n);
};
const safeDate=(v,name)=>{
  const d=v?new Date(v):null;
  if(!d||Number.isNaN(d.getTime()))throw Object.assign(new Error(name+' must be a valid date/time'),{status:400});
  return d.toISOString();
};

export const FINANCE_EVIDENCE_CLASSES=Object.freeze(['actual','accrued','estimated','budget']);
export const FINANCE_COST_NATURES=Object.freeze(['variable','fixed','semi_fixed']);
export const FINANCE_SERVICE_SCOPES=Object.freeze(['marketplace','delivery','supplier','local_services','accounting_pro','enterprise','shared']);
export const FINANCE_COST_CATEGORIES=Object.freeze([
  'infrastructure','database','storage','bandwidth','monitoring_security','support','maps_api','ai_api',
  'notification','marketing','referral_reward','promo_subsidy','delivery_subsidy','refund_loss',
  'chargeback_dispute','fraud_bad_debt','operator_share','legal_compliance','accounting','payroll_contractor',
  'insurance_licence','payment_provider_other','other'
]);
export const FINANCE_ALLOCATION_METHODS=Object.freeze(['direct','measured','driver','shared']);
export const PRICING_SCENARIO_SERVICES=Object.freeze(['marketplace','delivery','supplier','local_services']);

function requireEnum(value,allowed,label){
  const v=clean(value,80);
  if(!allowed.includes(v))throw Object.assign(new Error(label+' is invalid'),{status:400});
  return v;
}
function sanitizeMetadata(value){
  const blocked=/secret|password|token|authorization|card|pan|cvv|cvc|private_key|api_key/i;
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={};
  for(const [k,v] of Object.entries(source).slice(0,40)){
    const key=clean(k,80);
    if(!key)continue;
    if(blocked.test(key)){out[key]='[redacted]';continue}
    if(typeof v==='number'||typeof v==='boolean'||v==null)out[key]=v;
    else out[key]=clean(v,500);
  }
  return out;
}
function serviceFromSource(sourceType){
  if(sourceType==='order')return'marketplace';
  if(sourceType==='purchase_order')return'supplier';
  if(sourceType==='service_job')return'local_services';
  if(sourceType==='external')return'enterprise';
  return'shared';
}
function ratio(a,b){
  const x=Number(a||0),y=Number(b||0);
  return y>0?Math.round((x/y)*10000)/100:null;
}
function allocateProcessorCents(totalAmount,weightedRows){
  const totalCents=Math.max(0,Math.round(Number(totalAmount||0)*100));
  const rows=(weightedRows||[]).map((row,index)=>({...row,index,weight:Math.max(0,Number(row.weight||0))}));
  const weightTotal=rows.reduce((s,x)=>s+x.weight,0);
  if(!rows.length||totalCents===0||weightTotal<=0)return rows.map(x=>({...x,amount:0}));
  let used=0;
  const split=rows.map(x=>{
    const raw=totalCents*x.weight/weightTotal;
    const cents=Math.floor(raw);
    used+=cents;
    return{...x,cents,fraction:raw-cents};
  });
  let remaining=totalCents-used;
  split.sort((a,b)=>b.fraction-a.fraction||b.weight-a.weight||a.index-b.index);
  for(let i=0;i<split.length&&remaining>0;i++,remaining--)split[i].cents++;
  split.sort((a,b)=>a.index-b.index);
  return split.map(({fraction,cents,...x})=>({...x,amount:money(cents/100)}));
}
function perUnit(a,b){
  const x=Number(a||0),y=Number(b||0);
  return y>0?money(x/y):null;
}
function period(input={}){
  const now=new Date();
  const startDefault=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const from=input.from?safeDate(input.from,'from'):startDefault.toISOString();
  const to=input.to?safeDate(input.to,'to'):now.toISOString();
  if(new Date(to)<=new Date(from))throw Object.assign(new Error('to must be after from'),{status:400});
  return{from,to};
}
function evidenceClasses(input){
  if(Array.isArray(input)&&input.length){
    const values=[...new Set(input.map(x=>clean(x,30)).filter(x=>FINANCE_EVIDENCE_CLASSES.includes(x)))];
    if(values.length)return values;
  }
  return['actual','accrued'];
}

export async function ensureFinanceSchema(pool){
  const statements=[
    "CREATE TABLE IF NOT EXISTS cost_allocation_policy_versions(id BIGSERIAL PRIMARY KEY,policy_code TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',country_code TEXT NOT NULL DEFAULT 'PH',description TEXT NOT NULL DEFAULT '',methodology_json JSONB NOT NULL DEFAULT '{}'::jsonb,effective_from TIMESTAMPTZ,effective_until TIMESTAMPTZ,created_by_account_id BIGINT REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(policy_code,version),CHECK(status IN ('draft','approved','active','superseded','withdrawn')))",
    "CREATE TABLE IF NOT EXISTS platform_cost_entries(id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,source_key TEXT NOT NULL UNIQUE,cost_code TEXT NOT NULL,cost_category TEXT NOT NULL,cost_nature TEXT NOT NULL,evidence_class TEXT NOT NULL,service_scope TEXT NOT NULL DEFAULT 'shared',country_code TEXT NOT NULL DEFAULT 'PH',territory_id BIGINT REFERENCES territories(id),business_id BIGINT REFERENCES businesses(id),payment_intent_id BIGINT REFERENCES payment_intents(id),provider_code TEXT NOT NULL DEFAULT '',currency_code TEXT NOT NULL DEFAULT 'PHP',amount NUMERIC(14,2) NOT NULL CHECK(amount>0),incurred_at TIMESTAMPTZ NOT NULL,period_start TIMESTAMPTZ,period_end TIMESTAMPTZ,evidence_reference TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,status TEXT NOT NULL DEFAULT 'active',created_by_account_id BIGINT REFERENCES accounts(id),voided_by_account_id BIGINT REFERENCES accounts(id),void_reason TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(cost_nature IN ('variable','fixed','semi_fixed')),CHECK(evidence_class IN ('actual','accrued','estimated','budget')),CHECK(service_scope IN ('marketplace','delivery','supplier','local_services','accounting_pro','enterprise','shared')),CHECK(status IN ('active','void')))",
    "CREATE INDEX IF NOT EXISTS platform_cost_entries_period_idx ON platform_cost_entries(country_code,incurred_at DESC,status)",
    "CREATE INDEX IF NOT EXISTS platform_cost_entries_scope_idx ON platform_cost_entries(service_scope,territory_id,incurred_at DESC)",
    "CREATE TABLE IF NOT EXISTS platform_cost_allocations(id BIGSERIAL PRIMARY KEY,allocation_key TEXT NOT NULL UNIQUE,cost_entry_id BIGINT NOT NULL REFERENCES platform_cost_entries(id) ON DELETE RESTRICT,service_scope TEXT NOT NULL,territory_id BIGINT REFERENCES territories(id),business_id BIGINT REFERENCES businesses(id),payment_intent_id BIGINT REFERENCES payment_intents(id),allocation_method TEXT NOT NULL,driver_code TEXT NOT NULL DEFAULT '',amount NUMERIC(14,2) NOT NULL CHECK(amount>0),policy_version_id BIGINT REFERENCES cost_allocation_policy_versions(id),created_by_account_id BIGINT REFERENCES accounts(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(service_scope IN ('marketplace','delivery','supplier','local_services','accounting_pro','enterprise','shared')),CHECK(allocation_method IN ('direct','measured','driver','shared')))",
    "CREATE INDEX IF NOT EXISTS platform_cost_allocations_entry_idx ON platform_cost_allocations(cost_entry_id,id)",
    "CREATE INDEX IF NOT EXISTS platform_cost_allocations_scope_idx ON platform_cost_allocations(service_scope,territory_id,payment_intent_id)"
  ];
  for(const sql of statements)await pool.query(sql);
}

export async function createPlatformCostEntry(pool,input={}){
  const evidence=requireEnum(input.evidenceClass,FINANCE_EVIDENCE_CLASSES,'evidence_class');
  const nature=requireEnum(input.costNature,FINANCE_COST_NATURES,'cost_nature');
  const scope=requireEnum(input.serviceScope||'shared',FINANCE_SERVICE_SCOPES,'service_scope');
  const category=requireEnum(input.costCategory||'other',FINANCE_COST_CATEGORIES,'cost_category');
  const sourceKey=clean(input.sourceKey,220);
  const code=clean(input.costCode,120);
  const reference=clean(input.evidenceReference,500);
  if(!sourceKey)throw Object.assign(new Error('An idempotent source_key is required'),{status:400});
  if(!code)throw Object.assign(new Error('cost_code is required'),{status:400});
  if(!reference)throw Object.assign(new Error('evidence_reference or estimation/budget source is required'),{status:400});
  const amount=finiteMoney(input.amount);
  const incurredAt=safeDate(input.incurredAt||new Date().toISOString(),'incurred_at');
  const periodStart=input.periodStart?safeDate(input.periodStart,'period_start'):null;
  const periodEnd=input.periodEnd?safeDate(input.periodEnd,'period_end'):null;
  if(periodStart&&periodEnd&&new Date(periodEnd)<new Date(periodStart))throw Object.assign(new Error('period_end must not be before period_start'),{status:400});
  const metadata=sanitizeMetadata(input.metadata);
  const q=await pool.query(
    "INSERT INTO platform_cost_entries(public_id,source_key,cost_code,cost_category,cost_nature,evidence_class,service_scope,country_code,territory_id,business_id,payment_intent_id,provider_code,currency_code,amount,incurred_at,period_start,period_end,evidence_reference,description,metadata_json,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PH',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20) ON CONFLICT(source_key) DO UPDATE SET updated_at=platform_cost_entries.updated_at RETURNING *",
    [
      'cost_'+crypto.randomBytes(10).toString('hex'),sourceKey,code,category,nature,evidence,scope,
      input.territoryId||null,input.businessId||null,input.paymentIntentId||null,clean(input.providerCode,80),
      clean(input.currencyCode||'PHP',10),amount,incurredAt,periodStart,periodEnd,reference,
      clean(input.description,1200),JSON.stringify(metadata),input.createdBy||null
    ]
  );
  return q.rows[0];
}

export async function allocatePlatformCost(pool,costEntryId,input={}){
  const amount=finiteMoney(input.amount);
  const scope=requireEnum(input.serviceScope||'shared',FINANCE_SERVICE_SCOPES,'service_scope');
  const method=requireEnum(input.allocationMethod||'direct',FINANCE_ALLOCATION_METHODS,'allocation_method');
  const key=clean(input.allocationKey,220);
  if(!key)throw Object.assign(new Error('An idempotent allocation_key is required'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const e=await client.query("SELECT * FROM platform_cost_entries WHERE id=$1 FOR UPDATE",[Number(costEntryId)]);
    if(!e.rowCount)throw Object.assign(new Error('Cost entry not found'),{status:404});
    if(e.rows[0].status!=='active')throw Object.assign(new Error('Only active cost entries can be allocated'),{status:409});
    const existing=await client.query("SELECT * FROM platform_cost_allocations WHERE allocation_key=$1",[key]);
    if(existing.rowCount){await client.query('COMMIT');return existing.rows[0]}
    const used=await client.query("SELECT COALESCE(SUM(amount),0) total FROM platform_cost_allocations WHERE cost_entry_id=$1",[Number(costEntryId)]);
    if(money(Number(used.rows[0].total)+amount)>money(e.rows[0].amount))throw Object.assign(new Error('Cost allocations cannot exceed the cost entry amount'),{status:409});
    const q=await client.query(
      "INSERT INTO platform_cost_allocations(allocation_key,cost_entry_id,service_scope,territory_id,business_id,payment_intent_id,allocation_method,driver_code,amount,policy_version_id,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [key,Number(costEntryId),scope,input.territoryId||null,input.businessId||null,input.paymentIntentId||null,method,clean(input.driverCode,100),amount,input.policyVersionId||null,input.createdBy||null]
    );
    await client.query('COMMIT');
    return q.rows[0];
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release()}
}

export async function voidPlatformCostEntry(pool,costEntryId,{voidedBy=null,reason=''}={}){
  const why=clean(reason,1000);
  if(!why)throw Object.assign(new Error('A void reason is required'),{status:400});
  const q=await pool.query("UPDATE platform_cost_entries SET status='void',voided_by_account_id=$1,void_reason=$2,updated_at=NOW() WHERE id=$3 AND status='active' RETURNING *",[voidedBy||null,why,Number(costEntryId)]);
  if(!q.rowCount)throw Object.assign(new Error('Active cost entry not found'),{status:404});
  return q.rows[0];
}

export async function listPlatformCostEntries(pool,input={}){
  const p=period(input);
  const territoryId=input.territoryId==null?null:Number(input.territoryId);
  const scope=input.serviceScope&&FINANCE_SERVICE_SCOPES.includes(input.serviceScope)?input.serviceScope:null;
  const classes=Array.isArray(input.evidenceClasses)&&input.evidenceClasses.length?input.evidenceClasses.filter(x=>FINANCE_EVIDENCE_CLASSES.includes(x)):FINANCE_EVIDENCE_CLASSES;
  const q=await pool.query(`
    SELECT e.*,
      COALESCE((SELECT SUM(a.amount) FROM platform_cost_allocations a WHERE a.cost_entry_id=e.id),0) allocated_amount,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'service_scope',a.service_scope,'territory_id',a.territory_id,'business_id',a.business_id,
        'payment_intent_id',a.payment_intent_id,'allocation_method',a.allocation_method,'driver_code',a.driver_code,
        'amount',a.amount,'policy_version_id',a.policy_version_id,'created_at',a.created_at
      ) ORDER BY a.id) FROM platform_cost_allocations a WHERE a.cost_entry_id=e.id),'[]'::jsonb) allocations
    FROM platform_cost_entries e
    WHERE e.country_code='PH' AND e.incurred_at >= $1 AND e.incurred_at < $2
      AND ($3::bigint IS NULL OR e.territory_id=$3 OR EXISTS(SELECT 1 FROM platform_cost_allocations a WHERE a.cost_entry_id=e.id AND a.territory_id=$3))
      AND ($4::text IS NULL OR e.service_scope=$4 OR EXISTS(SELECT 1 FROM platform_cost_allocations a WHERE a.cost_entry_id=e.id AND a.service_scope=$4))
      AND e.evidence_class=ANY($5::text[])
    ORDER BY e.incurred_at DESC,e.id DESC LIMIT 500
  `,[p.from,p.to,territoryId,scope,classes]);
  return q.rows;
}

async function paymentEconomics(pool,{from,to,territoryId=null}){
  const intentFilter="pi.status='succeeded' AND COALESCE(pi.succeeded_at,pi.updated_at)>= $1 AND COALESCE(pi.succeeded_at,pi.updated_at)< $2 AND ($3::bigint IS NULL OR pi.territory_id=$3)";
  const [volume,revenue,processor,services]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int completed_transactions,COALESCE(SUM(pi.amount),0) gross_payment_volume FROM payment_intents pi WHERE ${intentFilter}`,[from,to,territoryId]),
    pool.query(`
      SELECT COALESCE(SUM(pa.amount),0) platform_revenue
      FROM payment_allocations pa JOIN payment_intents pi ON pi.id=pa.payment_intent_id
      WHERE ${intentFilter}
        AND pa.component_code IN ('platform_fee','country_operator_fee','territory_operator_fee')
        AND pa.economic_party_type='platform' AND pa.settlement_status<>'reversed'
    `,[from,to,territoryId]),
    pool.query(`
      SELECT COALESCE(SUM(pa.amount),0) processor_cost
      FROM payment_allocations pa JOIN payment_intents pi ON pi.id=pa.payment_intent_id
      WHERE ${intentFilter} AND pa.component_code='processor_fee' AND pa.settlement_status<>'reversed'
    `,[from,to,territoryId]),
    pool.query(`
      WITH intents AS (
        SELECT pi.id,pi.source_type,pi.amount,
          CASE WHEN pi.source_type='order' THEN 'marketplace'
               WHEN pi.source_type='purchase_order' THEN 'supplier'
               WHEN pi.source_type='service_job' THEN 'local_services'
               ELSE 'enterprise' END service_scope
        FROM payment_intents pi
        WHERE ${intentFilter}
      ),
      base AS (
        SELECT service_scope,COUNT(*)::int completed_transactions,COALESCE(SUM(amount),0) gross_value
        FROM intents GROUP BY service_scope
      ),
      delivery AS (
        SELECT 'delivery'::text service_scope,COUNT(DISTINCT i.id)::int completed_transactions,
          COALESCE(SUM(pa.amount),0) gross_value
        FROM intents i JOIN payment_allocations pa ON pa.payment_intent_id=i.id
        WHERE pa.component_code='delivery' AND pa.settlement_status<>'reversed'
      ),
      fee AS (
        SELECT COALESCE(fp.service_scope,
          CASE WHEN pi.source_type='order' THEN 'marketplace'
               WHEN pi.source_type='purchase_order' THEN 'supplier'
               WHEN pi.source_type='service_job' THEN 'local_services'
               ELSE 'enterprise' END) service_scope,
          COALESCE(SUM(pa.amount),0) revenue
        FROM payment_allocations pa
        JOIN payment_intents pi ON pi.id=pa.payment_intent_id
        LEFT JOIN fee_policy_versions fp ON fp.id=pa.fee_policy_version_id
        WHERE ${intentFilter}
          AND pa.component_code IN ('platform_fee','country_operator_fee','territory_operator_fee')
          AND pa.economic_party_type='platform' AND pa.settlement_status<>'reversed'
        GROUP BY 1
      ),
      proc AS (
        SELECT COALESCE(fp.service_scope,'shared') service_scope,COALESCE(SUM(pa.amount),0) processor_cost
        FROM payment_allocations pa
        JOIN payment_intents pi ON pi.id=pa.payment_intent_id
        LEFT JOIN fee_policy_versions fp ON fp.id=pa.fee_policy_version_id
        WHERE ${intentFilter} AND pa.component_code='processor_fee' AND pa.settlement_status<>'reversed'
        GROUP BY 1
      ),
      scopes AS (
        SELECT service_scope FROM base UNION SELECT service_scope FROM delivery WHERE gross_value>0
        UNION SELECT service_scope FROM fee UNION SELECT service_scope FROM proc
      )
      SELECT s.service_scope,
        COALESCE(b.completed_transactions,d.completed_transactions,0)::int completed_transactions,
        COALESCE(b.gross_value,d.gross_value,0) gross_value,
        COALESCE(f.revenue,0) revenue,COALESCE(p.processor_cost,0) processor_cost
      FROM scopes s
      LEFT JOIN base b USING(service_scope) LEFT JOIN delivery d USING(service_scope)
      LEFT JOIN fee f USING(service_scope) LEFT JOIN proc p USING(service_scope)
      ORDER BY s.service_scope
    `,[from,to,territoryId])
  ]);
  return{
    completedTransactions:Number(volume.rows[0]?.completed_transactions||0),
    grossPaymentVolume:money(volume.rows[0]?.gross_payment_volume||0),
    platformRevenue:money(revenue.rows[0]?.platform_revenue||0),
    processorCost:money(processor.rows[0]?.processor_cost||0),
    services:services.rows.map(x=>({
      service_scope:x.service_scope,completed_transactions:Number(x.completed_transactions||0),
      gross_value:money(x.gross_value||0),revenue:money(x.revenue||0),processor_cost:money(x.processor_cost||0)
    }))
  };
}

async function manualCostEconomics(pool,{from,to,territoryId=null,evidence}){
  const q=await pool.query(`
    WITH alloc AS (
      SELECT a.cost_entry_id,COALESCE(SUM(a.amount),0) allocated_total
      FROM platform_cost_allocations a GROUP BY a.cost_entry_id
    ),
    effective AS (
      SELECT e.id,e.cost_nature,e.evidence_class,a.service_scope,a.territory_id,a.amount
      FROM platform_cost_entries e
      JOIN platform_cost_allocations a ON a.cost_entry_id=e.id
      WHERE e.status='active' AND e.country_code='PH' AND e.incurred_at >= $1 AND e.incurred_at < $2
        AND e.evidence_class=ANY($4::text[])
      UNION ALL
      SELECT e.id,e.cost_nature,e.evidence_class,e.service_scope,e.territory_id,
        GREATEST(e.amount-COALESCE(x.allocated_total,0),0) amount
      FROM platform_cost_entries e LEFT JOIN alloc x ON x.cost_entry_id=e.id
      WHERE e.status='active' AND e.country_code='PH' AND e.incurred_at >= $1 AND e.incurred_at < $2
        AND e.evidence_class=ANY($4::text[]) AND e.amount>COALESCE(x.allocated_total,0)
    )
    SELECT service_scope,cost_nature,evidence_class,COUNT(DISTINCT id)::int cost_entries,COALESCE(SUM(amount),0) amount
    FROM effective
    WHERE ($3::bigint IS NULL OR territory_id=$3)
    GROUP BY service_scope,cost_nature,evidence_class
    ORDER BY service_scope,cost_nature,evidence_class
  `,[from,to,territoryId,evidence]);
  const evidenceAll=await pool.query(`
    SELECT evidence_class,COUNT(*)::int entries,COALESCE(SUM(amount),0) amount
    FROM platform_cost_entries
    WHERE status='active' AND country_code='PH' AND incurred_at >= $1 AND incurred_at < $2
      AND ($3::bigint IS NULL OR territory_id=$3)
    GROUP BY evidence_class ORDER BY evidence_class
  `,[from,to,territoryId]);
  return{
    rows:q.rows.map(x=>({...x,cost_entries:Number(x.cost_entries||0),amount:money(x.amount||0)})),
    evidenceBreakdown:evidenceAll.rows.map(x=>({...x,entries:Number(x.entries||0),amount:money(x.amount||0)}))
  };
}

async function promotionDirectCostEconomics(pool,{from,to,territoryId=null,evidence}){
  const eventIntent=await pool.query(`
    WITH proc AS (
      SELECT payment_intent_id,COALESCE(SUM(amount),0) processor_fee
      FROM payment_allocations
      WHERE component_code='processor_fee' AND settlement_status<>'reversed'
      GROUP BY payment_intent_id
    ),
    bases AS (
      SELECT payment_intent_id,
        COALESCE(SUM(amount) FILTER (WHERE component_code='merchandise'),0) merchandise_base,
        COALESCE(SUM(amount) FILTER (WHERE component_code='delivery'),0) delivery_base
      FROM payment_allocations
      WHERE settlement_status<>'reversed'
      GROUP BY payment_intent_id
    )
    SELECT e.id event_id,e.entitlement_id,e.service_scope,e.phase_snapshot,e.source_type,e.source_id,e.territory_id,
      pi.id payment_intent_id,pi.amount intent_amount,
      COALESCE(b.merchandise_base,0) merchandise_base,COALESCE(b.delivery_base,0) delivery_base,
      COALESCE(p.processor_fee,0) processor_fee
    FROM service_monetization_events e
    LEFT JOIN deliveries d ON e.service_scope='delivery' AND e.source_type='delivery' AND d.id=e.source_id
    JOIN payment_intents pi ON (
      (e.service_scope='marketplace' AND e.source_type='order' AND pi.source_type='order' AND pi.source_id=e.source_id)
      OR (e.service_scope='delivery' AND e.source_type='delivery' AND pi.source_type='order' AND pi.source_id=d.order_id)
      OR (e.service_scope='supplier' AND e.source_type='purchase_order' AND pi.source_type='purchase_order' AND pi.source_id=e.source_id)
      OR (e.service_scope='local_services' AND e.source_type='service_job' AND pi.source_type='service_job' AND pi.source_id=e.source_id)
    )
    LEFT JOIN proc p ON p.payment_intent_id=pi.id
    LEFT JOIN bases b ON b.payment_intent_id=pi.id
    WHERE e.country_code='PH' AND e.completed_at >= $1 AND e.completed_at < $2
      AND ($3::bigint IS NULL OR e.territory_id=$3 OR e.territory_id IS NULL)
      AND COALESCE(p.processor_fee,0)>0
    ORDER BY pi.id,e.id
  `,[from,to,territoryId]);

  const byIntent=new Map();
  for(const row of eventIntent.rows){
    const key=String(row.payment_intent_id);
    if(!byIntent.has(key))byIntent.set(key,{fee:money(row.processor_fee),rows:[]});
    let weight=Number(row.intent_amount||0);
    if(row.service_scope==='marketplace')weight=Number(row.merchandise_base||0);
    else if(row.service_scope==='delivery')weight=Number(row.delivery_base||0);
    byIntent.get(key).rows.push({
      event_id:Number(row.event_id),entitlement_id:Number(row.entitlement_id),service_scope:row.service_scope,
      phase:row.phase_snapshot,weight
    });
  }
  const processorRows=[];
  for(const x of byIntent.values()){
    for(const a of allocateProcessorCents(x.fee,x.rows))processorRows.push(a);
  }

  const ledger=await pool.query(`
    WITH events AS (
      SELECT e.id event_id,e.entitlement_id,e.service_scope,e.phase_snapshot,e.source_type,e.source_id,e.territory_id
      FROM service_monetization_events e
      WHERE e.country_code='PH' AND e.completed_at >= $1 AND e.completed_at < $2
        AND ($3::bigint IS NULL OR e.territory_id=$3 OR e.territory_id IS NULL)
    ),
    mapped AS (
      SELECT ev.*,pi.id payment_intent_id
      FROM events ev
      LEFT JOIN deliveries d ON ev.service_scope='delivery' AND ev.source_type='delivery' AND d.id=ev.source_id
      JOIN payment_intents pi ON (
        (ev.service_scope='marketplace' AND ev.source_type='order' AND pi.source_type='order' AND pi.source_id=ev.source_id)
        OR (ev.service_scope='delivery' AND ev.source_type='delivery' AND pi.source_type='order' AND pi.source_id=d.order_id)
        OR (ev.service_scope='supplier' AND ev.source_type='purchase_order' AND pi.source_type='purchase_order' AND pi.source_id=ev.source_id)
        OR (ev.service_scope='local_services' AND ev.source_type='service_job' AND pi.source_type='service_job' AND pi.source_id=ev.source_id)
      )
    ),
    allocated AS (
      SELECT m.event_id,m.entitlement_id,m.service_scope,m.phase_snapshot,a.id source_cost_id,a.amount
      FROM mapped m
      JOIN platform_cost_allocations a ON a.payment_intent_id=m.payment_intent_id AND a.service_scope=m.service_scope
      JOIN platform_cost_entries ce ON ce.id=a.cost_entry_id
      WHERE ce.status='active' AND ce.evidence_class=ANY($4::text[])
    ),
    direct_unallocated AS (
      SELECT m.event_id,m.entitlement_id,m.service_scope,m.phase_snapshot,ce.id source_cost_id,ce.amount
      FROM mapped m
      JOIN platform_cost_entries ce ON ce.payment_intent_id=m.payment_intent_id AND ce.service_scope=m.service_scope
      WHERE ce.status='active' AND ce.evidence_class=ANY($4::text[])
        AND NOT EXISTS(SELECT 1 FROM platform_cost_allocations a WHERE a.cost_entry_id=ce.id)
    )
    SELECT * FROM allocated
    UNION ALL
    SELECT * FROM direct_unallocated
    ORDER BY event_id,source_cost_id
  `,[from,to,territoryId,evidence]);

  const agg=new Map();
  const keyFor=(service,phase)=>service+'|'+phase;
  const ensure=(service,phase)=>{
    const key=keyFor(service,phase);
    if(!agg.has(key))agg.set(key,{service_scope:service,phase,processor_cost:0,ledger_cost:0,eventIds:new Set(),subjectIds:new Set()});
    return agg.get(key);
  };
  for(const x of processorRows){
    const a=ensure(x.service_scope,x.phase);
    a.processor_cost=money(a.processor_cost+Number(x.amount||0));
    a.eventIds.add(Number(x.event_id));a.subjectIds.add(Number(x.entitlement_id));
  }
  for(const x of ledger.rows){
    const a=ensure(x.service_scope,x.phase_snapshot);
    a.ledger_cost=money(a.ledger_cost+Number(x.amount||0));
    a.eventIds.add(Number(x.event_id));a.subjectIds.add(Number(x.entitlement_id));
  }
  const eventCounts=await pool.query(`
    SELECT service_scope,phase_snapshot,COUNT(*)::int completed_events,COUNT(DISTINCT entitlement_id)::int active_subjects
    FROM service_monetization_events
    WHERE country_code='PH' AND completed_at >= $1 AND completed_at < $2
      AND ($3::bigint IS NULL OR territory_id=$3 OR territory_id IS NULL)
    GROUP BY service_scope,phase_snapshot
  `,[from,to,territoryId]);
  for(const x of eventCounts.rows){
    const a=ensure(x.service_scope,x.phase_snapshot);
    a.completed_events=Number(x.completed_events||0);
    a.active_subjects=Number(x.active_subjects||0);
  }
  const rows=[...agg.values()].map(x=>{
    const total=money(x.processor_cost+x.ledger_cost);
    const completed=Number(x.completed_events||0),subjects=Number(x.active_subjects||0);
    return{
      service_scope:x.service_scope,phase:x.phase,
      completed_events:completed,active_subjects:subjects,
      direct_processor_cost:money(x.processor_cost),direct_ledger_cost:money(x.ledger_cost),
      total_direct_cost:total,
      direct_cost_per_completion:perUnit(total,completed),
      direct_cost_per_active_subject:perUnit(total,subjects)
    };
  }).sort((a,b)=>a.service_scope.localeCompare(b.service_scope)||a.phase.localeCompare(b.phase));
  const sumPhase=phase=>{
    const selected=rows.filter(x=>x.phase===phase);
    const processor=money(selected.reduce((s,x)=>s+x.direct_processor_cost,0));
    const ledgerCost=money(selected.reduce((s,x)=>s+x.direct_ledger_cost,0));
    const total=money(processor+ledgerCost);
    const completed=selected.reduce((s,x)=>s+x.completed_events,0);
    const activeSubjects=selected.reduce((s,x)=>s+x.active_subjects,0);
    return{direct_processor_cost:processor,direct_ledger_cost:ledgerCost,total_direct_cost:total,completed_events:completed,active_subjects:activeSubjects,direct_cost_per_completion:perUnit(total,completed),direct_cost_per_active_subject:perUnit(total,activeSubjects)};
  };
  return{
    coverage_status:'DIRECT_ONLY_EXCLUDES_SHARED_FIXED',
    terminology:'DIRECT_PROMOTIONAL_SUBSIDY_FLOOR',
    promotional:sumPhase('promotional'),
    post_promo:sumPhase('post_promo'),
    services:rows,
    warning:'Direct cost includes canonical processor fees and Finance costs explicitly linked to payment intents/service scopes. Shared and fixed overhead is excluded unless explicitly allocated.'
  };
}

export async function financeKpiOverview(pool,input={}){
  const p=period(input);
  const territoryId=input.territoryId==null?null:Number(input.territoryId);
  const evidence=evidenceClasses(input.evidenceClasses);
  const [pay,manual,recent,promotion,promotionDirectCost]=await Promise.all([
    paymentEconomics(pool,{...p,territoryId}),
    manualCostEconomics(pool,{...p,territoryId,evidence}),
    listPlatformCostEntries(pool,{...p,territoryId,evidenceClasses:FINANCE_EVIDENCE_CLASSES}),
    promotionKpi(pool,{...p,territoryId}),
    promotionDirectCostEconomics(pool,{...p,territoryId,evidence})
  ]);
  const manualVariable=money(manual.rows.filter(x=>x.cost_nature==='variable').reduce((s,x)=>s+Number(x.amount||0),0));
  const allocatedFixed=money(manual.rows.filter(x=>x.cost_nature!=='variable').reduce((s,x)=>s+Number(x.amount||0),0));
  const variableCosts=money(pay.processorCost+manualVariable);
  const contribution=money(pay.platformRevenue-variableCosts);
  const operatingProfit=money(contribution-allocatedFixed);
  const services=new Map();
  for(const x of pay.services)services.set(x.service_scope,{...x,manual_variable_cost:0,allocated_fixed_cost:0});
  for(const x of manual.rows){
    if(!services.has(x.service_scope))services.set(x.service_scope,{service_scope:x.service_scope,completed_transactions:0,gross_value:0,revenue:0,processor_cost:0,manual_variable_cost:0,allocated_fixed_cost:0});
    const row=services.get(x.service_scope);
    if(x.cost_nature==='variable')row.manual_variable_cost=money(row.manual_variable_cost+Number(x.amount||0));
    else row.allocated_fixed_cost=money(row.allocated_fixed_cost+Number(x.amount||0));
  }
  const serviceRows=[...services.values()].map(x=>{
    const variable=money(Number(x.processor_cost||0)+Number(x.manual_variable_cost||0));
    const contrib=money(Number(x.revenue||0)-variable);
    const profit=money(contrib-Number(x.allocated_fixed_cost||0));
    return{...x,variable_cost:variable,contribution:contrib,operating_profit:profit,contribution_margin_pct:ratio(contrib,x.revenue),net_margin_pct:ratio(profit,x.revenue)};
  }).sort((a,b)=>a.service_scope.localeCompare(b.service_scope));
  const contributionPerTx=perUnit(contribution,pay.completedTransactions);
  const breakEven=contributionPerTx&&contributionPerTx>0?Math.ceil(allocatedFixed/contributionPerTx):null;
  return{
    period:p,country_code:'PH',territory_id:territoryId,included_evidence_classes:evidence,
    gross_payment_volume:pay.grossPaymentVolume,completed_transactions:pay.completedTransactions,
    platform_revenue:pay.platformRevenue,processor_cost:pay.processorCost,manual_variable_cost:manualVariable,
    variable_costs:variableCosts,contribution,contribution_margin_pct:ratio(contribution,pay.platformRevenue),
    allocated_fixed_cost:allocatedFixed,operating_profit:operatingProfit,net_margin_pct:ratio(operatingProfit,pay.platformRevenue),
    revenue_per_completed_transaction:perUnit(pay.platformRevenue,pay.completedTransactions),
    variable_cost_per_completed_transaction:perUnit(variableCosts,pay.completedTransactions),
    contribution_per_completed_transaction:contributionPerTx,
    operating_profit_per_completed_transaction:perUnit(operatingProfit,pay.completedTransactions),
    break_even_transactions:breakEven,
    break_even_status:contributionPerTx&&contributionPerTx>0?'CALCULABLE':'NO_BREAK_EVEN_AT_CURRENT_UNIT_ECONOMICS',
    services:serviceRows,evidence_breakdown:manual.evidenceBreakdown,
    recent_cost_entries:recent.slice(0,25),
    promotion_economics:{...promotion,direct_cost:promotionDirectCost},
    accounting_note:'GMV/payment volume is context only. Provider/customer/merchant/courier/service-provider money is not platform revenue unless an explicit platform-owned allocation exists.'
  };
}


function scenarioRate(value){
  const n=Number(value??0);
  if(!Number.isFinite(n)||n<0||n>100)throw Object.assign(new Error('Scenario rate must be between 0 and 100 percent'),{status:400});
  return Math.round(n*10000)/10000;
}
function pctRatio(n,d){
  const a=Number(n||0),b=Number(d||0);
  return b>0?Math.round((a/b)*1000000)/10000:null;
}


function scenarioNonNegative(value,label,{integer=false,max=1e12}={}){
  const n=Number(value??0);
  if(!Number.isFinite(n)||n<0||n>max)throw Object.assign(new Error(label+' must be a non-negative number'),{status:400});
  return integer?Math.floor(n):Math.round(n*10000)/10000;
}
function scenarioPercent(value,label){
  const n=Number(value??0);
  if(!Number.isFinite(n)||n<0||n>100)throw Object.assign(new Error(label+' must be between 0 and 100 percent'),{status:400});
  return Math.round(n*10000)/10000;
}
const COMMISSION_STAFFING_KEYS=Object.freeze([
  'super_admin_remuneration','country_admin','territory_admin','specialist_admin','support_staff','other_employee_contractor'
]);
const COMMISSION_OPERATING_COST_KEYS=Object.freeze([
  'infrastructure','database_storage_monitoring','ai_api_maps_notifications','support_operations',
  'marketing_growth','legal_accounting_compliance','insurance_licences','other_overhead'
]);
function staffingScenario(raw={}){
  const rows=[],byKey={};
  let total=0;
  for(const key of COMMISSION_STAFFING_KEYS){
    const item=raw?.[key]||{};
    const count=scenarioNonNegative(item.count,key+' count',{integer:true,max:1e6});
    const monthlyCost=scenarioNonNegative(item.monthly_cost_per_person,key+' monthly cost',{max:1e9});
    const amount=money(count*monthlyCost);
    rows.push({key,count,monthly_cost_per_person:money(monthlyCost),monthly_cost:amount});
    byKey[key]=amount;total=money(total+amount);
  }
  return{rows,by_key:byKey,total_monthly_staffing_cost:total};
}
function operatingCostScenario(raw={}){
  const rows=[],byKey={};
  let total=0;
  for(const key of COMMISSION_OPERATING_COST_KEYS){
    const amount=money(scenarioNonNegative(raw?.[key],key+' monthly cost',{max:1e12}));
    rows.push({key,monthly_cost:amount});
    byKey[key]=amount;total=money(total+amount);
  }
  return{rows,by_key:byKey,total_monthly_operating_overhead:total};
}

export function commissionSustainabilityScenario(input={}){
  const events=scenarioNonNegative(input.completedEventsPerMonth,'completed events per month',{integer:true,max:1e9});
  const paidProfiles={
    merchant:scenarioNonNegative(input.paidProfiles?.merchant,'merchant paid profiles',{integer:true,max:1e9}),
    supplier:scenarioNonNegative(input.paidProfiles?.supplier,'supplier paid profiles',{integer:true,max:1e9}),
    local_services:scenarioNonNegative(input.paidProfiles?.local_services,'local services paid profiles',{integer:true,max:1e9})
  };
  const subscriptionAmounts={
    merchant:money(scenarioNonNegative(input.subscriptionAmounts?.merchant,'merchant subscription amount',{max:1e9})),
    supplier:money(scenarioNonNegative(input.subscriptionAmounts?.supplier,'supplier subscription amount',{max:1e9})),
    local_services:money(scenarioNonNegative(input.subscriptionAmounts?.local_services,'local services subscription amount',{max:1e9}))
  };
  const deliveryEligibleEarnings=money(scenarioNonNegative(input.deliveryEligibleEarnings,'delivery eligible earnings',{max:1e12}));
  const deliveryProductionRatePct=scenarioPercent(input.deliveryProductionRatePct,'delivery production rate');
  const averageFeeBase=money(scenarioNonNegative(input.averageFeeBaseValue,'average fee-base value',{max:1e12}));
  const feeEligibleSharePct=scenarioPercent(input.feeEligibleSharePct,'fee-eligible share');
  const onlineSharePct=scenarioPercent(input.onlinePaymentSharePct,'online-payment share');
  const processorRatePct=scenarioPercent(input.processorRatePct,'processor rate');
  const processorFixedPerOnlineEvent=money(scenarioNonNegative(input.processorFixedPerOnlineEvent,'processor fixed cost per online event',{max:1e9}));
  const riskAllowancePct=scenarioPercent(input.riskAllowancePct,'refund/chargeback/bad-debt allowance');
  const safetyReservePct=scenarioPercent(input.safetyReservePct,'safety reserve');
  const growthSurplusPct=scenarioPercent(input.growthSurplusPct,'growth/reinvestment surplus');
  const platformAbsorbsProcessorFees=input.platformAbsorbsProcessorFees!==false;
  const platformAbsorbsRiskAllowance=input.platformAbsorbsRiskAllowance!==false;

  const staffing=staffingScenario(input.staffing||{});
  const overhead=operatingCostScenario(input.monthlyCosts||{});
  const matureFeeBase=money(events*averageFeeBase);
  const currentFeeEligibleBase=money(matureFeeBase*feeEligibleSharePct/100);
  const onlineEvents=Math.round(events*onlineSharePct/100);
  const onlineFeeBase=money(matureFeeBase*onlineSharePct/100);
  const processorVariable=platformAbsorbsProcessorFees?money(onlineFeeBase*processorRatePct/100):0;
  const processorFixed=platformAbsorbsProcessorFees?money(onlineEvents*processorFixedPerOnlineEvent):0;
  const processorCost=money(processorVariable+processorFixed);
  const riskAllowance=platformAbsorbsRiskAllowance?money(matureFeeBase*riskAllowancePct/100):0;

  const baseOperatingCost=money(
    staffing.total_monthly_staffing_cost+
    overhead.total_monthly_operating_overhead+
    processorCost+
    riskAllowance
  );
  const safetyReserveAmount=money(baseOperatingCost*safetyReservePct/100);
  const growthSurplusAmount=money(baseOperatingCost*growthSurplusPct/100);
  const sustainableRevenueNeed=money(baseOperatingCost+safetyReserveAmount);
  const growthRevenueNeed=money(sustainableRevenueNeed+growthSurplusAmount);

  const subscriptionRevenue=money(
    paidProfiles.merchant*subscriptionAmounts.merchant+
    paidProfiles.supplier*subscriptionAmounts.supplier+
    paidProfiles.local_services*subscriptionAmounts.local_services
  );
  const deliveryProductionFeeRevenue=money(deliveryEligibleEarnings*deliveryProductionRatePct/100);
  const nonTransactionPlatformRevenue=money(subscriptionRevenue+deliveryProductionFeeRevenue);
  const breakEvenTransactionRevenueNeed=money(Math.max(0,baseOperatingCost-nonTransactionPlatformRevenue));
  const sustainableTransactionRevenueNeed=money(Math.max(0,sustainableRevenueNeed-nonTransactionPlatformRevenue));
  const growthTransactionRevenueNeed=money(Math.max(0,growthRevenueNeed-nonTransactionPlatformRevenue));

  const rate=(need,base)=>base>0?Math.round((need/base)*1000000)/10000:null;
  const currentBreakEven=rate(breakEvenTransactionRevenueNeed,currentFeeEligibleBase);
  const currentSustainable=rate(sustainableTransactionRevenueNeed,currentFeeEligibleBase);
  const currentGrowth=rate(growthTransactionRevenueNeed,currentFeeEligibleBase);
  const matureBreakEven=rate(breakEvenTransactionRevenueNeed,matureFeeBase);
  const matureSustainable=rate(sustainableTransactionRevenueNeed,matureFeeBase);
  const matureGrowth=rate(growthTransactionRevenueNeed,matureFeeBase);
  const currentStatus=currentFeeEligibleBase<=0
    ?'PROMOTIONAL_VOLUME_REQUIRES_EXTERNAL_FUNDING'
    :(currentSustainable!=null&&currentSustainable>100?'NOT_VIABLE_AT_MODELED_VOLUME':'CALCULABLE');
  const matureStatus=matureFeeBase<=0
    ?'NO_MODELED_ECONOMIC_VOLUME'
    :(matureSustainable!=null&&matureSustainable>100?'NOT_VIABLE_AT_MODELED_VOLUME':'CALCULABLE');

  return{
    simulation_only:true,
    applies_live_fees:false,
    currency_code:'PHP',
    assumptions:{
      completed_events_per_month:events,
      average_fee_base_value:averageFeeBase,
      fee_eligible_share_pct:feeEligibleSharePct,
      online_payment_share_pct:onlineSharePct,
      processor_rate_pct:processorRatePct,
      processor_fixed_per_online_event:processorFixedPerOnlineEvent,
      platform_absorbs_processor_fees:platformAbsorbsProcessorFees,
      risk_allowance_pct:riskAllowancePct,
      platform_absorbs_risk_allowance:platformAbsorbsRiskAllowance,
      safety_reserve_pct: safetyReservePct,
      growth_reinvestment_surplus_pct_of_operating_cost:growthSurplusPct,
      paid_profiles:paidProfiles,
      monthly_subscription_amounts:subscriptionAmounts,
      delivery_eligible_earnings:deliveryEligibleEarnings,
      delivery_production_rate_pct:deliveryProductionRatePct
    },
    revenue_mix:{
      subscription_revenue:subscriptionRevenue,
      delivery_production_fee_revenue:deliveryProductionFeeRevenue,
      non_transaction_platform_revenue:nonTransactionPlatformRevenue,
      break_even_transaction_revenue_need:breakEvenTransactionRevenueNeed,
      sustainable_transaction_revenue_need:sustainableTransactionRevenueNeed,
      growth_transaction_revenue_need:growthTransactionRevenueNeed
    },
    staffing,
    operating_costs:overhead,
    volume:{
      mature_monthly_fee_base:matureFeeBase,
      current_fee_eligible_monthly_base:currentFeeEligibleBase,
      online_events_per_month:onlineEvents,
      online_fee_base:onlineFeeBase
    },
    cost_model:{
      staffing_cost:staffing.total_monthly_staffing_cost,
      operating_overhead:overhead.total_monthly_operating_overhead,
      processor_variable_cost:processorVariable,
      processor_fixed_cost:processorFixed,
      processor_total_cost:processorCost,
      refund_chargeback_bad_debt_allowance:riskAllowance,
      base_operating_cost:baseOperatingCost,
      safety_reserve_amount:safetyReserveAmount,
      growth_reinvestment_surplus_amount:growthSurplusAmount,
      sustainable_revenue_need:sustainableRevenueNeed,
      growth_revenue_need:growthRevenueNeed
    },
    rates:{
      current_rollout:{
        status:currentStatus,
        break_even_pct:currentBreakEven,
        sustainable_pct:currentSustainable,
        growth_reinvestment_pct:currentGrowth,
        fee_base:currentFeeEligibleBase
      },
      mature_100pct_fee_eligible:{
        status:matureStatus,
        break_even_pct:matureBreakEven,
        sustainable_pct:matureSustainable,
        growth_reinvestment_pct:matureGrowth,
        fee_base:matureFeeBase
      }
    },
    guardrails:{
      owner_distribution_in_operating_cost:false,
      owner_distribution_note:'Owner withdrawal/distribution is not payroll or an operating expense and is excluded from the required platform-fee calculation.',
      promotional_rule:'The first 90 eligible days use zero Business & Life platform fee. If fee-eligible share is 0%, modeled operations require Owner/company capital or another legitimate funding source.',
      fee_base_rule:'Average fee-base value is the value to which the future Merchant/Supplier/Local Services transaction fee applies, not automatically the full Customer payment or Delivery earnings.',
      hybrid_revenue_rule:'Subscription revenue and Delivery production-fee revenue reduce the transaction-fee revenue still required for sustainability.',
      activation:'NOT_PERFORMED'
    }
  };
}

export async function pricingScenario(pool,input={}){
  const p=period(input);
  const territoryId=input.territoryId==null?null:Number(input.territoryId);
  const evidence=evidenceClasses(input.evidenceClasses);
  const rates={};
  for(const scope of PRICING_SCENARIO_SERVICES)rates[scope]=scenarioRate(input.rates?.[scope]);

  const finance=await financeKpiOverview(pool,{...p,territoryId,evidenceClasses:evidence});
  const promo=finance.promotion_economics||{};
  const promoRows=promo.services||[];
  const financeByService=new Map((finance.services||[]).map(x=>[x.service_scope,x]));

  const rows=PRICING_SCENARIO_SERVICES.map(scope=>{
    const promotionalGross=money(promoRows.filter(x=>x.service_scope===scope&&x.phase==='promotional').reduce((s,x)=>s+Number(x.gross_value||0),0));
    const postPromoGross=money(promoRows.filter(x=>x.service_scope===scope&&x.phase==='post_promo').reduce((s,x)=>s+Number(x.gross_value||0),0));
    const totalGross=money(promotionalGross+postPromoGross);
    const rate=rates[scope];
    const currentEligibleProjectedRevenue=money(postPromoGross*rate/100);
    const matureProjectedRevenue=money(totalGross*rate/100);
    const f=financeByService.get(scope)||{};
    const variableCost=money(f.variable_cost||0);
    const fixedCost=money(f.allocated_fixed_cost||0);
    const recordedCost=money(variableCost+fixedCost);
    return{
      service_scope:scope,
      proposed_rate_pct:rate,
      promotional_gross_value:promotionalGross,
      post_promo_gross_value:postPromoGross,
      total_completed_gross_value:totalGross,
      projected_revenue_post_promo_actual:currentEligibleProjectedRevenue,
      projected_revenue_mature_volume:matureProjectedRevenue,
      recorded_variable_cost:variableCost,
      recorded_fixed_cost:fixedCost,
      recorded_service_cost:recordedCost,
      projected_operating_pl_post_promo_actual:money(currentEligibleProjectedRevenue-recordedCost),
      projected_operating_pl_mature_volume:money(matureProjectedRevenue-recordedCost),
      break_even_rate_total_volume_pct:pctRatio(recordedCost,totalGross),
      break_even_rate_post_promo_volume_pct:pctRatio(recordedCost,postPromoGross),
      data_status:totalGross>0?'HAS_ACTIVITY':'INSUFFICIENT_ACTIVITY'
    };
  });

  const modeledGross=money(rows.reduce((s,x)=>s+x.total_completed_gross_value,0));
  const postPromoGross=money(rows.reduce((s,x)=>s+x.post_promo_gross_value,0));
  const matureRevenue=money(rows.reduce((s,x)=>s+x.projected_revenue_mature_volume,0));
  const postRevenue=money(rows.reduce((s,x)=>s+x.projected_revenue_post_promo_actual,0));
  const serviceRecordedCosts=money(rows.reduce((s,x)=>s+x.recorded_service_cost,0));
  const totalRecordedCosts=money(Number(finance.variable_costs||0)+Number(finance.allocated_fixed_cost||0));
  const unallocatedSharedCost=money(Math.max(0,totalRecordedCosts-serviceRecordedCosts));

  return{
    simulation_only:true,
    applies_live_fees:false,
    period:p,
    country_code:'PH',
    territory_id:territoryId,
    included_evidence_classes:evidence,
    rates,
    bases:{
      post_promo_actual:'Only completed gross service value already outside the 90-day promotional window.',
      all_activity_mature_simulation:'All completed service value in the period treated hypothetically as mature/post-promo volume. This is not actual billable revenue.'
    },
    services:rows,
    portfolio:{
      total_completed_gross_value:modeledGross,
      actual_post_promo_gross_value:postPromoGross,
      projected_revenue_post_promo_actual:postRevenue,
      projected_revenue_mature_volume:matureRevenue,
      total_recorded_cost:totalRecordedCosts,
      service_scoped_recorded_cost:serviceRecordedCosts,
      unallocated_shared_cost:unallocatedSharedCost,
      projected_operating_pl_post_promo_actual:money(postRevenue-totalRecordedCosts),
      projected_operating_pl_mature_volume:money(matureRevenue-totalRecordedCosts),
      weighted_effective_rate_total_volume_pct:pctRatio(matureRevenue,modeledGross),
      break_even_rate_total_volume_pct:pctRatio(totalRecordedCosts,modeledGross),
      break_even_rate_post_promo_volume_pct:pctRatio(totalRecordedCosts,postPromoGross)
    },
    guardrails:{
      fee_activation:'NOT_PERFORMED',
      promotional_charge:'ZERO_IN_LIVE_POLICY_UNTIL_FUTURE_EXPLICIT_FEE_RESOLUTION',
      paid_conversion_status:promo.paid_conversion_status||'NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY',
      missing_cost_warning:'Results use only costs present in the canonical Finance ledger/payment allocations. Missing invoices or unrecorded overhead are not invented.',
      shared_cost_warning:unallocatedSharedCost>0?'Some recorded costs remain shared/unallocated and are included only in portfolio P/L, not service-specific P/L.':null
    }
  };
}

export const financeInternals=Object.freeze({serviceFromSource,allocateProcessorCents});
