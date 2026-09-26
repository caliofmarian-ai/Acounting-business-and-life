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
             COALESCE(c.allocation_count,0)::int courier_allocation_count
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status<>'reversed'),0) courier_compensation,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='paid'),0) paid,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='eligible'),0) eligible,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='pending'),0) pending,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='processing'),0) processing,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='held'),0) held,
          COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='failed'),0) failed,
          COUNT(*) FILTER(WHERE pa.settlement_status<>'reversed')::int allocation_count
        FROM payment_allocations pa
        JOIN payment_intents pi ON pi.id=pa.payment_intent_id
        WHERE pi.source_type='order'
          AND pi.source_id=d.order_id
          AND pa.component_code='courier_net'
          AND pa.economic_party_id=$1::text
          AND pa.rule_snapshot->>'delivery_id'=d.id::text
      ) c ON TRUE
      WHERE d.courier_account_id=$1
      ORDER BY d.created_at DESC LIMIT 40
    `,[Number(accountId)])
  ]);
  return{...home,recent_deliveries:recent.rows};
}

async function serviceProviderPaymentEvidence(pool,accountId){
  const {rows}=await pool.query(`
    WITH completed_jobs AS (
      SELECT id,COALESCE(final_price,quote_amount,0)::numeric payable
      FROM service_jobs
      WHERE provider_account_id=$1
        AND status='completed'
        AND customer_confirmed_at IS NOT NULL
    ),
    confirmed AS (
      SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric gross_confirmed
      FROM payment_intents pi
      JOIN completed_jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job'
        AND pi.status IN ('succeeded','partially_refunded','refunded')
      GROUP BY pi.source_id
    ),
    pending AS (
      SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric pending_amount
      FROM payment_intents pi
      JOIN completed_jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job'
        AND pi.status IN ('requires_provider','requires_action','processing')
        AND (pi.expires_at IS NULL OR pi.expires_at>NOW())
      GROUP BY pi.source_id
    ),
    refunded AS (
      SELECT pi.source_id job_id,COALESCE(SUM(r.amount),0)::numeric refunded_amount
      FROM refunds r
      JOIN payment_intents pi ON pi.id=r.payment_intent_id
      JOIN completed_jobs j ON j.id=pi.source_id
      WHERE pi.source_type='service_job' AND r.status='succeeded'
      GROUP BY pi.source_id
    ),
    per_job AS (
      SELECT j.id,j.payable,
        GREATEST(COALESCE(c.gross_confirmed,0)-COALESCE(r.refunded_amount,0),0)::numeric effective_paid,
        COALESCE(p.pending_amount,0)::numeric pending_amount,
        COALESCE(r.refunded_amount,0)::numeric refunded_amount
      FROM completed_jobs j
      LEFT JOIN confirmed c ON c.job_id=j.id
      LEFT JOIN pending p ON p.job_id=j.id
      LEFT JOIN refunded r ON r.job_id=j.id
    )
    SELECT
      COUNT(*) FILTER(WHERE effective_paid>0)::int paid_job_count,
      COUNT(*) FILTER(WHERE GREATEST(payable-effective_paid,0)>0)::int receivable_job_count,
      COALESCE(SUM(effective_paid),0)::numeric confirmed_customer_payments,
      COALESCE(SUM(pending_amount),0)::numeric pending_customer_payments,
      COALESCE(SUM(refunded_amount),0)::numeric refunded_customer_payments,
      COALESCE(SUM(GREATEST(payable-effective_paid,0)),0)::numeric outstanding_receivables
    FROM per_job
  `,[Number(accountId)]);
  const row=rows[0]||{};
  return{
    paid_job_count:n(row.paid_job_count),
    receivable_job_count:n(row.receivable_job_count),
    confirmed_customer_payments:money(row.confirmed_customer_payments),
    pending_customer_payments:money(row.pending_customer_payments),
    refunded_customer_payments:money(row.refunded_customer_payments),
    outstanding_receivables:money(row.outstanding_receivables),
    authority:'payment_intents + succeeded refunds'
  };
}

async function serviceProviderMoneyHomeSummary(pool,accountId){
  const [jobs,payments,allocations]=await Promise.all([
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
    serviceProviderPaymentEvidence(pool,accountId),
    netAllocations(pool,'service_provider_net',accountId)
  ]);
  const j=jobs.rows[0]||{};
  return{
    role:'service_provider',currency_code:'PHP',
    summary:{
      confirmed_completed_count:n(j.confirmed_completed_count),
      confirmed_job_value:money(j.confirmed_job_value),
      open_commercial_jobs:n(j.open_commercial_jobs),
      open_commercial_value:money(j.open_commercial_value),
      payments,
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
  const [home,recent]=await Promise.all([
    serviceProviderMoneyHomeSummary(pool,accountId),
    pool.query(`
      WITH recent AS (
        SELECT id,service_label,status,quote_amount,final_price,currency_code,scheduled_at,
               provider_completed_at,customer_confirmed_at,created_at
        FROM service_jobs
        WHERE provider_account_id=$1
        ORDER BY created_at DESC LIMIT 40
      ),
      confirmed AS (
        SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric gross_confirmed
        FROM payment_intents pi
        JOIN recent j ON j.id=pi.source_id
        WHERE pi.source_type='service_job'
          AND pi.status IN ('succeeded','partially_refunded','refunded')
        GROUP BY pi.source_id
      ),
      pending AS (
        SELECT pi.source_id job_id,COALESCE(SUM(pi.amount),0)::numeric pending_amount
        FROM payment_intents pi
        JOIN recent j ON j.id=pi.source_id
        WHERE pi.source_type='service_job'
          AND pi.status IN ('requires_provider','requires_action','processing')
          AND (pi.expires_at IS NULL OR pi.expires_at>NOW())
        GROUP BY pi.source_id
      ),
      refunded AS (
        SELECT pi.source_id job_id,COALESCE(SUM(r.amount),0)::numeric refunded_amount
        FROM refunds r
        JOIN payment_intents pi ON pi.id=r.payment_intent_id
        JOIN recent j ON j.id=pi.source_id
        WHERE pi.source_type='service_job' AND r.status='succeeded'
        GROUP BY pi.source_id
      )
      SELECT r.*,
        GREATEST(COALESCE(c.gross_confirmed,0)-COALESCE(f.refunded_amount,0),0)::numeric payment_received,
        COALESCE(p.pending_amount,0)::numeric payment_pending,
        COALESCE(f.refunded_amount,0)::numeric payment_refunded,
        CASE WHEN r.status='completed' AND r.customer_confirmed_at IS NOT NULL
          THEN GREATEST(COALESCE(r.final_price,r.quote_amount,0)
            - GREATEST(COALESCE(c.gross_confirmed,0)-COALESCE(f.refunded_amount,0),0),0)
          ELSE 0 END::numeric outstanding_receivable
      FROM recent r
      LEFT JOIN confirmed c ON c.job_id=r.id
      LEFT JOIN pending p ON p.job_id=r.id
      LEFT JOIN refunded f ON f.job_id=r.id
      ORDER BY r.created_at DESC
    `,[Number(accountId)])
  ]);
  return{...home,recent_jobs:recent.rows};
}

export async function profileMoneySnapshot(pool,role,accountId){
  if(role==='customer')return customerMoneySnapshot(pool,accountId);
  if(role==='courier')return courierMoneySnapshot(pool,accountId);
  if(role==='service_provider')return serviceProviderMoneySnapshot(pool,accountId);
  throw Object.assign(new Error('This profile uses business accounting or does not have a personal Money workspace'),{status:400});
}
