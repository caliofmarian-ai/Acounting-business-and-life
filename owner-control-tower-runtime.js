import {buildOwnerControlTower,ownerControlTowerHeadline} from './owner-control-tower-core.js';
import {financeKpiOverview} from './finance-core.js';
import {paymentExceptionSummary} from './payment-core.js';
import {territoryDemandOverview} from './territory-demand-core.js';
import {publicDeploymentEvidence} from './deployment-evidence.js';

const clean=(value,max=120)=>String(value??'').trim().slice(0,max);
const numberOrNull=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};

async function safeRead(fn){
  try{return{available:true,value:await fn()}}
  catch{return{available:false,value:null}}
}

export async function severeSafetySummary(pool){
  const q=await pool.query(`
    SELECT
      COUNT(*) FILTER(WHERE state<>'resolved')::int severe,
      MIN(created_at) FILTER(WHERE state<>'resolved' AND severity='critical') oldest_critical_at
    FROM trust_case_escalations
  `);
  return{
    severe:Number(q.rows[0]?.severe||0),
    privacy_security:null,
    oldest_critical_at:q.rows[0]?.oldest_critical_at||null,
    source:'trust_safety'
  };
}

export async function territoryCapacitySummary(pool){
  const q=await pool.query(`
    SELECT
      t.id territory_id,t.name,t.status,t.psgc_code,t.territory_type,
      (SELECT COUNT(DISTINCT pa.account_id)::int
         FROM profile_authorizations pa
        WHERE pa.territory_id=t.id AND pa.role='merchant' AND pa.status='active') active_merchants,
      (SELECT COUNT(DISTINCT pa.account_id)::int
         FROM profile_authorizations pa
        WHERE pa.territory_id=t.id AND pa.role='service_provider' AND pa.status='active') active_local_services,
      (SELECT COUNT(DISTINCT pa.account_id)::int
         FROM profile_authorizations pa
         JOIN courier_profiles c ON c.account_id=pa.account_id
        WHERE pa.territory_id=t.id AND pa.role='courier' AND pa.status='active'
          AND c.eligibility_status='approved' AND c.available=TRUE
          AND (c.eligibility_expires_at IS NULL OR c.eligibility_expires_at>NOW())) eligible_couriers
    FROM territories t
    WHERE t.country_code='PH' AND t.status<>'closed'
    ORDER BY t.id
  `);
  return q.rows.map(row=>({
    territory_id:Number(row.territory_id),
    name:clean(row.name,140)||'Territory',
    status:clean(row.status,40)||'unknown',
    psgc_code:clean(row.psgc_code,20)||null,
    territory_type:clean(row.territory_type,40)||null,
    active_merchants:Number(row.active_merchants||0),
    active_local_services:Number(row.active_local_services||0),
    eligible_couriers:Number(row.eligible_couriers||0)
  }));
}

function territoryHealth(row,demandAccounts){
  const status=clean(row.status,40).toLowerCase();
  if(['paused','closed'].includes(status))return'paused';
  if(['active','onboarding'].includes(status)&&Number(row.eligible_couriers)===0
    &&(Number(row.active_merchants)>0||(demandAccounts!==null&&demandAccounts>0)))return'supply_constrained';
  return'unknown';
}

