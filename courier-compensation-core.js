import {deliveryPriceSplit} from './delivery-pricing-v2-core.js';
import {
  OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,
  OWNER_APPROVED_DELIVERY_PROMO_DAYS
} from './monetization-policy-v2.js';

const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const cents=v=>Math.round(money(v)*100);
const fromCents=v=>Math.round(Number(v||0))/100;
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);

function positiveId(v,label){
  const n=Number(v);
  if(!Number.isInteger(n)||n<=0)throw Object.assign(new Error(label+' must be a positive integer'),{status:400});
  return n;
}

function distributeCents(totalCents,weights){
  const total=Math.max(0,Math.round(Number(totalCents)||0));
  const rows=(Array.isArray(weights)?weights:[]).map((weight,index)=>({
    index,
    weight:Math.max(0,Number(weight)||0)
  }));
  if(!rows.length)return[];
  const weightTotal=rows.reduce((sum,row)=>sum+row.weight,0);
  const effective=weightTotal>0?rows:rows.map(row=>({...row,weight:1}));
  const denominator=effective.reduce((sum,row)=>sum+row.weight,0);
  let used=0;
  const parts=effective.map(row=>{
    const exact=total*row.weight/denominator;
    const base=Math.floor(exact);
    used+=base;
    return{...row,cents:base,fraction:exact-base};
  });
  let remaining=total-used;
  parts.sort((a,b)=>b.fraction-a.fraction||b.weight-a.weight||a.index-b.index);
  for(let i=0;remaining>0&&parts.length;i=(i+1)%parts.length,remaining--)parts[i].cents++;
  parts.sort((a,b)=>a.index-b.index);
  return parts.map(row=>row.cents);
}

export async function activeDeliveryCompensationPolicy(db,{at,territoryId=null}={}){
  const when=at instanceof Date?at.toISOString():new Date(at||Date.now()).toISOString();
  const territory=territoryId==null?null:positiveId(territoryId,'territory_id');
  const {rows}=await db.query(`
    SELECT p.id,p.policy_code,p.version,p.status,p.country_code,p.territory_id,
           p.service_scope,p.effective_from,p.effective_until,p.protected_platform_policy,
           r.id rule_id,r.rate,r.component_code,r.base_component,r.charged_to,
           r.beneficiary_type,r.calculation_type
    FROM fee_policy_versions p
    JOIN fee_policy_rules r ON r.fee_policy_version_id=p.id
    WHERE p.status='active'
      AND p.country_code='PH'
      AND p.service_scope IN ('delivery','all')
      AND p.business_id IS NULL
      AND (p.territory_id IS NULL OR p.territory_id=$2)
      AND (p.effective_from IS NULL OR p.effective_from<=$1::timestamptz)
      AND (p.effective_until IS NULL OR p.effective_until>$1::timestamptz)
      AND p.protected_platform_policy=TRUE
      AND r.component_code='platform_fee'
      AND r.base_component='delivery'
      AND r.charged_to='courier_deduction'
      AND r.beneficiary_type='platform'
      AND r.calculation_type='percentage'
      AND ABS(COALESCE(r.rate,0)-$3::numeric)<0.00000001
    ORDER BY CASE WHEN p.territory_id=$2 THEN 0 ELSE 1 END,p.version DESC,p.id DESC
    LIMIT 1
  `,[when,territory,OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT]);
  return rows[0]||null;
}

async function orderDeliveryPaymentEvidence(db,orderId){
  const id=positiveId(orderId,'order_id');
  const refunds=await db.query(`
    SELECT COUNT(*)::int refund_count,COALESCE(SUM(r.amount),0)::numeric refunded_amount
    FROM refunds r
    JOIN payment_intents pi ON pi.id=r.payment_intent_id
    WHERE pi.source_type='order' AND pi.source_id=$1 AND r.status='succeeded'
  `,[id]);
  const refundRow=refunds.rows[0]||{};
  if(Number(refundRow.refund_count||0)>0){
    return{
      ready:false,
      reason:'ORDER_REFUND_REQUIRES_ALLOCATION_REVIEW',
      refunded_amount:money(refundRow.refunded_amount),
      rows:[]
    };
  }

  const evidence=await db.query(`
    SELECT pi.id payment_intent_id,pi.public_id payment_intent_public_id,
           pi.status payment_intent_status,
           pa.id delivery_allocation_id,pa.amount delivery_amount,
           pa.currency_code,pa.settlement_status
    FROM payment_intents pi
    JOIN payment_allocations pa ON pa.payment_intent_id=pi.id
    WHERE pi.source_type='order'
      AND pi.source_id=$1
      AND pi.status='succeeded'
      AND pa.component_code='delivery'
      AND pa.amount>0
      AND pa.settlement_status NOT IN ('reversed','failed')
    ORDER BY pi.id,pa.id
    FOR UPDATE OF pa
  `,[id]);
  return{
    ready:evidence.rows.length>0,
    reason:evidence.rows.length?'READY':'DELIVERY_PAYMENT_EVIDENCE_MISSING',
    refunded_amount:0,
    rows:evidence.rows
  };
}

