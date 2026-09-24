export async function readOrderDetail(db,id){
  const orderId=Number(id);
  if(!Number.isSafeInteger(orderId)||orderId<=0)return null;
  const o=await db.query(`SELECT o.*,b.name business_name FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1`,[orderId]);
  if(!o.rowCount)return null;
  const [items,payments,events]=await Promise.all([
    db.query(`SELECT * FROM order_items WHERE order_id=$1 ORDER BY id`,[orderId]),
    db.query(`SELECT id,amount,account,method_code,provider_code,provider_reference,status,created_at FROM order_payments WHERE order_id=$1 ORDER BY created_at,id`,[orderId]),
    db.query(`SELECT from_status,to_status,note,created_at FROM order_status_events WHERE order_id=$1 ORDER BY created_at,id`,[orderId])
  ]);
  return {...o.rows[0],items:items.rows,payments:payments.rows,events:events.rows};
}
