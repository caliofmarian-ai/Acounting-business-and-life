import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';
import { readOrderDetail } from './orders-read-core.js';
import {accountAuthFetch,startEmbeddedAccountAuth,stopEmbeddedAccountAuth} from './server-auth.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '350kb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
const ACCOUNTS = new Set(['cash', 'gcash', 'bank', 'other']);
const FULFILMENT = new Set(['pickup', 'delivery']);
const PAYMENT_METHODS = new Set(['cash', 'online']);
const ORDER_STATUSES = new Set(['awaiting_payment','awaiting_customer_presence','accepted','preparing','ready','handoff_to_delivery','completed','cancelled']);
let authApp=null;
let authReady=false;
let shuttingDown = false;

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function money(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function bearer(req) { return req.headers.authorization || ''; }
function publicToken() { return crypto.randomBytes(24).toString('base64url'); }
function manilaDateStamp() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date());
  const x = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${x.year}${x.month}${x.day}`;
}

export function isOrdersOwnedPath(path='',method='GET'){
  const pathname=String(path||'').split('?')[0];
  if(pathname==='/orders.css'||pathname==='/orders-ui.js')return true;
  if(pathname==='/api/orders'||pathname.startsWith('/api/orders/'))return true;
  return false;
}
export async function ordersFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  const method=String(options.method||'GET').toUpperCase();
  if(isOrdersOwnedPath(pathname,method)){
    throw Object.assign(new Error('Orders-owned paths require in-process Orders dispatch'),{
      status:500,code:'ORDERS_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const auth=await accountAuthFetch('/health',{headers:options.headers||{}});
      const ok=authReady&&auth.ok;
      return new Response(JSON.stringify({ok,db:true,auth:ok,version:'0.5-orders'}),{
        status:ok?200:503,headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,auth:false,version:'0.5-orders'}),{
        status:503,headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  if(pathname==='/'||pathname==='/index.html'){
    const r=await accountAuthFetch(path,options);
    let html=await r.text();
    html=html.replace('</head>','  <link rel="stylesheet" href="/orders.css" />\n</head>')
      .replace('</body>','  <script type="module" src="/orders-ui.js"></script>\n</body>');
    return new Response(html,{status:r.status,headers:{'content-type':'text/html; charset=utf-8'}});
  }
  return accountAuthFetch(path,options);
}
async function identity(req) {
  const r = await accountAuthFetch('/api/me', { headers: { Authorization: bearer(req) } });
  if (!r.ok) { const b = await r.json().catch(()=>({})); throw Object.assign(new Error(b.error || 'Unauthorized'), { status:r.status }); }
  return r.json();
}
function enabledProfile(snapshot, role) { return snapshot?.profiles?.some(p => p.role === role && p.enabled); }
function businessFor(snapshot, businessId = null) {
  const list = snapshot?.businesses || [];
  if (businessId == null) return list[0] || null;
  return list.find(b => Number(b.id) === Number(businessId)) || null;
}
async function requireCustomer(req) {
  const me = await identity(req);
  if (!enabledProfile(me,'customer')) throw Object.assign(new Error('Customer profile is required'),{status:403});
  return me;
}
async function requireMerchant(req, businessId = null) {
  const me = await identity(req);
  if (!enabledProfile(me,'merchant')) throw Object.assign(new Error('Merchant profile is required'),{status:403});
  const business = businessFor(me,businessId);
  if (!business) throw Object.assign(new Error('Business workspace not available'),{status:403});
  return { me, business };
}

async function initDb() {
  await ensureMonetizationSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchant_customer_settings (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      allow_remote_cash_prep BOOLEAN NOT NULL DEFAULT FALSE,
      trust_suspended_at TIMESTAMPTZ,
      trust_suspension_reason TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id, customer_account_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_number TEXT UNIQUE,
      public_token TEXT UNIQUE NOT NULL,
      business_id BIGINT NOT NULL REFERENCES businesses(id),
      customer_account_id BIGINT REFERENCES accounts(id),
      customer_name_snapshot TEXT NOT NULL DEFAULT '',
      customer_contact_snapshot TEXT NOT NULL DEFAULT '',
      fulfilment_method TEXT NOT NULL CHECK (fulfilment_method IN ('pickup','delivery')),
      delivery_address TEXT NOT NULL DEFAULT '',
      order_status TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','online')),
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      preparation_eta_minutes INTEGER NOT NULL DEFAULT 15,
      note TEXT NOT NULL DEFAULT '',
      remote_cash_eligible BOOLEAN NOT NULL DEFAULT FALSE,
      remote_cash_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      customer_checked_in_at TIMESTAMPTZ,
      presence_confirmed_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      preparing_at TIMESTAMPTZ,
      expected_ready_at TIMESTAMPTZ,
      ready_at TIMESTAMPTZ,
      handoff_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancellation_reason TEXT NOT NULL DEFAULT '',
      stock_consumed_at TIMESTAMPTZ,
      stock_reversed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_status_check;
    ALTER TABLE orders ADD CONSTRAINT orders_order_status_check CHECK (order_status IN ('awaiting_payment','awaiting_customer_presence','accepted','preparing','ready','handoff_to_delivery','completed','cancelled'));

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL DEFAULT 'product',
      source_id BIGINT,
      name_snapshot TEXT NOT NULL,
      category_snapshot TEXT NOT NULL DEFAULT '',
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_price_snapshot NUMERIC(12,2) NOT NULL,
      unit_cost_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,
      line_total NUMERIC(12,2) NOT NULL,
      estimated_cogs NUMERIC(12,2) NOT NULL DEFAULT 0,
      estimated_gross_profit NUMERIC(12,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS order_status_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_account_id BIGINT REFERENCES accounts(id),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS order_status_events_order_idx ON order_status_events(order_id,created_at);

    CREATE TABLE IF NOT EXISTS order_stock_consumptions (
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id),
      item_name_snapshot TEXT NOT NULL,
      quantity_used NUMERIC(14,4) NOT NULL,
      unit_cost_snapshot NUMERIC(12,4) NOT NULL,
      cost_snapshot NUMERIC(12,4) NOT NULL,
      reversed_at TIMESTAMPTZ,
      PRIMARY KEY(order_id, inventory_id)
    );

    CREATE TABLE IF NOT EXISTS order_payments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      account TEXT NOT NULL,
      method_code TEXT NOT NULL,
      provider_code TEXT NOT NULL DEFAULT 'manual_merchant_confirmation',
      provider_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      received_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS order_payments_order_idx ON order_payments(order_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_order_payment_source_unique ON transactions(source,source_id) WHERE source='order_payment';
    CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_account_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_business_idx ON orders(business_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(business_id,order_status,created_at DESC);
  `);
}

