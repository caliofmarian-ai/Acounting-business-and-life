import {resolveAcceptedServiceJobPayable} from './local-services-pricing-core.js';
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const n=v=>Number(v||0);

function allocationSummary(row={}){
  const count=n(row.allocation_count);
  return{
    tracked:count>0,
    allocation_count:count,
    pending:money(row.pending_amount),
    eligible:money(row.eligible_amount),
    held:money(row.held_amount),
    processing:money(row.processing_amount),
    paid:money(row.paid_amount),
    failed:money(row.failed_amount),
    manual_review:money(row.manual_review_amount),
    reversed:money(row.reversed_amount)
  };
}

async function netAllocations(pool,componentCode,economicPartyId){
  const {rows}=await pool.query(`
    SELECT
      COUNT(*)::int allocation_count,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='pending'),0) pending_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='eligible'),0) eligible_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='held'),0) held_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='processing'),0) processing_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='paid'),0) paid_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='failed'),0) failed_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='manual_review'),0) manual_review_amount,
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='reversed'),0) reversed_amount
    FROM payment_allocations
    WHERE component_code=$1 AND economic_party_id=$2
  `,[componentCode,String(economicPartyId)]);
  return allocationSummary(rows[0]);
}

async function customerMoneyHomeSummary(pool,accountId){
  const {rows}=await pool.query(`
    SELECT
      (
        SELECT COUNT(*) FILTER(WHERE order_status<>'cancelled')::int
        FROM orders WHERE customer_account_id=$1
      ) AS order_count,
      (
        SELECT COALESCE(SUM(total) FILTER(WHERE order_status<>'cancelled'),0)
        FROM orders WHERE customer_account_id=$1
      ) AS purchase_value,
      (
        SELECT COALESCE(SUM(outstanding_amount) FILTER(WHERE order_status<>'cancelled'),0)
        FROM orders WHERE customer_account_id=$1
      ) AS outstanding_amount,
      (
        SELECT COALESCE(SUM(amount) FILTER(WHERE status='succeeded'),0)
        FROM payment_intents WHERE payer_account_id=$1
      ) AS succeeded_amount,
      (
        SELECT COALESCE(SUM(amount) FILTER(WHERE status IN ('requires_provider','requires_action','processing')),0)
        FROM payment_intents WHERE payer_account_id=$1
      ) AS pending_amount,
      (
        SELECT COUNT(*) FILTER(WHERE status='failed')::int
        FROM payment_intents WHERE payer_account_id=$1
      ) AS failed_count,
      (
        SELECT COALESCE(SUM(r.amount) FILTER(WHERE r.status='succeeded'),0)
        FROM refunds r
        JOIN payment_intents pi ON pi.id=r.payment_intent_id
        WHERE pi.payer_account_id=$1
      ) AS refunded_amount,
      (
        SELECT COALESCE(SUM(r.amount) FILTER(WHERE r.status IN ('requested','processing','manual_review')),0)
        FROM refunds r
        JOIN payment_intents pi ON pi.id=r.payment_intent_id
        WHERE pi.payer_account_id=$1
      ) AS pending_refund_amount
  `,[Number(accountId)]);
  const x=rows[0]||{};
  return{
    role:'customer',currency_code:'PHP',
    summary:{
      order_count:n(x.order_count),purchase_value:money(x.purchase_value),
      confirmed_payments:money(x.succeeded_amount),
      outstanding_purchases:money(x.outstanding_amount),
      refunded:money(x.refunded_amount),
      pending_payments:money(x.pending_amount),
      pending_refunds:money(x.pending_refund_amount),
      failed_payment_count:n(x.failed_count)
    },
    authority:{
      confirmed_payments:'payment_intents.status=succeeded',
      outstanding:'orders.outstanding_amount',
      refunds:'refunds.status=succeeded',
      note:'This is personal purchase/payment flow. It is not business profit accounting.'
    }
  };
}

export async function customerMoneyHomeSnapshot(pool,accountId){
  return customerMoneyHomeSummary(pool,accountId);
}

