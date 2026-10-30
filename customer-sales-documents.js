import crypto from 'node:crypto';
import {readOrderDetail} from './orders-read-core.js';
import {emitNotificationEvent} from './notification-core.js';

const err=(status,message)=>Object.assign(new Error(message),{status});
const id=(v,label='Identifier')=>{
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<1)throw err(400,label+' must be a positive integer');
  return n;
};
const money=value=>Number((Number(value)||0).toFixed(2));
const short=(v,max=250)=>String(v??'').trim().slice(0,max);
const cleanHtml=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clientKey=value=>{
  const key=short(value,100);
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(key))throw err(400,'client_request_key is required for safe email retries');
  return key;
};

export function commercialOrderDocument(order,clock=new Date()){
  if(!order?.id||!order?.business_id)throw err(404,'Order not found');
  if(!id(order.customer_account_id,'Customer account'))throw err(422,'Only registered Customers may receive order documents');
  if(order.order_status==='cancelled')throw err(409,'Cancelled orders need separate refund/credit evidence');
  const paid=money(order.paid_amount),outstanding=money(order.outstanding_amount),total=money(order.total);
  if(paid<=0&&order.order_status!=='completed')throw err(409,'Document is available after recorded payment or order completion');
  const items=(order.items||[]).map(item=>({
    item_id:id(item.id,'Order line'),
    name:short(item.name_snapshot,200),
    quantity:Number(item.quantity),
    unit_price:money(item.unit_price_snapshot),
    line_total:money(item.line_total)
  }));
  if(!items.length||items.some(item=>!Number.isFinite(item.quantity)||item.quantity<=0))throw err(409,'Order line item evidence is unavailable');
  const kind=paid>0?'payment_record':'order_summary';
  return {
    document_class:kind,fiscal_status:'internal_evidence',jurisdiction:'PH',
    source_order_id:id(order.id),order_number:short(order.order_number||order.id,100),
    business_id:id(order.business_id),business_name:short(order.business_name,200),
    customer_account_id:id(order.customer_account_id),
    currency_code:short(order.currency_code||'PHP',3).toUpperCase(),
    created_at:String(order.created_at||''),
    document_created_at:clock.toISOString(),
    order_status:short(order.order_status,40),
    payment_status:short(order.payment_status,40),
    payment_method:short(order.payment_method,40),
    merchant_recorded_payment:paid,
    payment_source_description:paid>0?'Merchant-recorded payment; external settlement not independently asserted':'No payment recorded',
    subtotal:money(order.subtotal),delivery_fee:money(order.delivery_fee),
    total,amount_due:outstanding,items,
    official_tax_invoice:false,
    disclaimer:'Commercial order and payment evidence only. Not a BIR-issued or BIR-validated tax invoice.'
  };
}
export function orderDocumentDigest(snapshot){
  // The timestamp does not change the identity of the economic document.
  const {...business}=snapshot;
  delete business.document_created_at;
  return crypto.createHash('sha256').update(JSON.stringify(business)).digest('hex');
}
export function salesDocumentMessage(snapshot){
  const display=amount=>new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(amount)||0);
  const items=snapshot.items.map(x=>x.name+' × '+x.quantity+' = '+display(x.line_total));
  let list=items.join('; ');
  if(list.length>340)list=list.slice(0,330)+'… (open your account for all lines)';
  return {
    order_number:snapshot.order_number,
    business_name:snapshot.business_name,
    document_label:snapshot.document_class==='payment_record'?'Merchant payment record':'Order summary',
    item_summary:list,
    currency:snapshot.currency_code,
    total:display(snapshot.total),
    paid:display(snapshot.merchant_recorded_payment),
    due:display(snapshot.amount_due),
    document_disclaimer:'This is a commercial order/payment record, not a BIR tax invoice.'
  };
}
export function salesDocumentPrintHtml(snapshot){
  const esc=cleanHtml,mon=v=>esc(snapshot.currency_code)+' '+(Number(v)||0).toFixed(2);
  const lines=snapshot.items.map(item=>
    '<tr><td>'+esc(item.name)+'</td><td>'+esc(item.quantity)+'</td><td>'+mon(item.unit_price)+'</td><td>'+mon(item.line_total)+'</td></tr>'
  ).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order '+esc(snapshot.order_number)+'</title>'+
    '<style>body{font-family:system-ui,Arial;max-width:740px;margin:30px auto;padding:16px;color:#182633}h1{margin:0 0 6px;font-size:24px}small{color:#52606e}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{padding:10px 6px;border-bottom:1px solid #e5ebee;text-align:left}th:last-child,td:last-child{text-align:right}.totals{text-align:right;margin:16px 0}.disclaimer{border-top:1px solid #dae2e6;padding:14px 0;color:#566475;font-size:13px}@media print{body{margin:0;padding:0}}</style></head><body>'+
    '<h1>'+esc(snapshot.document_class==='payment_record'?'Merchant payment record':'Order summary')+'</h1>'+
    '<p><strong>'+esc(snapshot.business_name)+'</strong><br>Order '+esc(snapshot.order_number)+'<br><small>Order date: '+esc(snapshot.created_at)+'<br>Record date: '+esc(snapshot.document_created_at)+'</small></p>'+
    '<table><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>'+lines+'</tbody></table>'+
    '<div class="totals"><p>Merchandise: '+mon(snapshot.subtotal)+'</p><p>Delivery: '+mon(snapshot.delivery_fee)+'</p><p><strong>Total: '+mon(snapshot.total)+'</strong></p><p>Merchant-recorded payment: '+mon(snapshot.merchant_recorded_payment)+'</p><p>Outstanding: '+mon(snapshot.amount_due)+'</p></div>'+
    '<div class="disclaimer">'+esc(snapshot.disclaimer)+'<p>Recorded payment is not independently verified bank settlement. This document does not create or modify an accounting transaction.</p></div></body></html>';
}

export async function ensureCustomerSalesDocumentsSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_sales_documents(
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      customer_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      document_class TEXT NOT NULL CHECK(document_class IN ('payment_record','order_summary')),
      source_sha256 CHAR(64) NOT NULL,
      snapshot_json JSONB NOT NULL,
      created_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id,source_sha256)
    );
    CREATE INDEX IF NOT EXISTS customer_sales_documents_customer_idx
      ON customer_sales_documents(customer_account_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS customer_sales_documents_business_idx
      ON customer_sales_documents(business_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS customer_sales_document_sends(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES customer_sales_documents(id) ON DELETE RESTRICT,
      sent_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      customer_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      client_request_key TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      notification_event_id BIGINT REFERENCES notification_events(id) ON DELETE SET NULL,
      queue_status TEXT NOT NULL DEFAULT 'pending' CHECK(queue_status IN ('pending','queued','queue_failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id,client_request_key)
    );
  `);
}
const documentPublic=row=>({
  id:Number(row.id),order_id:Number(row.order_id),business_id:Number(row.business_id),
  document_class:row.document_class,created_at:row.created_at,
  order_number:row.snapshot_json?.order_number,company_name:row.snapshot_json?.business_name,
  currency_code:row.snapshot_json?.currency_code,
  total:row.snapshot_json?.total,paid:row.snapshot_json?.merchant_recorded_payment,
  amount_due:row.snapshot_json?.amount_due,fiscal_status:'internal_evidence'
});
async function merchantPermission(pool,accountId,businessId){
  const q=await pool.query(`
    SELECT 1 FROM accounts a
    JOIN profiles p ON p.account_id=a.id AND p.role='merchant' AND p.enabled=TRUE
    JOIN profile_business_bindings b ON b.account_id=a.id AND b.role='merchant' AND b.status='active' AND b.business_id=$2
    JOIN business_memberships m ON m.account_id=a.id AND m.business_id=b.business_id AND m.active=TRUE
    WHERE a.id=$1 AND a.active_role='merchant'
  `,[accountId,businessId]);
  return Boolean(q.rowCount);
}
async function requireMerchantBusiness(pool,actor,businessId){
  if(!(await merchantPermission(pool,actor,businessId)))throw err(403,'Merchant business is not available');
}
async function authorizedDocument(pool,actor,documentId){
  const q=await pool.query('SELECT * FROM customer_sales_documents WHERE id=$1',[id(documentId)]);
  if(!q.rowCount)throw err(404,'Document not found');
  const document=q.rows[0];
  if(Number(document.customer_account_id)===actor)return document;
  if(await merchantPermission(pool,actor,Number(document.business_id)))return document;
  throw err(404,'Document not found');
}
async function createOrFind(pool,{order,actor}){
  const snapshot=commercialOrderDocument(order),hash=orderDocumentDigest(snapshot);
  const insert=await pool.query(`
    INSERT INTO customer_sales_documents(
      order_id,business_id,customer_account_id,document_class,source_sha256,snapshot_json,created_by_account_id
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
    ON CONFLICT(order_id,source_sha256) DO NOTHING RETURNING *
  `,[order.id,order.business_id,order.customer_account_id,snapshot.document_class,hash,JSON.stringify(snapshot),actor]);
  if(insert.rowCount)return insert.rows[0];
  const row=await pool.query('SELECT * FROM customer_sales_documents WHERE order_id=$1 AND source_sha256=$2',[order.id,hash]);
  return row.rows[0];
}
async function queueDocument(pool,{document,actor,requestKey,emit=emitNotificationEvent}){
  const customerId=id(document.customer_account_id),client=await pool.connect();
  let attempt;
  try{
    await client.query('BEGIN');
    await client.query('SELECT id FROM customer_sales_documents WHERE id=$1 FOR UPDATE',[document.id]);
    const existing=await client.query(
      'SELECT * FROM customer_sales_document_sends WHERE document_id=$1 AND client_request_key=$2',
      [document.id,requestKey]
    );
    if(existing.rowCount){
      attempt=existing.rows[0];
      await client.query('COMMIT');
      // Reusing this exact request key is safe: notification event keys are idempotent.
      if(attempt.queue_status==='queued')return{attempt,already_queued:true};
    }else{
      const recent=await client.query(`
        SELECT id FROM customer_sales_document_sends
         WHERE document_id=$1 AND queue_status IN ('pending','queued')
           AND created_at>NOW()-INTERVAL '5 minutes' LIMIT 1
      `,[document.id]);
      if(recent.rowCount)throw err(429,'A document email was requested recently. Try again later.');
      const eventKey='order-sales-document:'+document.id+':'+crypto.randomUUID();
      const added=await client.query(`
        INSERT INTO customer_sales_document_sends(document_id,sent_by_account_id,customer_account_id,client_request_key,event_key)
        VALUES($1,$2,$3,$4,$5) RETURNING *
      `,[document.id,actor,customerId,requestKey,eventKey]);
      attempt=added.rows[0];
      await client.query('COMMIT');
    }
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release()}
  const message=salesDocumentMessage(document.snapshot_json);
  try{
    const eventId=await emit(pool,{
      eventKey:attempt.event_key,eventCode:'order.billing_document',
      sourceService:'sales_documents',entityType:'order',
      entityId:String(document.order_id),correlationId:attempt.event_key,
      category:'operational',priority:'normal',mandatory:true,emailDefault:true,pushDefault:false,
      data:message,recipients:[{accountId:customerId,roleHint:'customer'}]
    });
    if(!eventId)throw new Error('Notification could not be queued');
    await pool.query('UPDATE customer_sales_document_sends SET queue_status=$1,notification_event_id=$2 WHERE id=$3',
      ['queued',eventId,attempt.id]);
    return{attempt:{...attempt,queue_status:'queued',notification_event_id:eventId},already_queued:false};
  }catch(e){
    await pool.query("UPDATE customer_sales_document_sends SET queue_status='queue_failed' WHERE id=$1",[attempt.id]).catch(()=>{});
    throw err(503,'Email delivery queue is unavailable; the saved document remains available');
  }
}
export function registerCustomerSalesDocumentRoutes({app,pool,body,identity}){
  app.get('/api/notifications/order-sales-documents/my',async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account');
      const q=await pool.query(`
        SELECT * FROM customer_sales_documents
         WHERE customer_account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100
      `,[actor]);
      res.json({documents:q.rows.map(documentPublic)});
    }catch(e){next(e)}
  });
  app.get('/api/notifications/order-sales-documents/merchant-orders',async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account');
      const businessId=id(req.query.business_id,'business_id');
      await requireMerchantBusiness(pool,actor,businessId);
      const q=await pool.query(`
        SELECT o.id,o.order_number,o.created_at,o.order_status,o.payment_status,
          o.total,o.paid_amount,o.outstanding_amount,o.customer_account_id,
          COALESCE(a.email_verified_at IS NOT NULL,FALSE) customer_email_verified,
          EXISTS(SELECT 1 FROM customer_sales_documents d WHERE d.order_id=o.id) has_document
        FROM orders o LEFT JOIN accounts a ON a.id=o.customer_account_id
        WHERE o.business_id=$1 AND o.customer_account_id IS NOT NULL AND o.order_status<>'cancelled'
          AND (o.paid_amount>0 OR o.order_status='completed')
        ORDER BY o.created_at DESC,o.id DESC LIMIT 100
      `,[businessId]);
      res.json({orders:q.rows});
    }catch(e){next(e)}
  });
  app.get('/api/notifications/order-sales-documents/business',async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account');
      const businessId=id(req.query.business_id,'business_id');
      await requireMerchantBusiness(pool,actor,businessId);
      const q=await pool.query('SELECT * FROM customer_sales_documents WHERE business_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[businessId]);
      res.json({documents:q.rows.map(documentPublic)});
    }catch(e){next(e)}
  });
  app.post('/api/notifications/order-sales-documents/orders/:id/send',body,async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account');
      const businessId=id(req.body?.business_id,'business_id');
      const requestKey=clientKey(req.body?.client_request_key);
      await requireMerchantBusiness(pool,actor,businessId);
      const orderId=id(req.params.id,'Order');
      const ownOrder=await pool.query('SELECT id FROM orders WHERE id=$1 AND business_id=$2',[orderId,businessId]);
      if(!ownOrder.rowCount)throw err(404,'Order not found for this Merchant');
      const order=await readOrderDetail(pool,orderId);
      if(!order||Number(order.business_id)!==businessId)throw err(404,'Order not found for this Merchant');
      if(!order.customer_account_id)throw err(422,'Only registered Customers may receive an email document');
      const customer=await pool.query('SELECT email,email_verified_at FROM accounts WHERE id=$1',[order.customer_account_id]);
      if(!customer.rowCount||!customer.rows[0].email_verified_at||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(short(customer.rows[0].email,200)))throw err(409,'Customer verified email is required for receipt email');
      const document=await createOrFind(pool,{order,actor});
      const result=await queueDocument(pool,{document,actor,requestKey});
      res.status(result.already_queued?200:202).json({
        document:documentPublic(document),
        delivery_status:result.attempt.queue_status,
        already_queued:result.already_queued,
        message:'This is a commercial order/payment record; fiscal Invoice validity is not asserted'
      });
    }catch(e){next(e)}
  });
  app.get('/api/notifications/order-sales-documents/:id',async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account'),doc=await authorizedDocument(pool,actor,req.params.id);
      res.json({document:documentPublic(doc),snapshot:doc.snapshot_json});
    }catch(e){next(e)}
  });
  app.get('/api/notifications/order-sales-documents/:id/print',async(req,res,next)=>{
    try{
      const actor=id((await identity(req)).account.id,'Account'),doc=await authorizedDocument(pool,actor,req.params.id);
      res.set({'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
      res.status(200).type('html').send(salesDocumentPrintHtml(doc.snapshot_json));
    }catch(e){next(e)}
  });
}
export const customerSalesDocumentInternals={merchantPermission,authorizedDocument,queueDocument};
