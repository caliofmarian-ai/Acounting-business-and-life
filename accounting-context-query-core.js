// Resolve the ordinary Merchant/Supplier accounting context in one PostgreSQL
// round trip. Inventory mutation origin selection intentionally remains separate.
export const ACCOUNTING_CONTEXT_RESOLVE_SQL = [
  "WITH bindings AS MATERIALIZED (",
  "  SELECT b.*,pb.is_primary,pb.status AS binding_status,bm.membership_role",
  "  FROM profile_business_bindings pb",
  "  JOIN businesses b ON b.id=pb.business_id",
  "  JOIN business_memberships bm",
  "    ON bm.business_id=pb.business_id",
  "   AND bm.account_id=pb.account_id",
  "   AND bm.active=TRUE",
  "  WHERE pb.account_id=$1",
  "    AND pb.role=$2",
  "    AND pb.status='active'",
  "  ORDER BY pb.is_primary DESC,b.id",
  "),",
  "preferred AS MATERIALIZED (",
  "  SELECT business_id",
  "  FROM account_business_preferences",
  "  WHERE account_id=$1 AND role=$2",
  "),",
  "selected AS MATERIALIZED (",
  "  SELECT b.id",
  "  FROM bindings b",
  "  WHERE b.id=COALESCE(",
  "    (SELECT p.business_id FROM preferred p JOIN bindings preferred_binding ON preferred_binding.id=p.business_id LIMIT 1),",
  "    (SELECT primary_binding.id FROM bindings primary_binding ORDER BY primary_binding.is_primary DESC,primary_binding.id LIMIT 1)",
  "  )",
  "  LIMIT 1",
  "),",
  "preference_write AS (",
  "  INSERT INTO account_business_preferences(account_id,role,business_id)",
  "  SELECT $1,$2,s.id FROM selected s",
  "  ON CONFLICT(account_id,role) DO UPDATE",
  "    SET business_id=EXCLUDED.business_id,updated_at=NOW()",
  "    WHERE account_business_preferences.business_id IS NOT DISTINCT FROM (SELECT p.business_id FROM preferred p)",
  "      AND account_business_preferences.business_id IS DISTINCT FROM EXCLUDED.business_id",
  "  RETURNING business_id",
  "),",
  "budget_write AS (",
  "  INSERT INTO budgets(id,business_id)",
  "  SELECT 1,s.id FROM selected s",
  "  ON CONFLICT(business_id,id) DO NOTHING",
  "  RETURNING business_id",
  ")",
  "SELECT b.*,(b.id=s.id) AS context_selected",
  "FROM bindings b",
  "CROSS JOIN selected s",
  "ORDER BY b.is_primary DESC,b.id"
].join('\n');

export async function resolveAccountingContext(pool,accountId,role){
  const id=Number(accountId);
  if(!Number.isSafeInteger(id)||id<=0)throw new TypeError('A positive account ID is required.');
  if(role!=='merchant'&&role!=='supplier')throw new TypeError('Merchant or Supplier role is required.');
  const {rows}=await pool.query(ACCOUNTING_CONTEXT_RESOLVE_SQL,[id,role]);
  const selectedIndex=rows.findIndex(row=>row.context_selected===true);
  const businesses=rows.map(({context_selected,...row})=>row);
  return {business: selectedIndex<0?null:businesses[selectedIndex],businesses};
}
