export const MONETIZED_PROFILE_ROLES=Object.freeze(['customer','merchant','supplier','local_services','courier']);
export const OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT=10;
export const DELIVERY_PRODUCTION_FEE_BASIS='verified_delivery_price';

export const PROFILE_MONETIZATION_MODEL=Object.freeze({
  customer:Object.freeze({
    role:'customer',
    monthly_subscription:false,
    transaction_fee:false,
    delivery_production_fee:false,
    promotional_entitlement:false,
    customer_free:true
  }),
  merchant:Object.freeze({
    role:'merchant',
    monthly_subscription:true,
    transaction_fee:true,
    delivery_production_fee:false,
    promotional_entitlement:true,
    customer_free:false
  }),
  supplier:Object.freeze({
    role:'supplier',
    monthly_subscription:true,
    transaction_fee:true,
    delivery_production_fee:false,
    promotional_entitlement:true,
    customer_free:false
  }),
  local_services:Object.freeze({
    role:'local_services',
    user_label:'artisan / local services provider',
    monthly_subscription:true,
    transaction_fee:true,
    delivery_production_fee:false,
    promotional_entitlement:true,
    customer_free:false
  }),
  courier:Object.freeze({
    role:'courier',
    service_scope:'delivery',
    monthly_subscription:false,
    transaction_fee:false,
    delivery_production_fee:true,
    owner_approved_delivery_production_rate_pct:OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,
    delivery_production_fee_basis:DELIVERY_PRODUCTION_FEE_BASIS,
    live_activation:false,
    promotional_entitlement:true,
    customer_free:false
  })
});

export const DIGITAL_PAYMENT_INCENTIVE_DEFAULT=Object.freeze({
  enabled:false,
  provider_confirmation_required:true,
  eligible_payment_methods:['gcash','paymaya','qrph','card'],
  eligible_roles:['merchant','supplier','local_services'],
  preferred_credit_targets:['subscription','future_platform_fee'],
  customer_reward_separate_policy:true,
  funding_source:'explicit_growth_or_finance_budget',
  live_rate:null,
  fixed_credit:null,
  credit_cap:null
});

const clean=(v,max=160)=>String(v??'').trim().slice(0,max);
const cents=v=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<0)throw Object.assign(new Error('Shared cost must be a non-negative number'),{status:400});
  return Math.round((n+Number.EPSILON)*100);
};
const money=c=>Math.round(c)/100;

function distributeCents(totalCents,weights){
  const rows=weights.map((w,index)=>({index,weight:Math.max(0,Number(w)||0)}));
  if(!rows.length)return[];
  const totalWeight=rows.reduce((s,x)=>s+x.weight,0);
  const effective=totalWeight>0?rows.map(x=>({...x,effectiveWeight:x.weight})):rows.map(x=>({...x,effectiveWeight:1}));
  const effectiveTotal=effective.reduce((s,x)=>s+x.effectiveWeight,0);
  let used=0;
  const alloc=effective.map(x=>{
    const raw=totalCents*x.effectiveWeight/effectiveTotal;
    const base=Math.floor(raw);
    used+=base;
    return{...x,cents:base,fraction:raw-base};
  });
  let remaining=totalCents-used;
  alloc.sort((a,b)=>b.fraction-a.fraction||b.effectiveWeight-a.effectiveWeight||a.index-b.index);
  for(let i=0;i<alloc.length&&remaining>0;i=(i+1)%alloc.length,remaining--)alloc[i].cents++;
  alloc.sort((a,b)=>a.index-b.index);
  return alloc.map(x=>x.cents);
}