async function orderDetail(id,client=pool){return readOrderDetail(client,id)}
async function setStatus(client, order, toStatus, actorId, note='') {
  if (!ORDER_STATUSES.has(toStatus)) throw Object.assign(new Error('Unknown order status'),{status:400});
  if (order.order_status === toStatus) return order;
  await client.query(`UPDATE orders SET order_status=$1,updated_at=NOW(),
    accepted_at=CASE WHEN $1='accepted' THEN COALESCE(accepted_at,NOW()) ELSE accepted_at END,
    preparing_at=CASE WHEN $1='preparing' THEN COALESCE(preparing_at,NOW()) ELSE preparing_at END,
    expected_ready_at=CASE WHEN $1='preparing' THEN COALESCE(expected_ready_at,NOW()+(preparation_eta_minutes*INTERVAL '1 minute')) ELSE expected_ready_at END,
    ready_at=CASE WHEN $1='ready' THEN COALESCE(ready_at,NOW()) ELSE ready_at END,
    handoff_at=CASE WHEN $1='handoff_to_delivery' THEN COALESCE(handoff_at,NOW()) ELSE handoff_at END,
    completed_at=CASE WHEN $1='completed' THEN COALESCE(completed_at,NOW()) ELSE completed_at END,
    cancelled_at=CASE WHEN $1='cancelled' THEN COALESCE(cancelled_at,NOW()) ELSE cancelled_at END
    WHERE id=$2`,[toStatus,order.id]);
  await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,$2,$3,$4,$5)`,[order.id,order.order_status,toStatus,actorId,clean(note,300)]);
  return {...order,order_status:toStatus};
}
async function completedCount(businessId, customerId) {
  if (!customerId) return 0;
  const r=await pool.query(`SELECT COUNT(*)::int count FROM orders WHERE business_id=$1 AND customer_account_id=$2 AND order_status='completed'`,[businessId,customerId]);
  return Number(r.rows[0]?.count || 0);
}
async function trustInfo(businessId, customerId) {
  if (!customerId) return {completed_orders:0,eligible:false,allowed:false,suspended:false};
  const count=await completedCount(businessId,customerId);
  const s=await pool.query(`SELECT allow_remote_cash_prep,trust_suspended_at,trust_suspension_reason FROM merchant_customer_settings WHERE business_id=$1 AND customer_account_id=$2`,[businessId,customerId]);
  const row=s.rows[0];
  const suspended=Boolean(row?.trust_suspended_at);
  return {completed_orders:count,eligible:count>=5 && !suspended,allowed:Boolean(row?.allow_remote_cash_prep) && count>=5 && !suspended,suspended,reason:row?.trust_suspension_reason||''};
}

async function productSnapshots(items, businessId, client=pool) {
  const scopedBusinessId=Number(businessId);
  if (!Number.isInteger(scopedBusinessId)||scopedBusinessId<1) throw Object.assign(new Error('A valid Merchant business is required'),{status:400});
  if (!Array.isArray(items)||items.length===0||items.length>50) throw Object.assign(new Error('Order needs 1–50 items'),{status:400});
  const normalized=[]; const quantities=new Map();
  for(const raw of items){const id=Number(raw?.product_id),q=Number(raw?.quantity);if(!Number.isInteger(id)||id<1||!positive(q)) throw Object.assign(new Error('Every item needs a valid product and quantity'),{status:400});quantities.set(id,(quantities.get(id)||0)+q)}
  const ids=[...quantities.keys()];
  const p=await client.query(`SELECT id,name,category,selling_price,active FROM products WHERE business_id=$1 AND id=ANY($2::bigint[])`,[scopedBusinessId,ids]);
  if(p.rowCount!==ids.length) throw Object.assign(new Error('One or more products are unavailable for this business'),{status:409});
  for(const product of p.rows){if(!product.active) throw Object.assign(new Error(`${product.name} is currently unavailable`),{status:409});const cost=await client.query(`SELECT COALESCE(SUM(r.quantity*i.unit_cost),0) unit_cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 AND i.business_id=$2`,[product.id,scopedBusinessId]);const quantity=quantities.get(Number(product.id));const unitPrice=Number(product.selling_price),unitCost=Number(cost.rows[0]?.unit_cost||0),line=money(unitPrice*quantity),cogs=money(unitCost*quantity);normalized.push({source_id:Number(product.id),name_snapshot:product.name,category_snapshot:product.category,quantity,unit_price_snapshot:unitPrice,unit_cost_snapshot:unitCost,line_total:line,estimated_cogs:cogs,estimated_gross_profit:money(line-cogs)})}
  return normalized.sort((a,b)=>a.source_id-b.source_id);
}

async function createOrder({ businessId, customerAccountId=null, customerName='', customerContact='', items, fulfilmentMethod, paymentMethod, deliveryAddress='', note='', preparationEtaMinutes=15, counterPresence=false }) {
  if (!FULFILMENT.has(fulfilmentMethod)) throw Object.assign(new Error('Choose pickup or delivery'),{status:400});
  if (!PAYMENT_METHODS.has(paymentMethod)) throw Object.assign(new Error('Choose cash or online payment'),{status:400});
  if (fulfilmentMethod==='delivery' && paymentMethod==='cash') throw Object.assign(new Error('Cash delivery is not enabled yet. Choose online payment or pickup.'),{status:409});
  if (fulfilmentMethod==='delivery' && !clean(deliveryAddress,400)) throw Object.assign(new Error('Delivery address is required'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const b=await client.query(`SELECT id,name,currency_code FROM businesses WHERE id=$1`,[businessId]);if(!b.rowCount) throw Object.assign(new Error('Merchant not found'),{status:404});
    const itemRows=await productSnapshots(items,businessId,client);
    const subtotal=money(itemRows.reduce((s,i)=>s+i.line_total,0));const deliveryFee=0;const total=money(subtotal+deliveryFee);
    let trust={completed_orders:0,eligible:false,allowed:false,suspended:false};
    if(customerAccountId){const count=await client.query(`SELECT COUNT(*)::int count FROM orders WHERE business_id=$1 AND customer_account_id=$2 AND order_status='completed'`,[businessId,customerAccountId]);const setting=await client.query(`SELECT allow_remote_cash_prep,trust_suspended_at FROM merchant_customer_settings WHERE business_id=$1 AND customer_account_id=$2`,[businessId,customerAccountId]);const c=Number(count.rows[0]?.count||0),s=setting.rows[0];trust={completed_orders:c,eligible:c>=5&&!s?.trust_suspended_at,allowed:c>=5&&Boolean(s?.allow_remote_cash_prep)&&!s?.trust_suspended_at,suspended:Boolean(s?.trust_suspended_at)}}
    let status='awaiting_payment';
    if(paymentMethod==='cash'&&fulfilmentMethod==='pickup') status=(counterPresence||trust.allowed)?'accepted':'awaiting_customer_presence';
    const token=publicToken();
    const order=await client.query(`INSERT INTO orders(public_token,business_id,customer_account_id,customer_name_snapshot,customer_contact_snapshot,fulfilment_method,delivery_address,order_status,payment_status,payment_method,currency_code,subtotal,delivery_fee,total,paid_amount,outstanding_amount,preparation_eta_minutes,note,remote_cash_eligible,remote_cash_allowed,customer_checked_in_at,presence_confirmed_at,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unpaid',$9,$10,$11,$12,$13,0,$13,$14,$15,$16,$17,CASE WHEN $18 THEN NOW() END,CASE WHEN $18 THEN NOW() END,CASE WHEN $8='accepted' THEN NOW() END) RETURNING *`,[token,businessId,customerAccountId,clean(customerName,120),clean(customerContact,160),fulfilmentMethod,clean(deliveryAddress,400),status,paymentMethod,b.rows[0].currency_code||'PHP',subtotal,deliveryFee,total,Math.max(1,Math.min(240,Number(preparationEtaMinutes)||15)),clean(note,400),trust.eligible,trust.allowed,Boolean(counterPresence)]);
    const id=Number(order.rows[0].id);const orderNumber=`BL-${manilaDateStamp()}-${String(id).padStart(5,'0')}`;await client.query(`UPDATE orders SET order_number=$1 WHERE id=$2`,[orderNumber,id]);
    for(const i of itemRows) await client.query(`INSERT INTO order_items(order_id,source_kind,source_id,name_snapshot,category_snapshot,quantity,unit_price_snapshot,unit_cost_snapshot,line_total,estimated_cogs,estimated_gross_profit) VALUES($1,'product',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,i.source_id,i.name_snapshot,i.category_snapshot,i.quantity,i.unit_price_snapshot,i.unit_cost_snapshot,i.line_total,i.estimated_cogs,i.estimated_gross_profit]);
    await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,NULL,$2,$3,'Order created')`,[id,status,customerAccountId]);
    await client.query('COMMIT');return orderDetail(id);
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e}finally{client.release()}
}