export async function customerMoneySnapshot(pool,accountId){
  const [home,recentOrders,recentPayments]=await Promise.all([
    customerMoneyHomeSummary(pool,accountId),
    pool.query(`
      SELECT o.id,o.order_number,o.business_id,b.name business_name,o.total,o.paid_amount,o.outstanding_amount,
             o.payment_method,o.payment_status,o.order_status,o.currency_code,o.created_at
      FROM orders o JOIN businesses b ON b.id=o.business_id
      WHERE o.customer_account_id=$1
      ORDER BY o.created_at DESC LIMIT 30
    `,[Number(accountId)]),
    pool.query(`
      SELECT id,public_id,source_type,source_id,provider_code,logical_method,currency_code,amount,status,provider_status,created_at,updated_at
      FROM payment_intents WHERE payer_account_id=$1
      ORDER BY created_at DESC LIMIT 30
    `,[Number(accountId)])
  ]);
  return{...home,recent_orders:recentOrders.rows,recent_payments:recentPayments.rows};
}

async function courierMoneyHomeSummary(pool,accountId){
  const [deliveries,allocations]=await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE status='delivered')::int delivered_count,
        COUNT(*) FILTER(WHERE status NOT IN ('delivered','failed','cancelled','quoted'))::int active_count,
        COALESCE(SUM(delivery_fee) FILTER(WHERE status='delivered'),0) delivered_fee_context
      FROM deliveries WHERE courier_account_id=$1
    `,[Number(accountId)]),
    netAllocations(pool,'courier_net',accountId)
  ]);
  const d=deliveries.rows[0]||{};
  return{
    role:'courier',currency_code:'PHP',
    summary:{
      delivered_count:n(d.delivered_count),active_count:n(d.active_count),
      customer_delivery_fees_context:money(d.delivered_fee_context),
      earnings:allocations
    },
    authority:{
      earnings_tracking:allocations.tracked?'payment_allocations.courier_net':'not_configured',
      delivery_fee_rule:'A delivery fee is the customer/order delivery charge. It is not automatically Courier earnings.',
      note:allocations.tracked
        ?'Only recorded courier_net allocations are treated as Courier earnings.'
        :'Courier compensation allocation is not configured yet. No earnings amount is invented from delivery fees.'
    }
  };
}

export async function courierMoneyHomeSnapshot(pool,accountId){
  return courierMoneyHomeSummary(pool,accountId);
}

export async function courierMoneySnapshot(pool,accountId){
  const [home,recent]=await Promise.all([
    courierMoneyHomeSummary(pool,accountId),
    pool.query(`
      SELECT d.id,d.order_id,o.order_number,d.status,d.delivery_fee,d.service_fare,d.platform_fee_basis_amount,
             d.pass_through_amount,d.currency_code,d.route_distance_km,d.assigned_at,d.delivered_at,d.created_at,
             b.name business_name,
             COALESCE(c.courier_compensation,0)::numeric courier_compensation,
             COALESCE(c.paid,0)::numeric courier_paid,
             COALESCE(c.eligible,0)::numeric courier_eligible,
             COALESCE(c.pending,0)::numeric courier_pending,
             COALESCE(c.processing,0)::numeric courier_processing,
             COALESCE(c.held,0)::numeric courier_held,
             COALESCE(c.failed,0)::numeric courier_failed,
             COALESCE(c.manual_review,0)::numeric courier_manual_review,
             COALESCE(c.allocation_count,0)::int courier_allocation_count
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status NOT IN ('reversed','manual_review')),0) courier_compensation,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='paid'),0) paid,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='eligible'),0) eligible,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='pending'),0) pending,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='processing'),0) processing,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='held'),0) held,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='failed'),0) failed,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='manual_review'),0) manual_review,
          COUNT(*) FILTER(WHERE pa.settlement_status<>'reversed')::int allocation_count
        FROM payment_allocations pa
        JOIN payment_intents pi ON pi.id=pa.payment_intent_id
        WHERE pi.source_type='order'
          AND pi.source_id=d.order_id
          AND pa.component_code='courier_net'
          AND pa.economic_party_id=$2
          AND pa.rule_snapshot->>'delivery_id'=d.id::text
      ) c ON TRUE
      WHERE d.courier_account_id=$1
      ORDER BY d.created_at DESC LIMIT 40
    `,[Number(accountId),String(accountId)])
  ]);
  return{...home,recent_deliveries:recent.rows};
}


function serviceProviderPaymentEvidence(rows){
  // Customer payment evidence is not Service Provider settlement or payout.
  const confirmed=rows.filter(row=>row.confirmed).map(row=>row.job);
  return{
    paid_job_count:confirmed.filter(row=>row.payment_received>0).length,
    receivable_job_count:confirmed.filter(row=>row.outstanding_receivable>0).length,
    confirmed_customer_payments:money(confirmed.reduce((sum,row)=>sum+row.payment_received,0)),
    pending_customer_payments:money(confirmed.reduce((sum,row)=>sum+row.payment_pending,0)),
    refunded_customer_payments:money(confirmed.reduce((sum,row)=>sum+row.payment_refunded,0)),
    outstanding_receivables:money(confirmed.reduce((sum,row)=>sum+row.outstanding_receivable,0)),
    authority:'payment_intents + succeeded refunds'
  };
}

async function verifiedServiceProviderMoneyRows(pool,accountId){
  // One PostgreSQL statement reads quote and payment evidence from the same
  // database snapshot. No payable amount comes from unchecked SQL arithmetic.
  const {rows}=await pool.query(`
    WITH recent_ids AS (
      SELECT id FROM service_jobs
      WHERE provider_account_id=$1
      ORDER BY created_at DESC,id DESC LIMIT 40
    ),
    jobs AS (
      SELECT j.id,j.service_label,j.status,j.quote_amount,j.final_price,
        j.accepted_quote_id,j.agreed_total,j.legacy_final_adjustment,
        j.pricing_locked_at,j.currency_code,j.scheduled_at,j.provider_completed_at,
        j.customer_confirmed_at,j.created_at,
        (recent_ids.id IS NOT NULL) AS is_recent,
        q.id accepted_quote_ref_id,q.job_id accepted_quote_job_id,
        q.status accepted_quote_status,q.total_amount accepted_quote_total,
        q.currency_code accepted_quote_currency,q.legacy_record accepted_quote_legacy
      FROM service_jobs j
      LEFT JOIN recent_ids ON recent_ids.id=j.id
      LEFT JOIN service_job_quotes q ON q.id=j.accepted_quote_id
      WHERE j.provider_account_id=$1
        AND (
          recent_ids.id IS NOT NULL
          OR (j.status='completed' AND j.customer_confirmed_at IS NOT NULL)
          OR j.status IN ('quoted','accepted','scheduled','in_progress')
        )
    ),
    confirmed AS (
      SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric gross_confirmed
      FROM payment_intents pi
      JOIN jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job'
        AND pi.status IN ('succeeded','partially_refunded','refunded')
      GROUP BY pi.source_id
    ),
    pending AS (
      SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric pending_amount
      FROM payment_intents pi
      JOIN jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job'
        AND pi.status IN ('requires_provider','requires_action','processing')
        AND (pi.expires_at IS NULL OR pi.expires_at>NOW())
      GROUP BY pi.source_id
    ),
    refunded AS (
      SELECT pi.source_id job_id,COALESCE(SUM(r.amount),0)::numeric refunded_amount
      FROM refunds r
      JOIN payment_intents pi ON pi.id=r.payment_intent_id
      JOIN jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job' AND r.status='succeeded'
      GROUP BY pi.source_id
    )
    SELECT j.*,
      GREATEST(COALESCE(c.gross_confirmed,0)-COALESCE(f.refunded_amount,0),0)::numeric payment_received,
      COALESCE(p.pending_amount,0)::numeric payment_pending,
      COALESCE(f.refunded_amount,0)::numeric payment_refunded
    FROM jobs j
    LEFT JOIN confirmed c ON c.job_id=j.id
    LEFT JOIN pending p ON p.job_id=j.id
    LEFT JOIN refunded f ON f.job_id=j.id
    ORDER BY j.created_at DESC,j.id DESC
  `,[Number(accountId)]);
  // Validate ALL selected rows before returning a partial summary or detail.
  return rows.map(row=>{
    const acceptedQuote=row.accepted_quote_ref_id==null?null:{
      id:row.accepted_quote_ref_id,job_id:row.accepted_quote_job_id,
      status:row.accepted_quote_status,total_amount:row.accepted_quote_total,
      currency_code:row.accepted_quote_currency,legacy_record:row.accepted_quote_legacy
    };
    const payable=resolveAcceptedServiceJobPayable(row,acceptedQuote);
    const confirmed=row.status==='completed'&&row.customer_confirmed_at!=null;
    const paid=money(row.payment_received);
    const job={
      id:row.id,service_label:row.service_label,status:row.status,
      quote_amount:row.quote_amount,final_price:row.final_price,
      accepted_quote_id:row.accepted_quote_id,agreed_total:row.agreed_total,
      legacy_final_adjustment:row.legacy_final_adjustment,
      currency_code:row.currency_code,scheduled_at:row.scheduled_at,
      provider_completed_at:row.provider_completed_at,
      customer_confirmed_at:row.customer_confirmed_at,created_at:row.created_at,
      payable_value:payable.payable_value,
      payment_received:paid,
      payment_pending:money(row.payment_pending),
      payment_refunded:money(row.payment_refunded),
      outstanding_receivable:confirmed?money(Math.max(payable.payable_value-paid,0)):0
    };
    return{
      job,confirmed,recent:row.is_recent===true,
      open:['quoted','accepted','scheduled','in_progress'].includes(row.status)
    };
  });
}

async function serviceProviderMoneyHomeSummary(pool,accountId,verifiedRows=null){
  const [rows,allocations]=await Promise.all([
    verifiedRows==null?verifiedServiceProviderMoneyRows(pool,accountId):Promise.resolve(verifiedRows),
    netAllocations(pool,'service_provider_net',accountId)
  ]);
  const confirmed=rows.filter(row=>row.confirmed);
  const open=rows.filter(row=>row.open);
  return{
    role:'service_provider',currency_code:'PHP',
    summary:{
      confirmed_completed_count:confirmed.length,
      confirmed_job_value:money(confirmed.reduce((sum,row)=>sum+row.job.payable_value,0)),
      open_commercial_jobs:open.length,
      open_commercial_value:money(open.reduce((sum,row)=>sum+row.job.payable_value,0)),
      payments:serviceProviderPaymentEvidence(rows),
      income:allocations
    },
    authority:{
      payment_tracking:'payment_intents + succeeded refunds',
      settlement_tracking:allocations.tracked?'payment_allocations.service_provider_net':'not_configured',
      income_tracking:allocations.tracked?'payment_allocations.service_provider_net':'not_configured',
      commercial_value_rule:'Completed job value is a commercial amount, not proof that money was received.',
      payment_rule:'Customer payment evidence is verified Payment Intent success minus succeeded refunds.',
      settlement_rule:'Customer payment success and Service Provider payout/settlement are separate facts.',
      note:allocations.tracked
        ?'Customer payments are shown separately from service_provider_net settlement allocations.'
        :'Customer payments and receivables are tracked. Service Provider payout settlement remains NOT_CONFIGURED until service_provider_net allocations exist.'
    }
  };
}

export async function serviceProviderMoneyHomeSnapshot(pool,accountId){
  return serviceProviderMoneyHomeSummary(pool,accountId);
}

export async function serviceProviderMoneySnapshot(pool,accountId){
  const rows=await verifiedServiceProviderMoneyRows(pool,accountId);
  const home=await serviceProviderMoneyHomeSummary(pool,accountId,rows);
  return{...home,recent_jobs:rows.filter(row=>row.recent).map(row=>row.job)};
}

export async function profileMoneySnapshot(pool,role,accountId){
  if(role==='customer')return customerMoneySnapshot(pool,accountId);
  if(role==='courier')return courierMoneySnapshot(pool,accountId);
  if(role==='service_provider')return serviceProviderMoneySnapshot(pool,accountId);
  throw Object.assign(new Error('This profile uses business accounting or does not have a personal Money workspace'),{status:400});
}
