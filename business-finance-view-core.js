const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const n=v=>Number(v||0);

async function optionalQuery(pool,sql,args=[],fallbackRows=[]){
  try{return await pool.query(sql,args)}
  catch(e){
    if(['42P01','42703'].includes(e.code))return{rows:fallbackRows,rowCount:fallbackRows.length,optional_missing:true};
    throw e;
  }
}
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
    reversed:money(row.reversed_amount),
    status:count>0?'TRACKED':'NOT_CONFIGURED'
  };
}
async function allocationStatus(pool,{componentCode,economicPartyId,businessId=null}){
  const args=[componentCode,String(economicPartyId)];
  let extra='';
  if(businessId!=null){args.push(Number(businessId));extra=' AND pi.business_id=$3'}
  const q=await optionalQuery(pool,`
    SELECT COUNT(*)::int allocation_count,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='pending'),0) pending_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='eligible'),0) eligible_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='held'),0) held_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='processing'),0) processing_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='paid'),0) paid_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='failed'),0) failed_amount,
      COALESCE(SUM(pa.amount) FILTER(WHERE pa.settlement_status='reversed'),0) reversed_amount
    FROM payment_allocations pa
    JOIN payment_intents pi ON pi.id=pa.payment_intent_id
    WHERE pa.component_code=$1 AND pa.economic_party_id=$2${extra}
  `,args,[{}]);
  return allocationSummary(q.rows[0]);
}
async function chargedFeeSummary(pool,{businessId=null,supplierAccountId=null,chargedTo}){
  const args=[chargedTo];
  let owner='',supplierJoin='';
  if(businessId!=null){args.push(Number(businessId));owner=' AND pi.business_id=$2'}
  else if(supplierAccountId!=null){args.push(Number(supplierAccountId));supplierJoin=" JOIN purchase_orders po ON pi.source_type='purchase_order' AND po.id=pi.source_id";owner=' AND po.supplier_account_id=$2'}
  const q=await optionalQuery(pool,`
    SELECT COUNT(DISTINCT pa.id)::int fee_count,COALESCE(SUM(pa.amount),0) total
    FROM payment_allocations pa
    JOIN payment_intents pi ON pi.id=pa.payment_intent_id${supplierJoin}
    JOIN fee_policy_rules r
      ON r.fee_policy_version_id=pa.fee_policy_version_id
     AND r.component_code=pa.component_code
    WHERE r.charged_to=$1
      AND pa.component_code IN ('platform_fee','country_operator_fee','territory_operator_fee')
      AND pa.settlement_status<>'reversed'${owner}
  `,args,[{fee_count:0,total:0}]);
  return{
    tracked:n(q.rows[0]?.fee_count)>0,
    count:n(q.rows[0]?.fee_count),
    amount:money(q.rows[0]?.total),
    status:n(q.rows[0]?.fee_count)>0?'TRACKED':'NOT_CONFIGURED'
  };
}
async function ledgerMetrics(pool,businessId){
  const [totals,categories,inventory]=await Promise.all([
    pool.query(`
      SELECT
        COALESCE(SUM(amount) FILTER(WHERE type='sale'),0) recorded_sales,
        COALESCE(SUM(amount) FILTER(WHERE type='money_received'),0) other_money_received,
        COALESCE(SUM(amount) FILTER(WHERE type='business_expense'),0) business_expenses,
        COALESCE(SUM(amount) FILTER(WHERE type='personal_withdrawal'),0) owner_drawings,
        COALESCE(SUM(amount) FILTER(WHERE type='adjustment'),0) adjustments,
        COALESCE(SUM(amount) FILTER(WHERE type='profile_transfer_in'),0) profile_transfer_in,
        COALESCE(SUM(amount) FILTER(WHERE type='profile_transfer_out'),0) profile_transfer_out
      FROM transactions WHERE business_id=$1
    `,[businessId]),
    pool.query(`
      SELECT category,COUNT(*)::int entries,COALESCE(SUM(amount),0) amount
      FROM transactions
      WHERE business_id=$1 AND type='business_expense'
      GROUP BY category ORDER BY SUM(amount) DESC,category LIMIT 12
    `,[businessId]),
    pool.query(`
      SELECT COUNT(*)::int item_count,
        COALESCE(SUM(quantity*unit_cost),0) valuation,
        COUNT(*) FILTER(WHERE unit_cost>0)::int costed_items,
        COUNT(*) FILTER(WHERE quantity<=reorder_level)::int low_stock_items
      FROM inventory WHERE business_id=$1
    `,[businessId])
  ]);
  const t=totals.rows[0]||{},inv=inventory.rows[0]||{};
  return{
    ledger:{
      recorded_sales:money(t.recorded_sales),
      other_money_received:money(t.other_money_received),
      business_expenses:money(t.business_expenses),
      owner_drawings:money(t.owner_drawings),
      adjustments:money(t.adjustments),
      profile_transfer_in:money(t.profile_transfer_in),profile_transfer_out:money(t.profile_transfer_out),
      recorded_available_balance:money(Number(t.recorded_sales||0)+Number(t.other_money_received||0)+Number(t.adjustments||0)+Number(t.profile_transfer_in||0)-Number(t.business_expenses||0)-Number(t.owner_drawings||0)-Number(t.profile_transfer_out||0)),
      internal_transfer_rule:'Profile transfers change recorded balance but never business revenue, expense or profit.',
      owner_drawing_rule:'Owner drawing / withdrawal is separate from business operating expense.'
    },
    expense_categories:categories.rows.map(x=>({category:x.category,entries:n(x.entries),amount:money(x.amount)})),
    inventory:{
      item_count:n(inv.item_count),valuation:money(inv.valuation),costed_items:n(inv.costed_items),
      low_stock_items:n(inv.low_stock_items),
      valuation_status:n(inv.item_count)===0?'NO_INVENTORY':
        n(inv.costed_items)===n(inv.item_count)?'COST_EVIDENCE_COMPLETE':'PARTIAL_COST_EVIDENCE',
      authority:'accounting.inventory.quantity × unit_cost'
    }
  };
}
async function profileFinanceContext(pool,{accountId,role,businessId}){
  const accounts=await optionalQuery(pool,`
    SELECT id,public_id,profile_role,business_id,account_kind,provider_code,display_name,institution_name,
      account_name,reference_last4,currency_code,can_pay,can_receive,can_payout,verification_status,status
    FROM profile_financial_accounts
    WHERE account_id=$1 AND profile_role=$2 AND business_id=$3 AND status='active'
    ORDER BY created_at,id
  `,[accountId,role,businessId],[]);
  const budgets=await optionalQuery(pool,`
    SELECT e.id,e.public_id,e.label,e.purpose,e.currency_code,e.linked_financial_account_id,
      COALESCE(SUM(CASE WHEN be.direction='credit' THEN be.amount ELSE -be.amount END),0) allocated_budget
    FROM profile_budget_envelopes e
    LEFT JOIN profile_budget_entries be ON be.envelope_id=e.id
    WHERE e.account_id=$1 AND e.profile_role=$2 AND e.business_id=$3 AND e.status='active'
    GROUP BY e.id ORDER BY e.created_at,e.id
  `,[accountId,role,businessId],[]);
  const budgetRows=budgets.rows.map(x=>({
    id:Number(x.id),public_id:x.public_id,label:x.label,purpose:x.purpose,currency_code:x.currency_code,
    linked_financial_account_id:x.linked_financial_account_id==null?null:Number(x.linked_financial_account_id),
    allocated_budget:money(x.allocated_budget),
    balance_type:'planned_allocation',
    provider_cash_balance:null
  }));
  return{
    financial_accounts:accounts.rows.map(x=>({
      id:Number(x.id),public_id:x.public_id,account_kind:x.account_kind,provider_code:x.provider_code||'',
      display_name:x.display_name||'',institution_name:x.institution_name||'',account_name:x.account_name||'',
      reference_last4:x.reference_last4||'',currency_code:x.currency_code,
      can_pay:Boolean(x.can_pay),can_receive:Boolean(x.can_receive),can_payout:Boolean(x.can_payout),
      verification_status:x.verification_status,status:x.status
    })),
    budgets:budgetRows,
    total_allocated_budget:money(budgetRows.reduce((s,x)=>s+x.allocated_budget,0)),
    budget_balance_type:'planned_allocation',
    provider_balance_status:'NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE'
  };
}
async function merchantOverview(pool,ctx){
  const bid=Number(ctx.business.id);
  const [store,orders,profitability,refunds,ledger,financeContext,merchandiseAlloc,merchantNet,fees]=await Promise.all([
    optionalQuery(pool,`
      SELECT merchant_domain,publication_status,store_name
      FROM merchant_storefronts WHERE business_id=$1
    `,[bid],[]),
    pool.query(`
      WITH x AS (
        SELECT o.id,o.order_status,o.subtotal,
          COALESCE((SELECT SUM(op.merchandise_amount) FROM order_payments op
            WHERE op.order_id=o.id AND op.status='confirmed'),0) merchandise_received
        FROM orders o WHERE o.business_id=$1 AND o.order_status<>'cancelled'
      )
      SELECT
        COUNT(*) FILTER(WHERE order_status='completed')::int completed_orders,
        COALESCE(SUM(subtotal) FILTER(WHERE order_status='completed'),0) completed_merchandise_value,
        COALESCE(SUM(merchandise_received),0) confirmed_merchandise_received,
        COALESCE(SUM(GREATEST(subtotal-merchandise_received,0)) FILTER(WHERE order_status='completed'),0) completed_receivables,
        COALESCE(SUM(subtotal) FILTER(WHERE order_status<>'completed'),0) open_order_value,
        COALESCE(SUM(GREATEST(subtotal-merchandise_received,0)) FILTER(WHERE order_status<>'completed'),0) open_order_unpaid
      FROM x
    `,[bid]),
    pool.query(`
      SELECT COUNT(oi.id)::int line_count,
        COUNT(oi.id) FILTER(WHERE oi.estimated_cogs>0)::int costed_line_count,
        COALESCE(SUM(oi.line_total),0) revenue,
        COALESCE(SUM(oi.estimated_cogs),0) estimated_cogs,
        COALESCE(SUM(oi.estimated_gross_profit),0) estimated_gross_profit
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.business_id=$1 AND o.order_status='completed'
    `,[bid]),
    optionalQuery(pool,`
      SELECT COUNT(*) FILTER(WHERE r.status='succeeded')::int succeeded_refunds,
        COALESCE(SUM(r.amount) FILTER(WHERE r.status='succeeded'),0) refunded_amount
      FROM refunds r JOIN payment_intents pi ON pi.id=r.payment_intent_id
      WHERE pi.business_id=$1
    `,[bid],[{succeeded_refunds:0,refunded_amount:0}]),
    ledgerMetrics(pool,bid),
    profileFinanceContext(pool,{accountId:Number(ctx.me.account.id),role:'merchant',businessId:bid}),
    allocationStatus(pool,{componentCode:'merchandise',economicPartyId:bid,businessId:bid}),
    allocationStatus(pool,{componentCode:'merchant_net',economicPartyId:bid,businessId:bid}),
    chargedFeeSummary(pool,{businessId:bid,chargedTo:'merchant_deduction'})
  ]);
  const o=orders.rows[0]||{},p=profitability.rows[0]||{},rf=refunds.rows[0]||{};
  const domain=store.rows[0]?.merchant_domain||'unknown';
  const lineCount=n(p.line_count),costed=n(p.costed_line_count),rev=money(p.revenue),cogs=money(p.estimated_cogs);
  const cogsStatus=lineCount===0?'NO_COMPLETED_ORDER_LINES':
    costed===lineCount?'COST_EVIDENCE_COMPLETE':
    costed>0?'PARTIAL_COST_EVIDENCE':
    domain==='non_food'?'NON_FOOD_COST_BASIS_NOT_CONFIGURED':'COST_EVIDENCE_NOT_CONFIGURED';
  return{
    role:'merchant',
    business:{id:bid,name:ctx.business.name,currency_code:ctx.business.currency_code||'PHP'},
    presentation:{
      merchant_domain:domain,
      storefront_status:store.rows[0]?.publication_status||'not_configured',
      food_modules_enabled:['food','mixed'].includes(domain),
      non_food_modules_enabled:['non_food','mixed'].includes(domain),
      legacy_recipe_ui_allowed:['food','mixed'].includes(domain)
    },
    commercial:{
      completed_orders:n(o.completed_orders),
      completed_merchandise_value:money(o.completed_merchandise_value),
      open_order_value:money(o.open_order_value),
      authority:'orders.subtotal; delivery_fee is excluded from Merchant merchandise revenue'
    },
    cash_evidence:{
      confirmed_merchandise_received:money(o.confirmed_merchandise_received),
      provider_merchandise_allocations:merchandiseAlloc,
      rule:'Confirmed merchandise payments / provider allocations are payment evidence, not bank payout evidence.'
    },
    receivables:{
      completed_customer_receivables:money(o.completed_receivables),
      open_order_unpaid:money(o.open_order_unpaid)
    },
    payables:await merchantPayables(pool,bid),
    refunds:{
      succeeded_refund_count:n(rf.succeeded_refunds),
      customer_refund_context:money(rf.refunded_amount),
      attribution_status:'PAYMENT_LEVEL_NOT_FULLY_SPLIT_TO_MERCHANT_MERCHANDISE',
      note:'Refund context is not subtracted from Merchant revenue unless allocation evidence identifies the Merchant share.'
    },
    fees:{
      merchant_deductions:fees,
      processor_fee_rule:'PayMongo processor_fee is a platform/provider cost unless a fee policy explicitly charges it to Merchant.'
    },
    profitability:{
      completed_order_revenue:rev,
      estimated_cogs:cogs,
      estimated_gross_profit:money(p.estimated_gross_profit),
      estimated_margin_pct:rev>0&&cogsStatus==='COST_EVIDENCE_COMPLETE'?Math.round(((rev-cogs)/rev)*10000)/100:null,
      costed_line_count:costed,line_count:lineCount,
      status:cogsStatus,
      note:domain==='non_food'&&cogsStatus!=='COST_EVIDENCE_COMPLETE'
        ?'Non-food COGS is not inferred from recipe tables.'
        :'COGS uses stored order-item cost evidence where available.'
    },
    settlement:{
      merchant_net:merchantNet,
      status:merchantNet.tracked?'TRACKED':'NOT_CONFIGURED',
      note:merchantNet.tracked
        ?'merchant_net allocations are settlement evidence.'
        :'Merchandise payment allocation is not automatically a Merchant payout/bank settlement.'
    },
    ...ledger,
    profile_finance:financeContext,
    warnings:[
      ...(domain==='unknown'?['MERCHANT_STOREFRONT_DOMAIN_NOT_CONFIGURED']:[]),
      ...(cogsStatus==='NON_FOOD_COST_BASIS_NOT_CONFIGURED'?['NON_FOOD_COST_BASIS_NOT_CONFIGURED']:[]),
      ...(!merchantNet.tracked?['MERCHANT_PAYOUT_ALLOCATION_NOT_CONFIGURED']:[])
    ]
  };
}
async function merchantPayables(pool,businessId){
  const q=await optionalQuery(pool,`
    SELECT
      COALESCE(SUM(GREATEST(COALESCE(actual_received_total,0)-paid_amount,0))
        FILTER(WHERE status NOT IN ('cancelled','rejected')),0) supplier_payables,
      COALESCE(SUM(expected_total)
        FILTER(WHERE status NOT IN ('received','cancelled','rejected')),0) procurement_commitments,
      COUNT(*) FILTER(WHERE status NOT IN ('received','cancelled','rejected'))::int open_purchase_orders
    FROM purchase_orders WHERE business_id=$1
  `,[businessId],[{}]);
  return{
    supplier_payables:money(q.rows[0]?.supplier_payables),
    procurement_commitments:money(q.rows[0]?.procurement_commitments),
    open_purchase_orders:n(q.rows[0]?.open_purchase_orders),
    authority:'purchase_orders.actual_received_total / paid_amount / expected_total'
  };
}
async function supplierOverview(pool,ctx){
  const bid=Number(ctx.business.id),accountId=Number(ctx.me.account.id),bindingCount=(ctx.businesses||[]).length;
  const [po,ledger,financeContext,supplierNet,fees,upstream,receiptLedger]=await Promise.all([
    optionalQuery(pool,`
      SELECT
        COUNT(*) FILTER(WHERE status NOT IN ('cancelled','rejected'))::int po_count,
        COUNT(*) FILTER(WHERE status='received')::int received_po_count,
        COALESCE(SUM(actual_received_total) FILTER(WHERE status NOT IN ('cancelled','rejected')),0) fulfilled_value,
        COALESCE(SUM(paid_amount) FILTER(WHERE status NOT IN ('cancelled','rejected')),0) money_received_recorded,
        COALESCE(SUM(GREATEST(actual_received_total-paid_amount,0))
          FILTER(WHERE status NOT IN ('cancelled','rejected')),0) merchant_receivables,
        COALESCE(SUM(expected_total)
          FILTER(WHERE status IN ('supplier_received','accepted','partially_accepted','preparing','ready_for_pickup','out_for_delivery','delivered','partially_received')),0) open_commercial_value
      FROM purchase_orders WHERE supplier_account_id=$1
    `,[accountId],[{}]),
    ledgerMetrics(pool,bid),
    profileFinanceContext(pool,{accountId,role:'supplier',businessId:bid}),
    allocationStatus(pool,{componentCode:'supplier_net',economicPartyId:accountId}),
    chargedFeeSummary(pool,{supplierAccountId:accountId,chargedTo:'supplier_deduction'}),
    merchantPayables(pool,bid),
    pool.query(`
      SELECT COUNT(*)::int receipt_count,COALESCE(SUM(amount),0) received_amount
      FROM transactions WHERE business_id=$1 AND source='supplier_receipt' AND type='sale'
    `,[bid])
  ]);
  const p=po.rows[0]||{};
  const attribution=bindingCount===1?'SINGLE_SUPPLIER_BUSINESS_BINDING':'ACCOUNT_LEVEL_UNATTRIBUTED';
  const recordedReceipts=money(receiptLedger.rows[0]?.received_amount);
  return{
    role:'supplier',
    business:{id:bid,name:ctx.business.name,currency_code:ctx.business.currency_code||'PHP'},
    presentation:{
      merchant_domain:null,
      food_modules_enabled:false,
      legacy_recipe_ui_allowed:false,
      inventory_label:'Inventory / raw materials'
    },
    commercial:{
      attribution_status:attribution,
      po_count:n(p.po_count),received_po_count:n(p.received_po_count),
      fulfilled_po_value:attribution==='SINGLE_SUPPLIER_BUSINESS_BINDING'?money(p.fulfilled_value):null,
      open_commercial_value:attribution==='SINGLE_SUPPLIER_BUSINESS_BINDING'?money(p.open_commercial_value):null,
      account_level_supplier_activity:{
        fulfilled_po_value:money(p.fulfilled_value),
        open_commercial_value:money(p.open_commercial_value),
        po_count:n(p.po_count)
      },
      authority:'purchase_orders by supplier_account_id',
      note:attribution==='ACCOUNT_LEVEL_UNATTRIBUTED'
        ?'POs are linked to Supplier account, not supplier_business_id. Account-wide figures are not assigned to this business.'
        :'Single Supplier business binding allows account-level PO activity to be shown for this workspace.'
    },
    cash_evidence:{
      business_ledger_recorded_receipts:recordedReceipts,
      business_ledger_receipt_count:n(receiptLedger.rows[0]?.receipt_count),
      account_level_po_paid_amount:money(p.money_received_recorded),
      attribution_status:attribution,
      rule:'PO paid_amount / supplier_receipt is recorded payment evidence; it is not bank payout evidence.'
    },
    receivables:{
      merchant_receivables:attribution==='SINGLE_SUPPLIER_BUSINESS_BINDING'?money(p.merchant_receivables):null,
      account_level_merchant_receivables:money(p.merchant_receivables),
      attribution_status:attribution
    },
    payables:{
      upstream_supplier_payables:upstream.supplier_payables,
      upstream_procurement_commitments:upstream.procurement_commitments,
      open_purchase_orders:upstream.open_purchase_orders,
      note:'These are purchases made by this Supplier business as a buyer, when configured.'
    },
    fees:{
      supplier_deductions:fees
    },
    profitability:{
      status:'COST_BASIS_REQUIRES_BUSINESS_EXPENSE_AND_INVENTORY_EVIDENCE',
      recorded_business_expenses:ledger.ledger.business_expenses,
      inventory_valuation:ledger.inventory.valuation,
      gross_margin:null,
      note:'Supplier margin is not invented from PO value alone. Raw-material/production/fulfilment cost attribution is required.'
    },
    settlement:{
      supplier_net:supplierNet,
      status:supplierNet.tracked?'TRACKED':'NOT_CONFIGURED',
      scope:bindingCount===1?'single_business_account':'supplier_account',
      note:supplierNet.tracked
        ?'supplier_net allocations are settlement evidence.'
        :'PO paid_amount is not treated as provider payout/settlement.'
    },
    ...ledger,
    profile_finance:financeContext,
    warnings:[
      ...(bindingCount>1?['MULTI_BUSINESS_SUPPLIER_PO_ATTRIBUTION_PENDING']:[]),
      ...(!supplierNet.tracked?['SUPPLIER_PAYOUT_ALLOCATION_NOT_CONFIGURED']:[])
    ]
  };
}
export async function businessFinanceOverview(pool,ctx){
  if(ctx.role==='merchant')return merchantOverview(pool,ctx);
  if(ctx.role==='supplier')return supplierOverview(pool,ctx);
  throw Object.assign(new Error('Business Finance overview is available only for Merchant or Supplier'),{status:400});
}
