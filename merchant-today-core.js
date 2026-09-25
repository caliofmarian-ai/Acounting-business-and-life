const n=v=>Number(v||0);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

async function optionalQuery(pool,sql,args=[],fallbackRows=[{}]){
  try{return await pool.query(sql,args)}
  catch(error){
    if(['42P01','42703'].includes(error?.code))return{rows:fallbackRows,rowCount:fallbackRows.length,optional_missing:true};
    throw error;
  }
}

export function merchantTodayViewModel({
  business,
  presentation={},
  orderRow={},
  inventoryRow={},
  inventoryItems=[],
  supplierRow={},
  rfqRow={},
  exceptionRow={},
  catalogRow={},
  finance={}
}={}){
  const foodCapable=Boolean(presentation.food_modules_enabled||presentation.merchant_domain==='food'||presentation.merchant_domain==='mixed');
  const orders={
    waiting_customer:n(orderRow.waiting_customer),
    awaiting_payment:n(orderRow.awaiting_payment),
    accepted:n(orderRow.accepted),
    preparing:n(orderRow.preparing),
    ready:n(orderRow.ready),
    delivery_handoff:n(orderRow.delivery_handoff)
  };
  orders.attention_total=orders.waiting_customer+orders.awaiting_payment+orders.accepted+orders.preparing+orders.ready+orders.delivery_handoff;

  const lowStock=n(inventoryRow.low_stock);
  const outOfStock=n(inventoryRow.out_of_stock);
  const sourceAttention=n(inventoryRow.source_attention);

  const supplierDecisions=n(exceptionRow.backorder_decisions)+n(exceptionRow.substitution_decisions);
  const quotedRfqs=n(rfqRow.quoted_rfqs);
  const waitingRfqs=n(rfqRow.waiting_rfqs);
  const receivedUnpaid=n(supplierRow.received_unpaid);

  const catalog={
    total:n(catalogRow.total),
    unpublished:n(catalogRow.unpublished),
    unavailable:n(catalogRow.unavailable),
    missing_media:n(catalogRow.missing_media),
    ai_drafts_to_review:n(catalogRow.ai_drafts_to_review),
    recipe_attention:foodCapable?n(catalogRow.recipe_attention):0
  };
  catalog.attention_total=catalog.unpublished+catalog.unavailable+catalog.missing_media+catalog.ai_drafts_to_review+catalog.recipe_attention;

  return{
    generated_at:new Date().toISOString(),
    business,
    presentation:{
      merchant_domain:presentation.merchant_domain||'unknown',
      storefront_status:presentation.storefront_status||'not_configured',
      food_modules_enabled:foodCapable,
      non_food_modules_enabled:Boolean(presentation.non_food_modules_enabled||presentation.merchant_domain==='non_food'||presentation.merchant_domain==='mixed')
    },
    orders,
    inventory:{
      low_stock:lowStock,
      out_of_stock:outOfStock,
      source_attention:sourceAttention,
      attention_total:lowStock,
      items:(inventoryItems||[]).slice(0,5).map(x=>({
        id:Number(x.id),
        item:String(x.item||''),
        quantity:n(x.quantity),
        reorder_level:n(x.reorder_level),
        unit:String(x.base_unit||x.unit||'unit')
      }))
    },
    supplier:{
      decisions_required:supplierDecisions,
      backorder_decisions:n(exceptionRow.backorder_decisions),
      substitution_decisions:n(exceptionRow.substitution_decisions),
      rfqs_to_compare:quotedRfqs,
      rfqs_waiting_supplier:waitingRfqs,
      open_purchase_orders:n(supplierRow.open_purchase_orders),
      received_unpaid:receivedUnpaid,
      attention_total:supplierDecisions+quotedRfqs+receivedUnpaid
    },
    catalog,
    money:{
      confirmed_received:money(finance?.cash_evidence?.confirmed_merchandise_received),
      completed_sales:money(finance?.commercial?.completed_merchandise_value),
      awaiting_payment:money(finance?.receivables?.completed_customer_receivables),
      business_expenses:money(finance?.ledger?.business_expenses),
      currency_code:finance?.business?.currency_code||business?.currency_code||'PHP'
    },
    authority:{
      orders:'canonical orders state machine',
      inventory:'business-scoped inventory evidence only',
      supplier:'procurement, RFQ and Supplier exception evidence; no automatic winner or PO creation',
      catalog:'merchant storefront, catalog publication and catalog media evidence',
      money:'existing role-aware finance overview; order value is never treated as cash'
    }
  };
}


