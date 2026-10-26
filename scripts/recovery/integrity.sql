-- Run only against the tool-owned restored cluster. No app initialization/backfills.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SELECT json_build_object(
  'row_counts', json_build_object(
    'accounts',(SELECT count(*)::text FROM public.accounts),
    'businesses',(SELECT count(*)::text FROM public.businesses),
    'profiles',(SELECT count(*)::text FROM public.profiles),
    'business_memberships',(SELECT count(*)::text FROM public.business_memberships),
    'orders',(SELECT count(*)::text FROM public.orders),
    'order_items',(SELECT count(*)::text FROM public.order_items),
    'inventory',(SELECT count(*)::text FROM public.inventory),
    'transactions',(SELECT count(*)::text FROM public.transactions),
    'order_stock_consumptions',(SELECT count(*)::text FROM public.order_stock_consumptions),
    'order_payments',(SELECT count(*)::text FROM public.order_payments),
    'payment_intents',(SELECT count(*)::text FROM public.payment_intents),
    'payment_allocations',(SELECT count(*)::text FROM public.payment_allocations),
    'refunds',(SELECT count(*)::text FROM public.refunds)
  ),
  'checks', json_build_object(
    'identity_references', NOT EXISTS (
      SELECT 1 FROM public.business_memberships m LEFT JOIN public.accounts a ON a.id=m.account_id LEFT JOIN public.businesses b ON b.id=m.business_id WHERE a.id IS NULL OR b.id IS NULL
    ) AND NOT EXISTS (SELECT 1 FROM public.profiles p LEFT JOIN public.accounts a ON a.id=p.account_id WHERE a.id IS NULL),
    'order_references', NOT EXISTS (
      SELECT 1 FROM public.orders o LEFT JOIN public.businesses b ON b.id=o.business_id LEFT JOIN public.accounts a ON a.id=o.customer_account_id WHERE b.id IS NULL OR (o.customer_account_id IS NOT NULL AND a.id IS NULL)
    ) AND NOT EXISTS (SELECT 1 FROM public.order_items i LEFT JOIN public.orders o ON o.id=i.order_id WHERE o.id IS NULL),
    'order_item_quantities', NOT EXISTS (SELECT 1 FROM public.order_items WHERE quantity IS NULL OR quantity<=0 OR line_total IS NULL),
    'business_evidence_references', NOT EXISTS (SELECT 1 FROM public.inventory i LEFT JOIN public.businesses b ON b.id=i.business_id WHERE b.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.transactions t LEFT JOIN public.businesses b ON b.id=t.business_id WHERE b.id IS NULL),
    'stock_business_scope', NOT EXISTS (
      SELECT 1 FROM public.order_stock_consumptions s LEFT JOIN public.orders o ON o.id=s.order_id LEFT JOIN public.inventory i ON i.id=s.inventory_id WHERE o.id IS NULL OR i.id IS NULL OR o.business_id IS DISTINCT FROM i.business_id
    ),
    'payment_references', NOT EXISTS (
      SELECT 1 FROM public.order_payments p LEFT JOIN public.orders o ON o.id=p.order_id LEFT JOIN public.payment_intents i ON i.id=p.payment_intent_id WHERE o.id IS NULL OR (p.payment_intent_id IS NOT NULL AND i.id IS NULL)
    ) AND NOT EXISTS (SELECT 1 FROM public.payment_allocations a LEFT JOIN public.payment_intents i ON i.id=a.payment_intent_id WHERE i.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.refunds r LEFT JOIN public.payment_intents i ON i.id=r.payment_intent_id WHERE i.id IS NULL),
    'payment_identity_references', NOT EXISTS (
      SELECT 1 FROM public.payment_intents p LEFT JOIN public.businesses b ON b.id=p.business_id LEFT JOIN public.accounts a ON a.id=p.payer_account_id WHERE (p.business_id IS NOT NULL AND b.id IS NULL) OR (p.payer_account_id IS NOT NULL AND a.id IS NULL)
    ),
    'payment_currency_matches', NOT EXISTS (SELECT 1 FROM public.payment_allocations a JOIN public.payment_intents i ON i.id=a.payment_intent_id WHERE a.currency_code IS DISTINCT FROM i.currency_code)
  ),
  'anomalies', json_build_object(
    'order_arithmetic',(SELECT count(*)::text FROM public.orders o WHERE o.total IS DISTINCT FROM o.subtotal+o.delivery_fee OR o.outstanding_amount IS DISTINCT FROM o.total-o.paid_amount
      OR o.subtotal IS DISTINCT FROM (SELECT COALESCE(sum(i.line_total),0) FROM public.order_items i WHERE i.order_id=o.id)),
    'negative_inventory',(SELECT count(*)::text FROM public.inventory WHERE quantity<0 OR unit_cost<0),
    'unvalidated_constraints',(SELECT count(*)::text FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype IN ('f','c') AND NOT c.convalidated)
  )
);
ROLLBACK;
