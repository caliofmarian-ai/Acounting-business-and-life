
import crypto from 'node:crypto';
import {reconcileDeliveryRefundEconomics} from './paymongo-adapter.js';
import {courierMoneyHomeSnapshot} from './profile-money-core.js';

export async function runDeliveryRefundEconomicsV2DAcceptance({
  pool,base,secret,courierAlias,
  helpers:{qaAccountSession,requestJson,expectStatus}
}){
  const courier=await qaAccountSession({
    pool,base,secret,email:courierAlias,role:'courier',label:'Delivery Refund Economics V2D Courier QA'
  });
  const client=await pool.connect();
  const marker=crypto.randomBytes(10).toString('hex');
  let evidence=null;

  const num=value=>Number(value||0);
  const close=(actual,expected)=>Math.abs(num(actual)-num(expected))<0.001;

  const createIntent=async({suffix,refundAmount,courierStatus='eligible',platformStatus='held',settlementLinked=false})=>{
    const sourceId=990000000+Number(suffix);
    const intent=await client.query(
      "INSERT INTO payment_intents(public_id,idempotency_key,source_type,source_id,logical_method,currency_code,amount,status,provider_code,provider_status) VALUES($1,$2,'order',$3,'online_other','PHP',100,'succeeded','qa_internal','succeeded') RETURNING id",
      ['qa-refund-v2d-'+marker+'-'+suffix,'qa-refund-v2d-idem-'+marker+'-'+suffix,sourceId]
    );
    const intentId=Number(intent.rows[0].id);
    const deliveryId='qa-delivery-'+marker+'-'+suffix;
    await client.query(
      "INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,rule_snapshot,settlement_status) VALUES($1,'delivery','customer','',100,100,'PHP',$2::jsonb,'eligible')",
      [intentId,JSON.stringify({delivery_id:deliveryId,qa_fixture:true})]
    );
    const courierAlloc=await client.query(
      "INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,rule_snapshot,settlement_status) VALUES($1,'courier_net','courier',$2,100,90,'PHP',$3::jsonb,$4) RETURNING id",
      [intentId,String(courier.accountId),JSON.stringify({delivery_id:deliveryId,qa_fixture:true}),courierStatus]
    );
    const platformAlloc=await client.query(
      "INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,rule_snapshot,settlement_status) VALUES($1,'platform_fee','platform','business_life',100,10,'PHP',$2::jsonb,$3) RETURNING id",
      [intentId,JSON.stringify({delivery_id:deliveryId,qa_fixture:true}),platformStatus]
    );
    const courierAllocationId=Number(courierAlloc.rows[0].id);
    const platformAllocationId=Number(platformAlloc.rows[0].id);

    if(settlementLinked){
      const settlement=await client.query(
        "INSERT INTO settlements(public_id,beneficiary_type,beneficiary_ref,provider_code,currency_code,gross_amount,deduction_amount,net_amount,status,evidence_reference) VALUES($1,'platform','business_life','qa_internal','PHP',10,0,10,'processing','qa-only-refund-v2d') RETURNING id",
        ['qa-settlement-v2d-'+marker+'-'+suffix]
      );
      await client.query(
        "INSERT INTO settlement_lines(settlement_id,payment_allocation_id,amount) VALUES($1,$2,10)",
        [Number(settlement.rows[0].id),platformAllocationId]
      );
    }

    const refund=await client.query(
      "INSERT INTO refunds(payment_intent_id,public_id,amount,currency_code,reason,status,provider_status) VALUES($1,$2,$3,'PHP','QA-only Delivery refund economics fixture','succeeded','succeeded') RETURNING id",
      [intentId,'qa-refund-v2d-r-'+marker+'-'+suffix,refundAmount]
    );
    return{
      intentId,
      refundId:Number(refund.rows[0].id),
      courierAllocationId,
      platformAllocationId
    };
  };

  try{
    await client.query('BEGIN');
    const beforeMoney=await courierMoneyHomeSnapshot(client,courier.accountId);

    const full=await createIntent({suffix:1,refundAmount:100,courierStatus:'eligible',platformStatus:'held'});
    const fullResult=await reconcileDeliveryRefundEconomics(client,{
      paymentIntentId:full.intentId,refundId:full.refundId,providerCode:'qa_internal'
    });
    if(
      fullResult.status!=='RECONCILED'||
      fullResult.full_intent_refund!==true||
      fullResult.reversed_allocation_ids.length!==2||
      fullResult.manual_review_allocation_ids.length!==0
    ) throw new Error('Delivery refund V2D full-refund reversal contract failed.');

    const replay=await reconcileDeliveryRefundEconomics(client,{
      paymentIntentId:full.intentId,refundId:full.refundId,providerCode:'qa_internal'
    });
    if(replay.status!=='NO_CHANGE')throw new Error('Delivery refund V2D reconciliation is not idempotent.');

    const partial=await createIntent({suffix:2,refundAmount:25,courierStatus:'eligible',platformStatus:'pending'});
    const partialResult=await reconcileDeliveryRefundEconomics(client,{
      paymentIntentId:partial.intentId,refundId:partial.refundId,providerCode:'qa_internal'
    });
    if(
      partialResult.status!=='RECONCILED'||
      partialResult.full_intent_refund!==false||
      partialResult.reversed_allocation_ids.length!==0||
      partialResult.manual_review_allocation_ids.length!==2
    ) throw new Error('Delivery refund V2D partial-refund manual-review contract failed.');

    const partialMoney=await courierMoneyHomeSnapshot(client,courier.accountId);
    const beforeEarnings=beforeMoney.summary?.earnings||{};
    const partialEarnings=partialMoney.summary?.earnings||{};
    if(
      !close(num(partialEarnings.manual_review)-num(beforeEarnings.manual_review),90)||
      !close(num(partialEarnings.eligible)-num(beforeEarnings.eligible),0)
    ) throw new Error('Courier Money did not isolate refund-review compensation.');

    const gross=await client.query(
      "SELECT COALESCE(SUM(amount) FILTER(WHERE settlement_status NOT IN ('reversed','manual_review')),0)::numeric gross_compensation, COALESCE(SUM(amount) FILTER(WHERE settlement_status='eligible'),0)::numeric eligible_amount, COALESCE(SUM(amount) FILTER(WHERE settlement_status='manual_review'),0)::numeric manual_review_amount FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='courier_net'",
      [partial.intentId]
    );
    const grossRow=gross.rows[0]||{};
    if(
      !close(grossRow.gross_compensation,0)||
      !close(grossRow.eligible_amount,0)||
      !close(grossRow.manual_review_amount,90)
    ) throw new Error('Refund-review Courier allocation leaked into gross or payout-eligible compensation.');

    const extraRefund=await client.query(
      "INSERT INTO refunds(payment_intent_id,public_id,amount,currency_code,reason,status,provider_status) VALUES($1,$2,75,'PHP','QA-only cumulative full refund fixture','succeeded','succeeded') RETURNING id",
      [partial.intentId,'qa-refund-v2d-r-'+marker+'-2b']
    );
    const cumulative=await reconcileDeliveryRefundEconomics(client,{
      paymentIntentId:partial.intentId,refundId:Number(extraRefund.rows[0].id),providerCode:'qa_internal'
    });
    if(
      cumulative.full_intent_refund!==true||
      cumulative.reversed_allocation_ids.length!==2||
      cumulative.manual_review_allocation_ids.length!==0
    ) throw new Error('Cumulative full refund did not reverse unsettled review allocations.');

    const settled=await createIntent({
      suffix:3,refundAmount:100,courierStatus:'paid',platformStatus:'eligible',settlementLinked:true
    });
    const settledResult=await reconcileDeliveryRefundEconomics(client,{
      paymentIntentId:settled.intentId,refundId:settled.refundId,providerCode:'qa_internal'
    });
    if(
      settledResult.full_intent_refund!==true||
      settledResult.reversed_allocation_ids.length!==0||
      settledResult.manual_review_allocation_ids.length!==2
    ) throw new Error('Paid/settlement-linked Delivery economics were falsely reversed.');

    const settledStatuses=await client.query(
      "SELECT id,settlement_status FROM payment_allocations WHERE id=ANY($1::bigint[]) ORDER BY id",
      [[settled.courierAllocationId,settled.platformAllocationId]]
    );
    if(settledStatuses.rows.some(row=>row.settlement_status!=='manual_review')){
      throw new Error('Paid/settlement-linked allocations did not remain under manual review.');
    }

    const audit=await client.query(
      "SELECT COUNT(*)::int count FROM payment_audit_events WHERE payment_intent_id=ANY($1::bigint[]) AND event_code='delivery_refund_economics_reconciled'",
      [[full.intentId,partial.intentId,settled.intentId]]
    );
    if(Number(audit.rows[0]?.count||0)<4){
      throw new Error('Delivery refund economics reconciliation audit evidence is incomplete.');
    }

    evidence={
      full_refund_reversed:true,
      partial_refund_manual_review:true,
      cumulative_full_refund_reversed:true,
      paid_or_settlement_linked_manual_review:true,
      courier_manual_review_delta:90,
      courier_review_gross_compensation:0,
      courier_review_payout_eligible:0,
      idempotent_replay:true,
      reconciliation_audit_events:Number(audit.rows[0]?.count||0),
      external_provider_calls:0,
      real_provider_refund_invoked:false,
      fixture_transaction:'rolled_back'
    };
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }

  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token:courier.token,body:{}});
  expectStatus(logout,200,'Delivery Refund Economics V2D Courier logout');
  return{
    status:'PASS',
    wave:'delivery_refund_economics_v2d_runtime',
    ...evidence,
    runtime_listener:8080,
    logout:true
  };
}