async function merchantTodayFinanceSnapshot(pool,ctx){
  const bid=Number(ctx.business.id);
  const {rows}=await pool.query(`
    WITH store AS (
      SELECT merchant_domain,publication_status
      FROM merchant_storefronts
      WHERE business_id=$1
      LIMIT 1
    ),
    order_finance AS (
      WITH x AS (
        SELECT o.id,o.order_status,o.subtotal,
          COALESCE((SELECT SUM(op.merchandise_amount) FROM order_payments op
            WHERE op.order_id=o.id AND op.status='confirmed'),0) merchandise_received
        FROM orders o
        WHERE o.business_id=$1 AND o.order_status<>'cancelled'
      )
      SELECT
        COALESCE(SUM(subtotal) FILTER(WHERE order_status='completed'),0) completed_merchandise_value,
        COALESCE(SUM(merchandise_received),0) confirmed_merchandise_received,
        COALESCE(SUM(GREATEST(subtotal-merchandise_received,0)) FILTER(WHERE order_status='completed'),0) completed_receivables
      FROM x
    ),
    ledger AS (
      SELECT COALESCE(SUM(amount) FILTER(WHERE type='business_expense'),0) business_expenses
      FROM transactions
      WHERE business_id=$1
    )
    SELECT
      COALESCE((SELECT merchant_domain FROM store),'unknown') merchant_domain,
      COALESCE((SELECT publication_status FROM store),'not_configured') publication_status,
      order_finance.completed_merchandise_value,
      order_finance.confirmed_merchandise_received,
      order_finance.completed_receivables,
      ledger.business_expenses
    FROM order_finance CROSS JOIN ledger
  `,[bid]);
  const x=rows[0]||{};
  const domain=x.merchant_domain||'unknown';
  return{
    business:{id:bid,name:ctx.business.name,currency_code:ctx.business.currency_code||'PHP'},
    presentation:{
      merchant_domain:domain,
      storefront_status:x.publication_status||'not_configured',
      food_modules_enabled:['food','mixed'].includes(domain),
      non_food_modules_enabled:['non_food','mixed'].includes(domain),
      legacy_recipe_ui_allowed:['food','mixed'].includes(domain)
    },
    commercial:{completed_merchandise_value:money(x.completed_merchandise_value)},
    cash_evidence:{confirmed_merchandise_received:money(x.confirmed_merchandise_received)},
    receivables:{completed_customer_receivables:money(x.completed_receivables)},
    ledger:{business_expenses:money(x.business_expenses)}
  };
}

