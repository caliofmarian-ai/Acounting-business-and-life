const OWNER_AUTHORITIES=new Set(['project_owner','super_admin']);
const ACTIVE_DECISION_STATES=new Set(['open','acknowledged']);
const DECISION_SEVERITY_RANK=Object.freeze({critical:0,high:1,attention:2,normal:3});
const TERRITORY_HEALTH_STATES=new Set(['healthy','supply_constrained','support_constrained','payments_blocked','compliance_blocked','paused','unknown']);

const clean=(value,max=240)=>String(value??'').trim().slice(0,max);
const finiteOrNull=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const intOrNull=value=>{
  const n=finiteOrNull(value);
  return n===null?null:Math.max(0,Math.trunc(n));
};
const isoOrNull=value=>{
  if(!value)return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
};
const shortRevision=value=>{
  const v=clean(value,120);
  return v?v.slice(0,12):null;
};

function evidenceCount(value){
  return intOrNull(value);
}

function evidenceHealthState(count,{attentionState='attention'}={}){
  return count===null?'unknown':count>0?attentionState:'healthy';
}

function productionHealth(input={}){
  const intended=shortRevision(input.intended_revision??input.intendedRevision);
  const production=shortRevision(input.production_revision??input.productionRevision);
  const healthy=typeof input.healthy==='boolean'?input.healthy:null;
  const deploying=input.deploying===true;
  let state='unknown',reason='Deployment evidence unavailable';
  if(deploying){
    state='attention';reason='Production deployment is still in progress';
  }else if(healthy===false){
    state='critical';reason='Production healthcheck is failing';
  }else if(intended&&production&&intended!==production){
    state='attention';reason='Production revision does not match the intended release';
  }else if(healthy===true&&intended&&production&&intended===production){
    state='healthy';reason='Production is on the intended release';
  }else if(healthy===true&&production){
    state='healthy';reason='Production is healthy; intended release evidence is unavailable';
  }
  return{
    state,reason,
    intended_revision:intended,
    production_revision:production,
    last_successful_deploy_at:isoOrNull(input.last_successful_deploy_at??input.lastSuccessfulDeployAt),
    source:clean(input.source||'deployment_evidence',80)||'deployment_evidence'
  };
}

function moneyHealth(input={}){
  const reconciliation=evidenceCount(input.reconciliation_exceptions??input.reconciliationExceptions);
  const failedSettlements=evidenceCount(input.failed_settlements??input.failedSettlements);
  const refundExceptions=evidenceCount(input.refund_exceptions??input.refundExceptions);
  const mismatchAmount=finiteOrNull(input.mismatch_amount??input.mismatchAmount);
  const providerState=clean(input.provider_state??input.providerState,40).toLowerCase()||null;
  const hasAnyEvidence=[reconciliation,failedSettlements,refundExceptions,mismatchAmount].some(v=>v!==null)||providerState!==null;
  const exceptionTotal=[reconciliation,failedSettlements,refundExceptions].reduce((sum,v)=>sum+(v??0),0);
  let state='unknown',reason='Payment reconciliation evidence unavailable';
  if(hasAnyEvidence){
    if(providerState&&['down','degraded','failed','blocked'].includes(providerState)){
      state='attention';reason='Payment provider requires review';
    }else if(exceptionTotal>0||(mismatchAmount!==null&&Math.abs(mismatchAmount)>0)){
      state='attention';reason='Payment or settlement evidence needs review';
    }else if(reconciliation===0&&failedSettlements===0&&refundExceptions===0&&(mismatchAmount===null||mismatchAmount===0)){
      state='healthy';reason='No payment reconciliation exceptions';
    }
  }
  return{
    state,reason,
    reconciliation_exceptions:reconciliation,
    failed_settlements:failedSettlements,
    refund_exceptions:refundExceptions,
    mismatch_amount:mismatchAmount,
    provider_state:providerState,
    source:clean(input.source||'payment_core',80)||'payment_core'
  };
}