export function allocateSharedCompanyCost50x50(totalAmount,scopes,{
  driverCode='verified_traffic_units',
  equalWeightPct=50,
  driverWeightPct=50
}={}){
  const list=(Array.isArray(scopes)?scopes:[]).map((x,index)=>({
    scope_id:clean(x?.scope_id||x?.id||String(index+1),120),
    scope_name:clean(x?.scope_name||x?.name||x?.scope_id||x?.id||String(index+1),180),
    driver_value:Math.max(0,Number(x?.driver_value||0))
  }));
  if(!list.length)throw Object.assign(new Error('At least one country/zone is required'),{status:400});
  if(list.some(x=>!x.scope_id))throw Object.assign(new Error('Every country/zone requires a stable scope id'),{status:400});
  if(new Set(list.map(x=>x.scope_id)).size!==list.length)throw Object.assign(new Error('Country/zone scope ids must be unique'),{status:400});

  const eq=Number(equalWeightPct),drv=Number(driverWeightPct);
  if(!Number.isFinite(eq)||!Number.isFinite(drv)||eq<0||drv<0||Math.abs((eq+drv)-100)>1e-9){
    throw Object.assign(new Error('Equal and activity weights must be non-negative and sum to 100%'),{status:400});
  }

  const total=cents(totalAmount);
  const equalPool=Math.round(total*eq/100);
  const driverPool=total-equalPool;
  const equalParts=distributeCents(equalPool,list.map(()=>1));
  const driverTotal=list.reduce((s,x)=>s+x.driver_value,0);
  const driverParts=distributeCents(driverPool,list.map(x=>x.driver_value));

  const rows=list.map((x,i)=>({
    ...x,
    driver_code:driverCode,
    equal_component:money(equalParts[i]),
    activity_component:money(driverParts[i]),
    allocated_amount:money(equalParts[i]+driverParts[i])
  }));
  const allocatedCents=rows.reduce((s,x)=>s+Math.round(x.allocated_amount*100),0);
  return{
    total_amount:money(total),
    equal_weight_pct:eq,
    activity_weight_pct:drv,
    equal_pool:money(equalPool),
    activity_pool:money(driverPool),
    driver_code:driverCode,
    driver_total:driverTotal,
    zero_activity_fallback:driverTotal<=0?'EQUAL_SPLIT_ACTIVITY_HALF':'NOT_USED',
    rows,
    allocated_total:money(allocatedCents),
    residual:money(total-allocatedCents)
  };
}

export function profileMonetizationModel(role){
  const key=clean(role,60);
  const model=PROFILE_MONETIZATION_MODEL[key];
  if(!model)throw Object.assign(new Error('Unsupported monetization profile role'),{status:400});
  return model;
}

export function monetizationPolicyDraft(role,input={}){
  const model=profileMonetizationModel(role);
  const nullableMoney=v=>v==null||v===''?null:Number(v);
  const nullablePct=v=>v==null||v===''?null:Number(v);
  const out={
    role:model.role,
    monthly_subscription_enabled:model.monthly_subscription,
    monthly_subscription_amount:model.monthly_subscription?nullableMoney(input.monthly_subscription_amount):0,
    transaction_fee_enabled:model.transaction_fee,
    transaction_rate_pct:model.transaction_fee?nullablePct(input.transaction_rate_pct):0,
    transaction_fixed_amount:model.transaction_fee?nullableMoney(input.transaction_fixed_amount):0,
    delivery_production_fee_enabled:model.delivery_production_fee,
    delivery_production_rate_pct:model.delivery_production_fee?nullablePct(input.delivery_production_rate_pct??OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT):0,
    delivery_production_fee_basis:model.delivery_production_fee?DELIVERY_PRODUCTION_FEE_BASIS:'',
    promotional_days:model.promotional_entitlement?90:0,
    digital_payment_credit:DIGITAL_PAYMENT_INCENTIVE_DEFAULT
  };
  for(const k of ['monthly_subscription_amount','transaction_fixed_amount']){
    const v=out[k];if(v!=null&&(!Number.isFinite(v)||v<0))throw Object.assign(new Error(k+' must be non-negative'),{status:400});
  }
  for(const k of ['transaction_rate_pct','delivery_production_rate_pct']){
    const v=out[k];if(v!=null&&(!Number.isFinite(v)||v<0||v>100))throw Object.assign(new Error(k+' must be between 0 and 100'),{status:400});
  }
  return out;
}