export async function loadMerchantToday(pool,ctx){
  if(ctx?.role!=='merchant'){
    const error=new Error('Merchant profile required');
    error.status=403;
    throw error;
  }
  const bid=Number(ctx.business.id);
  const [
    finance,
    orders,
    inventory,
    inventoryItems,
    sourceAttention,
    supplier,
    rfqs,
    exceptions,
    catalog
  ]=await Promise.all([
    merchantTodayFinanceSnapshot(pool,ctx),
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE order_status='awaiting_customer_presence')::int waiting_customer,
        COUNT(*) FILTER(WHERE order_status='awaiting_payment')::int awaiting_payment,
        COUNT(*) FILTER(WHERE order_status='accepted')::int accepted,
        COUNT(*) FILTER(WHERE order_status='preparing')::int preparing,
        COUNT(*) FILTER(WHERE order_status='ready')::int ready,
        COUNT(*) FILTER(WHERE order_status='handoff_to_delivery')::int delivery_handoff
      FROM orders
      WHERE business_id=$1 AND order_status NOT IN ('completed','cancelled')
    `,[bid]),
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE quantity<=reorder_level)::int low_stock,
        COUNT(*) FILTER(WHERE quantity<=0)::int out_of_stock
      FROM inventory WHERE business_id=$1
    `,[bid]),
    pool.query(`
      SELECT id,item,quantity,reorder_level,unit,base_unit
      FROM inventory
      WHERE business_id=$1 AND quantity<=reorder_level
      ORDER BY quantity<=0 DESC,(reorder_level-quantity) DESC,item
      LIMIT 5
    `,[bid]),
    optionalQuery(pool,`
      SELECT COUNT(DISTINCT i.id)::int source_attention
      FROM inventory i
      JOIN merchant_inventory_supplier_sources s
        ON s.business_id=i.business_id AND s.inventory_id=i.id AND s.active=TRUE
      WHERE i.business_id=$1 AND i.quantity<=i.reorder_level
    `,[bid],[{source_attention:0}]),
    optionalQuery(pool,`
      SELECT
        COUNT(*) FILTER(WHERE status NOT IN ('received','cancelled','rejected'))::int open_purchase_orders,
        COUNT(*) FILTER(
          WHERE status='received'
            AND COALESCE(payment_status,'unpaid')<>'paid'
            AND COALESCE(actual_received_total,0)>COALESCE(paid_amount,0)
        )::int received_unpaid
      FROM purchase_orders WHERE business_id=$1
    `,[bid],[{open_purchase_orders:0,received_unpaid:0}]),
    optionalQuery(pool,`
      SELECT
        COUNT(*) FILTER(WHERE status='quoted' AND expires_at>NOW())::int quoted_rfqs,
        COUNT(*) FILTER(WHERE status='open' AND expires_at>NOW())::int waiting_rfqs
      FROM supplier_rfqs WHERE business_id=$1
    `,[bid],[{quoted_rfqs:0,waiting_rfqs:0}]),
    optionalQuery(pool,`
      SELECT
        (SELECT COUNT(*)::int FROM supplier_backorders
          WHERE business_id=$1 AND state='proposed') backorder_decisions,
        (SELECT COUNT(*)::int FROM supplier_substitution_proposals
          WHERE business_id=$1 AND state='proposed') substitution_decisions
    `,[bid],[{backorder_decisions:0,substitution_decisions:0}]),
    optionalQuery(pool,`
      SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER(WHERE published=FALSE)::int unpublished,
        COUNT(*) FILTER(WHERE active=FALSE)::int unavailable,
        COUNT(*) FILTER(
          WHERE COALESCE(image_data_url,'')=''
            AND NOT EXISTS(
              SELECT 1 FROM catalog_product_media m
              WHERE m.entity_type='marketplace_product'
                AND m.entity_id=p.id
                AND m.approval_status='approved'
                AND m.public_visible=TRUE
            )
        )::int missing_media,
        COUNT(*) FILTER(
          WHERE EXISTS(
            SELECT 1 FROM catalog_product_media m
            WHERE m.entity_type='marketplace_product'
              AND m.entity_id=p.id
              AND m.source_type='ai_generated'
              AND m.approval_status='draft'
          )
        )::int ai_drafts_to_review,
        COUNT(*) FILTER(
          WHERE p.product_kind='prepared_food'
            AND p.legacy_product_id IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM recipes r WHERE r.product_id=p.legacy_product_id)
        )::int recipe_attention
      FROM marketplace_products p
      WHERE p.business_id=$1
    `,[bid],[{total:0,unpublished:0,unavailable:0,missing_media:0,ai_drafts_to_review:0,recipe_attention:0}])
  ]);

  const inventoryRow={...(inventory.rows[0]||{}),...(sourceAttention.rows[0]||{})};
  return merchantTodayViewModel({
    business:{id:bid,name:ctx.business.name,currency_code:ctx.business.currency_code||'PHP'},
    presentation:finance.presentation||{},
    orderRow:orders.rows[0]||{},
    inventoryRow,
    inventoryItems:inventoryItems.rows,
    supplierRow:supplier.rows[0]||{},
    rfqRow:rfqs.rows[0]||{},
    exceptionRow:exceptions.rows[0]||{},
    catalogRow:catalog.rows[0]||{},
    finance
  });
}