function supportHealth(input={}){
  const open=evidenceCount(input.open);
  const urgent=evidenceCount(input.urgent);
  const oldestUrgentAt=isoOrNull(input.oldest_urgent_at??input.oldestUrgentAt);
  const state=evidenceHealthState(urgent);
  return{
    state,
    reason:urgent===null?'Support urgency evidence unavailable':urgent>0?'Urgent Support tickets need attention':'No urgent Support tickets',
    open,urgent,oldest_urgent_at:oldestUrgentAt,
    source:clean(input.source||'support',80)||'support'
  };
}

function safetyHealth(input={}){
  const severe=evidenceCount(input.severe);
  const privacySecurity=evidenceCount(input.privacy_security??input.privacySecurity);
  const hasEvidence=severe!==null||privacySecurity!==null;
  const total=(severe??0)+(privacySecurity??0);
  return{
    state:hasEvidence?(total>0?'critical':'healthy'):'unknown',
    reason:!hasEvidence?'Trust & Safety evidence unavailable':total>0?'Severe safety/privacy/security escalation requires attention':'No severe unresolved safety incidents',
    severe,privacy_security:privacySecurity,
    source:clean(input.source||'trust_safety',80)||'trust_safety'
  };
}

function normalizeDecision(raw={}){
  const state=clean(raw.state||'open',30).toLowerCase();
  const requiredAuthority=clean(raw.required_authority??raw.requiredAuthority,40).toLowerCase();
  if(!ACTIVE_DECISION_STATES.has(state)||!OWNER_AUTHORITIES.has(requiredAuthority))return null;
  const sourceDomain=clean(raw.source_domain??raw.sourceDomain,60);
  const sourceType=clean(raw.source_type??raw.sourceType,60);
  const sourceId=clean(raw.source_id??raw.sourceId,120);
  const code=clean(raw.decision_code??raw.decisionCode,100);
  if(!code||!sourceDomain||!sourceType||!sourceId)return null;
  const severity=clean(raw.severity||'normal',20).toLowerCase();
  return{
    decision_code:code,
    source_domain:sourceDomain,
    source_type:sourceType,
    source_id:sourceId,
    required_authority:requiredAuthority,
    severity:Object.hasOwn(DECISION_SEVERITY_RANK,severity)?severity:'normal',
    state,
    reason_code:clean(raw.reason_code??raw.reasonCode,100)||null,
    title:clean(raw.title,180)||'Owner decision required',
    summary:clean(raw.summary,700)||'Open the canonical evidence before deciding.',
    impact:clean(raw.impact,500)||null,
    due_at:isoOrNull(raw.due_at??raw.dueAt),
    created_at:isoOrNull(raw.created_at??raw.createdAt),
    territory_id:intOrNull(raw.territory_id??raw.territoryId),
    country_code:clean(raw.country_code??raw.countryCode,8)||'PH'
  };
}

export function ownerDecisionQueue(items=[]){
  const unique=new Map();
  for(const item of Array.isArray(items)?items:[]){
    const normalized=normalizeDecision(item);
    if(!normalized)continue;
    const key=[normalized.decision_code,normalized.source_domain,normalized.source_type,normalized.source_id].join(':');
    const current=unique.get(key);
    if(!current||String(normalized.created_at||'')>String(current.created_at||''))unique.set(key,normalized);
  }
  return[...unique.values()].sort((a,b)=>{
    const severity=(DECISION_SEVERITY_RANK[a.severity]??9)-(DECISION_SEVERITY_RANK[b.severity]??9);
    if(severity!==0)return severity;
    const dueA=a.due_at||'9999',dueB=b.due_at||'9999';
    if(dueA!==dueB)return dueA.localeCompare(dueB);
    return String(a.created_at||'').localeCompare(String(b.created_at||''));
  });
}

function territorySummary(raw={}){
  const health=clean(raw.health,40).toLowerCase();
  return{
    territory_id:intOrNull(raw.territory_id??raw.territoryId),
    name:clean(raw.name,140)||'Territory',
    status:clean(raw.status,40)||'unknown',
    health:TERRITORY_HEALTH_STATES.has(health)?health:'unknown',
    active_merchants:evidenceCount(raw.active_merchants??raw.activeMerchants),
    eligible_couriers:evidenceCount(raw.eligible_couriers??raw.eligibleCouriers),
    active_local_services:evidenceCount(raw.active_local_services??raw.activeLocalServices),
    demand_accounts:evidenceCount(raw.demand_accounts??raw.demandAccounts),
    operational_exceptions:evidenceCount(raw.operational_exceptions??raw.operationalExceptions),
    source:clean(raw.source||'territory_governance',80)||'territory_governance'
  };
}