export async function buildOwnerControlTowerRuntime(pool,{
  homeSummary={},
  fallbackTerritories=[],
  runtimeHealthy=true,
  env=process.env,
  dependencies={}
}={}){
  const observedAt=new Date().toISOString();
  const financeRead=dependencies.financeKpiOverview||financeKpiOverview;
  const paymentRead=dependencies.paymentExceptionSummary||paymentExceptionSummary;
  const safetyRead=dependencies.severeSafetySummary||severeSafetySummary;
  const territoryRead=dependencies.territoryCapacitySummary||territoryCapacitySummary;
  const demandRead=dependencies.territoryDemandOverview||territoryDemandOverview;
  const deploymentRead=dependencies.publicDeploymentEvidence||publicDeploymentEvidence;

  const [payment,finance,safety,capacity,demand]=await Promise.all([
    safeRead(()=>paymentRead(pool)),
    safeRead(()=>financeRead(pool)),
    safeRead(()=>safetyRead(pool)),
    safeRead(()=>territoryRead(pool)),
    safeRead(()=>demandRead(pool,{level:'barangay',limit:100}))
  ]);

  const demandByPsgc=new Map((demand.value?.items||[]).map(item=>[
    clean(item.psgc_code,20),
    Number.isFinite(Number(item.profile_interest_accounts))?Number(item.profile_interest_accounts):null
  ]));
  const territoryBase=capacity.available?capacity.value:(Array.isArray(fallbackTerritories)?fallbackTerritories:[]);
  const territories=territoryBase.map(row=>{
    const code=clean(row.psgc_code,20);
    const demandAccounts=code&&demandByPsgc.has(code)?demandByPsgc.get(code):null;
    return{
      territory_id:numberOrNull(row.territory_id??row.id),
      name:row.name,
      status:row.status,
      health:territoryHealth(row,demandAccounts),
      active_merchants:numberOrNull(row.active_merchants),
      eligible_couriers:numberOrNull(row.eligible_couriers),
      active_local_services:numberOrNull(row.active_local_services),
      demand_accounts:demandAccounts,
      operational_exceptions:null,
      source:'territory_governance',
      updated_at:observedAt
    };
  });

  const deployment=deploymentRead(env)||{};
  const financeValue=finance.value||{};
  const paymentValue=payment.value||{};
  const safetyValue=safety.value||{};
  const support=homeSummary?.support||{};

  const model=buildOwnerControlTower({
    generated_at:observedAt,
    scope:{country_code:'PH',territory_ids:territories.map(x=>x.territory_id).filter(Number.isFinite)},
    production:{
      healthy:Boolean(runtimeHealthy),
      production_revision:deployment.revision||null,
      intended_revision:env.RELEASE_INTENDED_SHA||null,
      source:'deployment_evidence',
      updated_at:observedAt
    },
    money:payment.available?{
      reconciliation_exceptions:paymentValue.reconciliation_exceptions,
      failed_settlements:paymentValue.failed_settlements,
      refund_exceptions:paymentValue.refund_exceptions,
      mismatch_amount:paymentValue.mismatch_amount,
      provider_state:paymentValue.provider_state,
      source:'payment_core',
      updated_at:paymentValue.observed_at||observedAt
    }:{source:'payment_core'},
    support:homeSummary?.support?{
      open:numberOrNull(support.open),
      urgent:numberOrNull(support.urgent),
      oldest_urgent_at:support.oldest_urgent_at||null,
      source:'support',
      updated_at:observedAt
    }:{source:'support'},
    safety:safety.available?{
      severe:numberOrNull(safetyValue.severe),
      privacy_security:numberOrNull(safetyValue.privacy_security),
      oldest_critical_at:safetyValue.oldest_critical_at||null,
      source:'trust_safety',
      updated_at:observedAt
    }:{source:'trust_safety'},
    territories,
    finance:finance.available?{
      currency:'PHP',
      platform_revenue:numberOrNull(financeValue.platform_revenue),
      variable_cost:numberOrNull(financeValue.variable_costs),
      allocated_fixed_cost:numberOrNull(financeValue.allocated_fixed_cost),
      contribution:numberOrNull(financeValue.contribution),
      operating_result:numberOrNull(financeValue.operating_profit),
      promo_subsidy:numberOrNull(financeValue.promotion_economics?.direct_cost?.promotional?.total_direct_cost),
      evidence_class:'actual+accrued',
      source:'finance_kpi',
      updated_at:observedAt
    }:{currency:'PHP',source:'finance_kpi'},
    product_quality:{source:'quality_evidence'}
    // owner_decisions is deliberately omitted until a canonical protected-decision source exists.
  });

  return{
    model,
    headline:ownerControlTowerHeadline(model),
    evidence_status:{
      payment:payment.available?'available':'unavailable',
      finance:finance.available?'available':'unavailable',
      safety:safety.available?'available':'unavailable',
      territory_capacity:capacity.available?'available':'unavailable',
      territory_demand:demand.available?'available':'unavailable',
      owner_decisions:'unavailable'
    }
  };
}