async function existingDeliveryCompensation(db,{orderId,deliveryId,courierAccountId}){
  const {rows}=await db.query(`
    SELECT COUNT(*)::int allocation_count,COALESCE(SUM(pa.amount),0)::numeric amount
    FROM payment_allocations pa
    JOIN payment_intents pi ON pi.id=pa.payment_intent_id
    WHERE pi.source_type='order' AND pi.source_id=$1
      AND pa.component_code='courier_net'
      AND pa.economic_party_id=$2
      AND pa.settlement_status<>'reversed'
      AND pa.rule_snapshot->>'delivery_id'=$3
  `,[
    positiveId(orderId,'order_id'),
    String(positiveId(courierAccountId,'courier_account_id')),
    String(positiveId(deliveryId,'delivery_id'))
  ]);
  const row=rows[0]||{};
  return{count:Number(row.allocation_count||0),amount:money(row.amount)};
}

export async function allocateCourierCompensation(db,input={}){
  const deliveryId=positiveId(input.deliveryId,'delivery_id');
  const orderId=positiveId(input.orderId,'order_id');
  const courierAccountId=positiveId(input.courierAccountId,'courier_account_id');
  const territoryId=input.territoryId==null?null:positiveId(input.territoryId,'territory_id');
  const phase=clean(input.phase,40);
  if(!['promotional','post_promo'].includes(phase)){
    throw Object.assign(new Error('Courier compensation requires a promotional or post_promo monetization phase'),{status:400});
  }

  const completedAt=input.completedAt instanceof Date?input.completedAt.toISOString():new Date(input.completedAt||Date.now()).toISOString();
  const currencyCode=clean(input.currencyCode||'PHP',10)||'PHP';
  const deliveryPrice=money(input.deliveryPrice);
  const feeBasis=money(input.feeBasis);
  const passThrough=money(input.passThrough);
  if(deliveryPrice<=0||feeBasis<=0) return{status:'HOLD',reason:'NO_COMPENSATION_BASIS',delivery_id:deliveryId};
  if(passThrough<0||passThrough>deliveryPrice+0.001) return{status:'HOLD',reason:'INVALID_PASS_THROUGH',delivery_id:deliveryId};

  const already=await existingDeliveryCompensation(db,{orderId,deliveryId,courierAccountId});
  if(already.count>0){
    return{
      status:'TRACKED',reason:'IDEMPOTENT_EXISTING',
      delivery_id:deliveryId,courier_account_id:courierAccountId,
      courier_gross_entitlement:already.amount,allocation_count:already.count
    };
  }

  let policy=null;
  if(phase==='post_promo'){
    policy=await activeDeliveryCompensationPolicy(db,{at:completedAt,territoryId});
    if(!policy){
      return{
        status:'HOLD',
        reason:'POST_PROMO_DELIVERY_POLICY_NOT_ACTIVE',
        delivery_id:deliveryId,courier_account_id:courierAccountId,
        owner_approved_rate_pct:OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT
      };
    }
  }

  const split=deliveryPriceSplit(deliveryPrice,{
    postPromo:phase==='post_promo',
    platformRatePct:phase==='post_promo'?Number(policy.rate):OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,
    excludedPassThrough:passThrough
  });
  if(Math.abs(Number(split.platform_fee_basis_amount)-feeBasis)>0.011){
    return{
      status:'HOLD',
      reason:'DELIVERY_FEE_BASIS_MISMATCH',
      delivery_id:deliveryId,
      expected_fee_basis:feeBasis,
      calculated_fee_basis:split.platform_fee_basis_amount
    };
  }

  const evidence=await orderDeliveryPaymentEvidence(db,orderId);
  if(!evidence.ready){
    return{
      status:'HOLD',reason:evidence.reason,delivery_id:deliveryId,
      refunded_amount:evidence.refunded_amount||0
    };
  }
  const deliveryPaid=money(evidence.rows.reduce((sum,row)=>sum+Number(row.delivery_amount||0),0));
  if(Math.abs(deliveryPaid-deliveryPrice)>0.011){
    return{
      status:'HOLD',
      reason:'DELIVERY_PAYMENT_AMOUNT_MISMATCH',
      delivery_id:deliveryId,
      delivery_price:deliveryPrice,
      confirmed_delivery_payment:deliveryPaid
    };
  }

  const weights=evidence.rows.map(row=>Math.max(0,cents(row.delivery_amount)));
  const basisShares=distributeCents(cents(split.platform_fee_basis_amount),weights);
  const courierShares=distributeCents(cents(split.courier_gross_entitlement),basisShares);
  const platformShares=distributeCents(cents(split.business_life_delivery_fee),basisShares);
  let courierAllocationCount=0,platformAllocationCount=0;

  for(let index=0;index<evidence.rows.length;index++){
    const row=evidence.rows[index];
    const basisShare=fromCents(basisShares[index]);
    const courierShare=fromCents(courierShares[index]);
    const platformShare=fromCents(platformShares[index]);
    const snapshot={
      version:'courier_compensation_v1',
      delivery_id:deliveryId,
      order_id:orderId,
      courier_account_id:courierAccountId,
      phase,
      promotional_days:OWNER_APPROVED_DELIVERY_PROMO_DAYS,
      delivery_price:split.delivery_price,
      platform_fee_basis_amount:split.platform_fee_basis_amount,
      excluded_pass_through:split.excluded_pass_through,
      platform_rate_pct:split.platform_rate_pct,
      payment_delivery_allocation_id:Number(row.delivery_allocation_id),
      payment_delivery_evidence_amount:money(row.delivery_amount),
      fee_policy_id:policy?Number(policy.id):null,
      fee_policy_code:policy?.policy_code||'delivery_promo_owner_policy',
      fee_policy_version:policy?Number(policy.version):null
    };

    if(courierShare>0){
      const inserted=await db.query(`
        INSERT INTO payment_allocations(
          payment_intent_id,component_code,economic_party_type,economic_party_id,
          gross_base,amount,currency_code,fee_policy_version_id,rule_snapshot,settlement_status
        )
        SELECT $1,'courier_net','courier_account',$2,$3,$4,$5,$6,$7::jsonb,'eligible'
        WHERE NOT EXISTS(
          SELECT 1 FROM payment_allocations
          WHERE payment_intent_id=$1
            AND component_code='courier_net'
            AND economic_party_id=$2
            AND settlement_status<>'reversed'
            AND rule_snapshot->>'delivery_id'=$8
        )
        RETURNING id
      `,[
        Number(row.payment_intent_id),String(courierAccountId),basisShare,courierShare,currencyCode,
        policy?Number(policy.id):null,JSON.stringify(snapshot),String(deliveryId)
      ]);
      courierAllocationCount+=inserted.rowCount;
    }

    if(platformShare>0&&policy){
      const platformSnapshot={...snapshot,beneficiary:'business_life'};
      const inserted=await db.query(`
        INSERT INTO payment_allocations(
          payment_intent_id,component_code,economic_party_type,economic_party_id,
          gross_base,amount,currency_code,fee_policy_version_id,rule_snapshot,settlement_status
        )
        SELECT $1,'platform_fee','platform','business_life',$2,$3,$4,$5,$6::jsonb,'eligible'
        WHERE NOT EXISTS(
          SELECT 1 FROM payment_allocations
          WHERE payment_intent_id=$1
            AND component_code='platform_fee'
            AND economic_party_id='business_life'
            AND settlement_status<>'reversed'
            AND rule_snapshot->>'delivery_id'=$7
        )
        RETURNING id
      `,[
        Number(row.payment_intent_id),basisShare,platformShare,currencyCode,
        Number(policy.id),JSON.stringify(platformSnapshot),String(deliveryId)
      ]);
      platformAllocationCount+=inserted.rowCount;
    }
  }

  const tracked=await existingDeliveryCompensation(db,{orderId,deliveryId,courierAccountId});
  return{
    status:tracked.count>0?'TRACKED':'HOLD',
    reason:tracked.count>0?'COURIER_NET_ALLOCATED':'ALLOCATION_NOT_CREATED',
    delivery_id:deliveryId,
    order_id:orderId,
    courier_account_id:courierAccountId,
    phase,
    delivery_price:split.delivery_price,
    compensation_basis:split.platform_fee_basis_amount,
    excluded_pass_through:split.excluded_pass_through,
    platform_rate_pct:split.platform_rate_pct,
    business_life_delivery_fee:split.business_life_delivery_fee,
    courier_gross_entitlement:split.courier_gross_entitlement,
    tracked_courier_amount:tracked.amount,
    courier_allocation_count:tracked.count,
    inserted_courier_allocations:courierAllocationCount,
    inserted_platform_allocations:platformAllocationCount,
    settlement_status:tracked.count>0?'eligible':'not_configured',
    payout_status:'NOT_EXECUTED',
    policy:policy?{
      id:Number(policy.id),policy_code:policy.policy_code,version:Number(policy.version),status:policy.status
    }:null
  };
}