function financeSummary(raw={}){
  return{
    currency:clean(raw.currency||'PHP',8)||'PHP',
    platform_revenue:finiteOrNull(raw.platform_revenue??raw.platformRevenue),
    variable_cost:finiteOrNull(raw.variable_cost??raw.variableCost),
    allocated_fixed_cost:finiteOrNull(raw.allocated_fixed_cost??raw.allocatedFixedCost),
    contribution:finiteOrNull(raw.contribution),
    operating_result:finiteOrNull(raw.operating_result??raw.operatingResult),
    promo_subsidy:finiteOrNull(raw.promo_subsidy??raw.promoSubsidy),
    evidence_class:clean(raw.evidence_class??raw.evidenceClass,30)||null,
    source:clean(raw.source||'finance_kpi',80)||'finance_kpi'
  };
}

function productQualitySummary(raw={}){
  return{
    open_p0:evidenceCount(raw.open_p0??raw.openP0),
    open_p1:evidenceCount(raw.open_p1??raw.openP1),
    production_regressions:evidenceCount(raw.production_regressions??raw.productionRegressions),
    parity_issues:evidenceCount(raw.parity_issues??raw.parityIssues),
    failed_acceptance_waves:evidenceCount(raw.failed_acceptance_waves??raw.failedAcceptanceWaves),
    last_functional_qa_at:isoOrNull(raw.last_functional_qa_at??raw.lastFunctionalQaAt),
    source:clean(raw.source||'quality_evidence',80)||'quality_evidence'
  };
}

export function buildOwnerControlTower(input={}){
  const generatedAt=isoOrNull(input.generated_at??input.generatedAt)||new Date().toISOString();
  const decisions=ownerDecisionQueue(input.owner_decisions??input.ownerDecisions);
  return{
    version:'owner-control-tower-v1',
    generated_at:generatedAt,
    scope:{
      country_code:clean(input.scope?.country_code??input.scope?.countryCode,8)||'PH',
      territory_ids:(Array.isArray(input.scope?.territory_ids??input.scope?.territoryIds)?(input.scope.territory_ids??input.scope.territoryIds):[])
        .map(intOrNull).filter(v=>v!==null)
    },
    health:{
      production:productionHealth(input.production),
      money:moneyHealth(input.money),
      support:supportHealth(input.support),
      safety:safetyHealth(input.safety)
    },
    decision_status:{
      state:input.owner_decisions===undefined&&input.ownerDecisions===undefined?'unknown':'available',
      open_count:input.owner_decisions===undefined&&input.ownerDecisions===undefined?null:decisions.length
    },
    owner_decisions:decisions,
    territories:(Array.isArray(input.territories)?input.territories:[]).slice(0,50).map(territorySummary),
    finance:financeSummary(input.finance),
    product_quality:productQualitySummary(input.product_quality??input.productQuality)
  };
}

export function ownerControlTowerHeadline(model){
  const decisions=model?.decision_status?.open_count;
  if(decisions===null)return{state:'unknown',title:'Owner decision status unavailable',detail:'Decision evidence could not be confirmed.'};
  if(decisions>0)return{state:'attention',title:`${decisions} item${decisions===1?'':'s'} need Owner attention`,detail:'Review protected decisions before changing affected operations.'};
  const health=Object.values(model?.health||{});
  if(health.some(x=>x?.state==='critical'))return{state:'critical',title:'Business & Life needs attention',detail:'A critical operational domain is reporting an exception.'};
  if(health.some(x=>x?.state==='attention'))return{state:'attention',title:'Business & Life needs review',detail:'An operational exception is active, but no protected Owner decision is currently queued.'};
  if(health.length&&health.every(x=>x?.state==='healthy'))return{state:'healthy',title:'Business & Life is operating normally',detail:'No critical Owner action is waiting.'};
  return{state:'unknown',title:'Platform health is partially unavailable',detail:'Some health evidence could not be confirmed.'};
}