async function consumeStock(client, order) {
  if(order.stock_consumed_at) return;
  const rows=await client.query(`SELECT oi.source_id product_id,oi.quantity order_quantity,r.inventory_id,r.quantity recipe_quantity,i.item,i.quantity stock_quantity,i.unit_cost FROM order_items oi JOIN recipes r ON r.product_id=oi.source_id JOIN inventory i ON i.id=r.inventory_id WHERE oi.order_id=$1 AND oi.source_kind='product' AND i.business_id=$2 ORDER BY i.id FOR UPDATE OF i`,[order.id,order.business_id]);
  const needs=new Map();
  for(const r of rows.rows){const id=Number(r.inventory_id),used=Number(r.order_quantity)*Number(r.recipe_quantity),existing=needs.get(id)||{inventory_id:id,item:r.item,stock:Number(r.stock_quantity),unit_cost:Number(r.unit_cost),used:0};existing.used+=used;needs.set(id,existing)}
  const shortages=[...needs.values()].filter(n=>n.stock+1e-9<n.used).map(n=>({item:n.item,required:n.used,available:n.stock,short:n.used-n.stock}));
  if(shortages.length) throw Object.assign(new Error('Not enough stock to start preparation'),{status:409,shortages});
  for(const n of needs.values()){await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2`,[n.used,n.inventory_id]);await client.query(`INSERT INTO order_stock_consumptions(order_id,inventory_id,item_name_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,inventory_id) DO NOTHING`,[order.id,n.inventory_id,n.item,n.used,n.unit_cost,n.used*n.unit_cost])}
  await client.query(`UPDATE orders SET stock_consumed_at=NOW(),updated_at=NOW() WHERE id=$1 AND stock_consumed_at IS NULL`,[order.id]);
}
async function reverseStock(client, order) {
  if(!order.stock_consumed_at||order.stock_reversed_at) return;
  const c=await client.query(`SELECT * FROM order_stock_consumptions WHERE order_id=$1 AND reversed_at IS NULL FOR UPDATE`,[order.id]);
  for(const row of c.rows){await client.query(`UPDATE inventory SET quantity=quantity+$1,updated_at=NOW() WHERE id=$2`,[row.quantity_used,row.inventory_id]);await client.query(`UPDATE order_stock_consumptions SET reversed_at=NOW() WHERE order_id=$1 AND inventory_id=$2 AND reversed_at IS NULL`,[order.id,row.inventory_id])}
  await client.query(`UPDATE orders SET stock_reversed_at=NOW(),updated_at=NOW() WHERE id=$1`,[order.id]);
}

async function recordPayment(client, order, {amount,account,method_code='cash',provider_code='manual_merchant_confirmation',provider_reference='',receiverId}) {
  const amt=money(amount);if(!positive(amt)) throw Object.assign(new Error('Payment amount must be greater than zero'),{status:400});if(!ACCOUNTS.has(account)) throw Object.assign(new Error('Choose a valid receiving account'),{status:400});
  const outstanding=money(order.total-order.paid_amount);if(amt>outstanding+0.001) throw Object.assign(new Error('Payment exceeds the outstanding amount'),{status:409});
  const p=await client.query(`INSERT INTO order_payments(order_id,amount,account,method_code,provider_code,provider_reference,status,received_by_account_id) VALUES($1,$2,$3,$4,$5,$6,'confirmed',$7) RETURNING *`,[order.id,amt,account,clean(method_code,40),clean(provider_code,80),clean(provider_reference,160),receiverId]);
  const paymentId=Number(p.rows[0].id);const paid=money(Number(order.paid_amount)+amt),remaining=money(Number(order.total)-paid),paymentStatus=remaining<=0.001?'paid':'partial';
  await client.query(`UPDATE orders SET paid_amount=$1,outstanding_amount=$2,payment_status=$3,updated_at=NOW() WHERE id=$4`,[paid,remaining,paymentStatus,order.id]);
  if(Number(order.business_id)===1){await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES('sale',$1,$2,$3,$3,$4,'order_payment',$5,NOW()) ON CONFLICT(source,source_id) WHERE source='order_payment' DO NOTHING`,[`Order ${order.order_number||order.id}`,amt,account,`Payment received for ${order.order_number||`order ${order.id}`}`,paymentId])}
  let status=order.order_status;if(paymentStatus==='paid'&&status==='awaiting_payment'){await setStatus(client,{...order,order_status:status},'accepted',receiverId,'Payment confirmed');status='accepted'}
  return {...order,paid_amount:paid,outstanding_amount:remaining,payment_status:paymentStatus,order_status:status};
}

