import express from 'express';
import pg from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {deliveryFetch,startEmbeddedDelivery,stopEmbeddedDelivery} from './server-delivery.js';
import {readOrderDetail} from './orders-read-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '600kb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
const ACCOUNTS = new Set(['cash','gcash','bank','other']);
let deliveryApp=null;
let deliveryReady=false;
let shuttingDown = false;

function clean(v,max=300){ return String(v??'').trim().slice(0,max); }
function money(v){ return Math.round((Number(v)+Number.EPSILON)*100)/100; }
function authHeader(req){ return req.headers.authorization || ''; }
async function downstreamFetch(path,options={}){return deliveryFetch(path,options)}
export function isDeliveryFinanceOwnedPath(path='',method='GET'){
  const pathname=String(path||'').split('?')[0];
  const verb=String(method||'GET').toUpperCase();
  return (verb==='PUT'&&pathname==='/api/courier/delivery-profile')
    ||(verb==='POST'&&/^\/api\/orders\/merchant\/[^/]+\/payment$/.test(pathname));
}
export async function deliveryFinanceFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  const method=String(options.method||'GET').toUpperCase();
  if(isDeliveryFinanceOwnedPath(pathname,method)){
    throw Object.assign(new Error('Delivery Finance-owned paths require in-process dispatch'),{
      status:500,code:'DELIVERY_FINANCE_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const delivery=await downstreamFetch('/health',{headers:options.headers||{}});
      const ok=deliveryReady&&delivery.ok;
      return new Response(JSON.stringify({ok,db:true,delivery:ok,version:'0.8.3-delivery-finance'}),{
        status:ok?200:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,delivery:false,version:'0.8.3-delivery-finance'}),{
        status:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  return downstreamFetch(path,options);
}
async function identity(req){
  const r=await downstreamFetch('/api/me',{headers:{Authorization:authHeader(req)}});
  const b=await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});
  return b;
}
function enabled(me,role){ return me?.profiles?.some(p=>p.role===role&&p.enabled); }
function business(me,id){ return (me?.businesses||[]).find(b=>Number(b.id)===Number(id)&&b.active!==false)||null; }
function optionalNonNegative(v,label){if(v===''||v==null)return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw Object.assign(new Error(`${label} must be zero or greater`),{status:400});return n}

async function ensureFinanceDb(){
  await pool.query(`
    ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS merchandise_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS delivery_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
    UPDATE order_payments p
       SET merchandise_amount=p.amount
      FROM orders o
     WHERE p.order_id=o.id
       AND COALESCE(p.merchandise_amount,0)=0
       AND COALESCE(p.delivery_amount,0)=0
       AND COALESCE(o.delivery_fee,0)=0;
  `);
}

app.get('/health',async(req,res)=>{
  const r=await deliveryFinanceFetch('/health',{headers:req.headers});
  const payload=await r.json().catch(()=>({ok:false,db:false,delivery:false,version:'0.8.3-delivery-finance'}));
  res.status(r.status).json(payload);
});

app.put('/api/courier/delivery-profile',body,async(req,res,next)=>{
  try{
    const me=await identity(req);
    if(!enabled(me,'courier')) throw Object.assign(new Error('Delivery profile required'),{status:403});
    const vehicle=clean(req.body?.vehicle_type,40);
    const weight=optionalNonNegative(req.body?.max_weight_kg,'Max weight');
    const volume=optionalNonNegative(req.body?.max_volume_l,'Max volume');
    const radius=optionalNonNegative(req.body?.service_radius_km,'Service radius');
    const q=await pool.query(`UPDATE courier_profiles SET vehicle_type=$1,max_weight_kg=$2,max_volume_l=$3,service_radius_km=$4,updated_at=NOW() WHERE account_id=$5 RETURNING *`,[vehicle,weight,volume,radius,me.account.id]);
    if(!q.rowCount) return res.status(404).json({error:'Courier profile missing'});
    res.json(q.rows[0]);
  }catch(e){next(e)}
});

// Standalone rollback compatibility only. In the composed runtime the public payment path is owned by Payment Core -> Notifications -> Multi-business Accounting before requests can reach Delivery Finance.
app.post('/api/orders/merchant/:id/payment',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await identity(req);
    if(!enabled(me,'merchant')) throw Object.assign(new Error('Merchant profile required'),{status:403});
    await client.query('BEGIN');
    const q=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[Number(req.params.id)]);
    if(!q.rowCount) throw Object.assign(new Error('Order not found'),{status:404});
    const order=q.rows[0];
    if(!business(me,order.business_id)) throw Object.assign(new Error('Business workspace unavailable'),{status:403});

    const amount=money(req.body?.amount);
    const account=clean(req.body?.account,30);
    if(!Number.isFinite(amount)||amount<=0) throw Object.assign(new Error('Payment amount must be greater than zero'),{status:400});
    if(!ACCOUNTS.has(account)) throw Object.assign(new Error('Choose a valid receiving account'),{status:400});
    const outstanding=money(Number(order.total)-Number(order.paid_amount));
    if(amount>outstanding+0.001) throw Object.assign(new Error('Payment exceeds the outstanding amount'),{status:409});

    const allocated=await client.query(`SELECT COALESCE(SUM(merchandise_amount),0) merchandise,COALESCE(SUM(delivery_amount),0) delivery FROM order_payments WHERE order_id=$1 AND status='confirmed'`,[order.id]);
    const merchandiseRemaining=Math.max(0,money(Number(order.subtotal)-Number(allocated.rows[0].merchandise)));
    const deliveryRemaining=Math.max(0,money(Number(order.delivery_fee)-Number(allocated.rows[0].delivery)));
    const merchandiseAmount=money(Math.min(amount,merchandiseRemaining));
    const deliveryAmount=money(Math.min(amount-merchandiseAmount,deliveryRemaining));
    if(money(merchandiseAmount+deliveryAmount)!==amount) throw Object.assign(new Error('Payment allocation does not match order balance'),{status:409});

    const payment=await client.query(`INSERT INTO order_payments(order_id,amount,merchandise_amount,delivery_amount,account,method_code,provider_code,provider_reference,status,received_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9) RETURNING *`,[
      order.id,amount,merchandiseAmount,deliveryAmount,account,
      clean(req.body?.method_code||order.payment_method,40),
      clean(req.body?.provider_code||'manual_merchant_confirmation',80),
      clean(req.body?.provider_reference,160),
      me.account.id
    ]);
    const paymentId=Number(payment.rows[0].id);
    const paid=money(Number(order.paid_amount)+amount);
    const remaining=money(Number(order.total)-paid);
    const paymentStatus=remaining<=0.001?'paid':'partial';
    await client.query(`UPDATE orders SET paid_amount=$1,outstanding_amount=$2,payment_status=$3,updated_at=NOW() WHERE id=$4`,[paid,remaining,paymentStatus,order.id]);

    if(Number(order.business_id)===1 && merchandiseAmount>0){
      await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES('sale',$1,$2,$3,$3,$4,'order_payment',$5,NOW()) ON CONFLICT(source,source_id) WHERE source='order_payment' DO NOTHING`,[
        `Order ${order.order_number||order.id}`,merchandiseAmount,account,
        `Merchandise payment received for ${order.order_number||`order ${order.id}`}`,paymentId
      ]);
    }
    if(deliveryAmount>0){
      const d=await client.query(`SELECT id FROM deliveries WHERE order_id=$1`,[order.id]);
      await client.query(`INSERT INTO delivery_financial_events(order_id,delivery_id,event_type,amount,currency_code,source_payment_id) VALUES($1,$2,'delivery_fee_received',$3,$4,$5) ON CONFLICT(event_type,source_payment_id) DO NOTHING`,[
        order.id,d.rows[0]?.id||null,deliveryAmount,order.currency_code||'PHP',paymentId
      ]);
    }
    if(paymentStatus==='paid'&&order.order_status==='awaiting_payment'){
      await client.query(`UPDATE orders SET order_status='accepted',accepted_at=COALESCE(accepted_at,NOW()),updated_at=NOW() WHERE id=$1`,[order.id]);
      await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,'awaiting_payment','accepted',$2,'Payment confirmed')`,[order.id,me.account.id]);
    }
    await client.query('COMMIT');
    const detail=await readOrderDetail(pool,order.id);
    if(!detail)throw Object.assign(new Error('Order detail unavailable after payment'),{status:500});
    res.json(detail);
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{
    client.release();
  }
});

function proxy(req,res,next){
  if(!deliveryApp)return res.status(503).json({error:'Delivery runtime is not ready'});
  return deliveryApp(req,res,next);
}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'});});

let embeddedStartPromise=null;
export async function startEmbeddedDeliveryFinance(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      deliveryApp=await startEmbeddedDelivery();
      deliveryReady=true;
      await ensureFinanceDb();
      console.log('Business & Life delivery finance mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopDeliveryFinance(){
  if(shuttingDown)return;
  shuttingDown=true;
  deliveryReady=false;
  deliveryApp=null;
  await stopEmbeddedDelivery().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedDeliveryFinance(){await stopDeliveryFinance()}

async function shutdown(sig){
  console.log(`Received ${sig}`);
  await stopDeliveryFinance();
  process.exit(0);
}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedDeliveryFinance()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life delivery finance gateway listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
