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
      COALESCE(SUM(amount) FILTER(WHERE settlement_status='reversed'),0) reversed_amount
    FROM payment_allocations
    WHERE component_code=$1 AND economic_party_id=$2
  `,[componentCode,String(economicPartyId)]);
  return allocationSummary(rows[0]);
}

export async function customerMoneySnapshot(pool,accountId){
  const [orders,payments,refunds,recentOrders,recentPayments]=await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE order_status<>'cancelled')::int order_count,
        COALESCE(SUM(total) FILTER(WHERE order_status<>'cancelled'),0) purchase_value,
        COALESCE(SUM(outstanding_amount) FILTER(WHERE order_status<>'cancelled'),0) outstanding_amount,
        COALESCE(SUM(paid_amount) FILTER(WHERE order_status<>'cancelled'),0) order_paid_recorded
      FROM orders WHERE customer_account_id=$1
    `,[Number(accountId)]),
    pool.query(`
      SELECT
        COUNT(*)::int payment_intent_count,
        COALESCE(SUM(amount) FILTER(WHERE status='succeeded'),0) succeeded_amount,
        COALESCE(SUM(amount) FILTER(WHERE status IN ('requires_provider','requires_action','processing')),0) pending_amount,
        COUNT(*) FILTER(WHERE status='failed')::int failed_count
      FROM payment_intents WHERE payer_account_id=$1
    `,[Number(accountId)]),
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE r.status='succeeded')::int refund_count,
        COALESCE(SUM(r.amount) FILTER(WHERE r.status='succeeded'),0) refunded_amount,
        COALESCE(SUM(r.amount) FILTER(WHERE r.status IN ('requested','processing','manual_review')),0) pending_refund_amount
      FROM refunds r
      JOIN payment_intents pi ON pi.id=r.payment_intent_id
      WHERE pi.payer_account_id=$1
    `,[Number(accountId)]),
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
  const o=orders.rows[0]||{},p=payments.rows[0]||{},r=refunds.rows[0]||{};
  return{
    role:'customer',currency_code:'PHP',
    summary:{
      order_count:n(o.order_count),purchase_value:money(o.purchase_value),
      confirmed_payments:money(p.succeeded_amount),
      outstanding_purchases:money(o.outstanding_amount),
      refunded:money(r.refunded_amount),
      pending_payments:money(p.pending_amount),
      pending_refunds:money(r.pending_refund_amount),
      failed_payment_count:n(p.failed_count)
    },
    authority:{
      confirmed_payments:'payment_intents.status=succeeded',
      outstanding:'orders.outstanding_amount',
      refunds:'refunds.status=succeeded',
      note:'This is personal purchase/payment flow. It is not business profit accounting.'
    },
    recent_orders:recentOrders.rows,
    recent_payments:recentPayments.rows
  };
}

export async function courierMoneySnapshot(pool,accountId){
  const [deliveries,allocations,recent]=await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE status='delivered')::int delivered_count,
        COUNT(*) FILTER(WHERE status NOT IN ('delivered','failed','cancelled','quoted'))::int active_count,
        COALESCE(SUM(delivery_fee) FILTER(WHERE status='delivered'),0) delivered_fee_context
      FROM deliveries WHERE courier_account_id=$1
    `,[Number(accountId)]),
    netAllocations(pool,'courier_net',accountId),
    pool.query(`
      SELECT d.id,d.order_id,o.order_number,d.status,d.delivery_fee,d.currency_code,d.route_distance_km,
             d.assigned_at,d.delivered_at,d.created_at,b.name business_name
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
      WHERE d.courier_account_id=$1
      ORDER BY d.created_at DESC LIMIT 40
    `,[Number(accountId)])
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
    },
    recent_deliveries:recent.rows
  };
}

export async function serviceProviderMoneySnapshot(pool,accountId){
  const [jobs,allocations,recent]=await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE status='completed' AND customer_confirmed_at IS NOT NULL)::int confirmed_completed_count,
        COALESCE(SUM(COALESCE(final_price,quote_amount,0))
          FILTER(WHERE status='completed' AND customer_confirmed_at IS NOT NULL),0) confirmed_job_value,
        COUNT(*) FILTER(WHERE status IN ('quoted','accepted','scheduled','in_progress'))::int open_commercial_jobs,
        COALESCE(SUM(COALESCE(final_price,quote_amount,0))
          FILTER(WHERE status IN ('quoted','accepted','scheduled','in_progress')),0) open_commercial_value
      FROM service_jobs WHERE provider_account_id=$1
    `,[Number(accountId)]),
    netAllocations(pool,'service_provider_net',accountId),
    pool.query(`
      SELECT id,service_label,status,quote_amount,final_price,currency_code,scheduled_at,
             provider_completed_at,customer_confirmed_at,created_at
      FROM service_jobs WHERE provider_account_id=$1
      ORDER BY created_at DESC LIMIT 40
    `,[Number(accountId)])
  ]);
  const j=jobs.rows[0]||{};
  return{
    role:'service_provider',currency_code:'PHP',
    summary:{
      confirmed_completed_count:n(j.confirmed_completed_count),
      confirmed_job_value:money(j.confirmed_job_value),
      open_commercial_jobs:n(j.open_commercial_jobs),
      open_commercial_value:money(j.open_commercial_value),
      income:allocations
    },
    authority:{
      income_tracking:allocations.tracked?'payment_allocations.service_provider_net':'not_configured',
      commercial_value_rule:'Completed job value is a commercial amount, not proof that money was received.',
      note:allocations.tracked
        ?'Only recorded service_provider_net allocations are treated as settled/provider income.'
        :'Local Services payment settlement is not configured yet. Completed job value is shown separately from money received.'
    },
    recent_jobs:recent.rows
  };
}

export async function profileMoneySnapshot(pool,role,accountId){
  if(role==='customer')return customerMoneySnapshot(pool,accountId);
  if(role==='courier')return courierMoneySnapshot(pool,accountId);
  if(role==='service_provider')return serviceProviderMoneySnapshot(pool,accountId);
  throw Object.assign(new Error('This profile uses business accounting or does not have a personal Money workspace'),{status:400});
}