app.get('/health',async(req,res)=>{const r=await ordersFetch('/health',{headers:req.headers});const payload=await r.json().catch(()=>({ok:false,db:false,auth:false,version:'0.5-orders'}));res.status(r.status).json(payload)});

app.get('/orders-ui.js',(_req,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','orders-ui.js'),'utf8')));
app.get('/orders.css',(_req,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','orders.css'),'utf8')));
async function proxyHtml(req,res){const r=await ordersFetch(req.path,{headers:req.headers});res.status(r.status).type('html').send(await r.text())}
app.get('/',proxyHtml);app.get('/index.html',proxyHtml);

app.get('/api/orders/products',async(req,res,next)=>{try{const businessId=Number(req.query.business_id);if(!Number.isInteger(businessId)||businessId<1)return res.status(400).json({error:'A valid business_id is required'});const{business}=await requireMerchant(req,businessId);const{rows}=await pool.query(`SELECT p.id,p.name,p.category,p.selling_price,p.active,COALESCE(SUM(r.quantity*i.unit_cost),0) unit_cost FROM products p LEFT JOIN recipes r ON r.product_id=p.id LEFT JOIN inventory i ON i.id=r.inventory_id AND i.business_id=p.business_id WHERE p.business_id=$1 AND p.active=TRUE GROUP BY p.id ORDER BY p.category,p.name`,[business.id]);res.json(rows)}catch(e){next(e)}});

app.post('/api/orders',body,async(req,res,next)=>{try{const me=await requireCustomer(req);const a=me.account;const result=await createOrder({businessId:Number(req.body?.business_id),customerAccountId:Number(a.id),customerName:a.display_name,customerContact:a.email||a.phone,items:req.body?.items,fulfilmentMethod:req.body?.fulfilment_method,paymentMethod:req.body?.payment_method,deliveryAddress:req.body?.delivery_address||a.address,note:req.body?.note,preparationEtaMinutes:req.body?.preparation_eta_minutes});res.status(201).json(result)}catch(e){next(e)}});
app.get('/api/orders/mine',async(req,res,next)=>{try{const me=await requireCustomer(req);const{rows}=await pool.query(`SELECT o.*,b.name business_name FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.customer_account_id=$1 ORDER BY o.created_at DESC LIMIT 100`,[me.account.id]);res.json(rows)}catch(e){next(e)}});
app.get('/api/orders/:id',async(req,res,next)=>{try{const me=await identity(req);const order=await orderDetail(Number(req.params.id));if(!order)return res.status(404).json({error:'Order not found'});const merchant=businessFor(me,order.business_id);if(Number(order.customer_account_id)!==Number(me.account.id)&&!merchant)return res.status(403).json({error:'Not allowed'});res.json(order)}catch(e){next(e)}});
app.post('/api/orders/:id/check-in',body,async(req,res,next)=>{try{const me=await requireCustomer(req);const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount) throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];if(Number(o.customer_account_id)!==Number(me.account.id)) throw Object.assign(new Error('Not allowed'),{status:403});if(o.order_status!=='awaiting_customer_presence') throw Object.assign(new Error('This order is not waiting for customer presence'),{status:409});await client.query(`UPDATE orders SET customer_checked_in_at=COALESCE(customer_checked_in_at,NOW()),updated_at=NOW() WHERE id=$1`,[id]);await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});

app.get('/api/orders/track/:token',async(req,res,next)=>{try{const r=await pool.query(`SELECT o.id,o.order_number,o.business_id,b.name business_name,o.fulfilment_method,o.order_status,o.payment_status,o.payment_method,o.currency_code,o.subtotal,o.delivery_fee,o.total,o.paid_amount,o.outstanding_amount,o.preparation_eta_minutes,o.accepted_at,o.preparing_at,o.expected_ready_at,o.ready_at,o.handoff_at,o.completed_at,o.created_at FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.public_token=$1`,[clean(req.params.token,100)]);if(!r.rowCount)return res.status(404).json({error:'Order not found'});const o=r.rows[0];const items=await pool.query(`SELECT name_snapshot,quantity,unit_price_snapshot,line_total FROM order_items WHERE order_id=$1 ORDER BY id`,[o.id]);res.json({...o,items:items.rows})}catch(e){next(e)}});

app.get('/api/orders/merchant/list',async(req,res,next)=>{try{const{business}=await requireMerchant(req,Number(req.query.business_id||1));const{rows}=await pool.query(`SELECT o.*,a.display_name customer_account_name FROM orders o LEFT JOIN accounts a ON a.id=o.customer_account_id WHERE o.business_id=$1 ORDER BY CASE o.order_status WHEN 'awaiting_customer_presence' THEN 1 WHEN 'awaiting_payment' THEN 2 WHEN 'accepted' THEN 3 WHEN 'preparing' THEN 4 WHEN 'ready' THEN 5 ELSE 9 END,o.created_at DESC LIMIT 200`,[business.id]);res.json(rows)}catch(e){next(e)}});
app.post('/api/orders/merchant/create',body,async(req,res,next)=>{try{const{me,business}=await requireMerchant(req,Number(req.body?.business_id||1));const customerId=req.body?.customer_account_id?Number(req.body.customer_account_id):null;let name=clean(req.body?.customer_name,120),contact=clean(req.body?.customer_contact,160);if(customerId){const c=await pool.query(`SELECT display_name,email,phone FROM accounts WHERE id=$1`,[customerId]);if(!c.rowCount)return res.status(404).json({error:'Customer account not found'});name=c.rows[0].display_name;contact=c.rows[0].email||c.rows[0].phone}const result=await createOrder({businessId:Number(business.id),customerAccountId:customerId,customerName:name||'Walk-in customer',customerContact:contact,items:req.body?.items,fulfilmentMethod:req.body?.fulfilment_method||'pickup',paymentMethod:req.body?.payment_method||'cash',deliveryAddress:req.body?.delivery_address,note:req.body?.note,preparationEtaMinutes:req.body?.preparation_eta_minutes,counterPresence:req.body?.counter_presence!==false});res.status(201).json(result)}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/confirm-presence',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(o.order_status!=='awaiting_customer_presence')throw Object.assign(new Error('Order is not waiting for presence'),{status:409});if(!o.customer_checked_in_at&&!req.body?.manual_confirmation)throw Object.assign(new Error('Customer has not checked in; use explicit manual confirmation if physically verified'),{status:409});await client.query(`UPDATE orders SET presence_confirmed_at=COALESCE(presence_confirmed_at,NOW()) WHERE id=$1`,[id]);await setStatus(client,o,'accepted',me.account.id,'Customer presence confirmed');await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/start',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});let o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(o.order_status==='awaiting_payment')throw Object.assign(new Error('Payment must be confirmed before preparation'),{status:409});if(o.order_status==='awaiting_customer_presence'&&!(o.remote_cash_eligible&&o.remote_cash_allowed))throw Object.assign(new Error('Customer presence must be confirmed before preparation'),{status:409});if(!['accepted','awaiting_customer_presence'].includes(o.order_status))throw Object.assign(new Error('Order cannot start from its current status'),{status:409});await consumeStock(client,o);o=await setStatus(client,o,'preparing',me.account.id,'Preparation started');await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/ready',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(o.order_status!=='preparing')throw Object.assign(new Error('Only a preparing order can be marked ready'),{status:409});await setStatus(client,o,'ready',me.account.id,'Order ready');await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/handoff',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(o.fulfilment_method!=='delivery'||o.order_status!=='ready')throw Object.assign(new Error('Only a ready delivery order can be handed off'),{status:409});await setStatus(client,o,'handoff_to_delivery',me.account.id,'Ready for delivery handoff');await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/payment',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);await recordPayment(client,o,{amount:req.body?.amount,account:req.body?.account,method_code:req.body?.method_code||o.payment_method,provider_code:req.body?.provider_code||'manual_merchant_confirmation',provider_reference:req.body?.provider_reference,receiverId:me.account.id});await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/complete',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(o.fulfilment_method!=='pickup'||o.order_status!=='ready')throw Object.assign(new Error('Only a ready pickup order can be completed here'),{status:409});if(Number(o.outstanding_amount)>0.001&&!req.body?.allow_credit)throw Object.assign(new Error('Record payment or explicitly leave the balance as credit'),{status:409});await setStatus(client,o,'completed',me.account.id,req.body?.allow_credit?'Completed with receivable':'Collected');const done=await client.query(`SELECT o.completed_at,b.territory_id FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1`,[o.id]);await recordMonetizableCompletion(client,{serviceScope:'marketplace',subjectType:'business',subjectId:o.business_id,sourceType:'order',sourceId:o.id,territoryId:done.rows[0]?.territory_id,completedAt:done.rows[0]?.completed_at,grossValue:o.subtotal,currencyCode:o.currency_code||'PHP'});await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/orders/merchant/:id/cancel',body,async(req,res,next)=>{try{const id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(['completed','cancelled'].includes(o.order_status))throw Object.assign(new Error('Order can no longer be cancelled'),{status:409});await reverseStock(client,o);await client.query(`UPDATE orders SET cancellation_reason=$1 WHERE id=$2`,[clean(req.body?.reason,300),id]);await setStatus(client,o,'cancelled',me.account.id,clean(req.body?.reason,300)||'Cancelled');await client.query('COMMIT');res.json(await orderDetail(id))}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}catch(e){next(e)}});
app.get('/api/orders/merchant/customers/:customerId/trust',async(req,res,next)=>{try{const customerId=Number(req.params.customerId);const{business}=await requireMerchant(req,Number(req.query.business_id||1));res.json(await trustInfo(Number(business.id),customerId))}catch(e){next(e)}});
app.put('/api/orders/merchant/customers/:customerId/trust',body,async(req,res,next)=>{try{const customerId=Number(req.params.customerId);const{business}=await requireMerchant(req,Number(req.body?.business_id||1));const info=await trustInfo(Number(business.id),customerId);const allow=Boolean(req.body?.allow_remote_cash_prep);if(allow&&!info.eligible) return res.status(409).json({error:'Customer needs 5 successful completed orders with this Merchant before remote cash preparation can be enabled.',completed_orders:info.completed_orders});await pool.query(`INSERT INTO merchant_customer_settings(business_id,customer_account_id,allow_remote_cash_prep,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(business_id,customer_account_id) DO UPDATE SET allow_remote_cash_prep=EXCLUDED.allow_remote_cash_prep,updated_at=NOW()`,[business.id,customerId,allow]);res.json(await trustInfo(Number(business.id),customerId))}catch(e){next(e)}});

function proxy(req,res,next){
  if(!authApp)return res.status(503).json({error:'Account/Auth runtime is not ready'});
  return authApp(req,res,next);
}
app.use(proxy);

app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;const body={error:err.status?err.message:'Unexpected server error'};if(err.shortages)body.shortages=err.shortages;res.status(err.status||500).json(body)});

let embeddedStartPromise=null;
export async function startEmbeddedOrders(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      authApp=await startEmbeddedAccountAuth();
      authReady=true;
      await initDb();
      console.log('Business & Life Orders mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}
async function stopOrders(){
  if(shuttingDown)return;
  shuttingDown=true;
  authReady=false;
  await stopEmbeddedAccountAuth().catch(()=>{});
  authApp=null;
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedOrders(){await stopOrders()}
async function shutdown(signal){console.log(`Received ${signal}`);await stopOrders();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedOrders()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life order server listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
