import express from 'express';
import pg from 'pg';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensurePaymentSchema,backfillLegacyOrderPayments,createOrderPaymentIntent,paymentIntentDetail,
  createFeePolicy,addFeeRule,feePolicyOverview,createRefundRequest,createReconciliationRun,
  paymentFinanceOverview,mirrorConfirmedOrderPayment
} from './payment-core.js';
import { requireAdminPermission,appendAdminAudit } from './admin-authorization.js';

const {Pool}=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const upstreamPort=Number(process.env.INTERNAL_LEGAL_PORT||4507);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const body=express.json({limit:'30mb'});
let child;let shuttingDown=false;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||crypto.randomUUID(),120);
async function upstream(path,options={}){return fetch('http://127.0.0.1:'+upstreamPort+path,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
async function forwardJson(req,res,after){
  const r=await upstream(req.originalUrl,{method:req.method,headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body??{})});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
  if(r.ok&&after)Promise.resolve().then(()=>after(data)).catch(e=>console.error('Payment mirror hook:',e.message));
  res.status(r.status);const ct=r.headers.get('content-type');if(ct)res.type(ct);res.send(text);
}
async function canSeeIntent(me,intent){
  if(Number(intent.payer_account_id)===Number(me.account.id))return true;
  if((me.businesses||[]).some(b=>Number(b.id)===Number(intent.business_id)&&b.active!==false))return true;
  try{await requireAdminPermission(pool,me.account.id,'payment.view',intent.territory_id);return true}catch{return false}
}
async function initDb(){await ensurePaymentSchema(pool);await backfillLegacyOrderPayments(pool)}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const childAlive=Boolean(child&&!child.killed&&child.exitCode==null);res.status(childAlive?200:503).json({ok:childAlive,db:true,legal:childAlive,payments:true,version:'0.13-payment-core'})}catch{res.status(503).json({ok:false,db:false,legal:false,payments:false,version:'0.13-payment-core'})}});
app.get('/payments.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','payments.css'),'utf8')));
app.get('/payments-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','payments-ui.js'),'utf8')));
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:'127.0.0.1:'+upstreamPort}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/payments.css" />\n</head>').replace('</body>','  <script type="module" src="/payments-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root);

app.get('/api/payments/config',async(req,res,next)=>{try{
  await identity(req);
  const q=await pool.query("SELECT provider_code,display_name,adapter_version,status,supported_methods,ledger_account FROM payment_provider_configs WHERE country_code='PH' ORDER BY provider_code");
  const defaultProvider=clean(process.env.PAYMENT_PROVIDER_DEFAULT,80);
  const selected=q.rows.find(x=>x.provider_code===defaultProvider&&['sandbox','active'].includes(x.status))||null;
  res.json({country_code:'PH',currency_code:'PHP',default_provider:defaultProvider,provider_ready:Boolean(selected),selected_provider:selected,providers:q.rows,authority:'server_webhook_only'});
}catch(e){next(e)}});

app.get('/api/payments/open-orders',async(req,res,next)=>{try{
  const me=await identity(req);
  const q=await pool.query("SELECT o.id,o.order_number,o.business_id,b.name business_name,o.total,o.paid_amount,o.outstanding_amount,o.payment_method,o.payment_status,o.order_status,o.currency_code,o.created_at FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.customer_account_id=$1 AND o.payment_method='online' AND o.outstanding_amount>0 AND o.order_status<>'cancelled' ORDER BY o.created_at DESC LIMIT 100",[me.account.id]);
  res.json(q.rows);
}catch(e){next(e)}});

app.post('/api/payments/intents/order/:id',body,async(req,res,next)=>{try{
  const me=await identity(req);
  const idempotency=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const provider=clean(req.body?.provider_code||process.env.PAYMENT_PROVIDER_DEFAULT,80);
  const intent=await createOrderPaymentIntent(pool,{orderId:Number(req.params.id),payerAccountId:Number(me.account.id),idempotencyKey:idempotency,logicalMethod:req.body?.logical_method||'online_other',providerCode:provider,clientReference:req.body?.client_reference||''});
  res.status(201).json({...intent,provider_ready:intent.status!=='requires_provider',next_action:intent.status==='requires_provider'?'CONNECT_REAL_PAYMENT_PROVIDER':'PROVIDER_ADAPTER_REQUIRED'});
}catch(e){next(e)}});

app.get('/api/payments/intents/:id',async(req,res,next)=>{try{
  const me=await identity(req),intent=await paymentIntentDetail(pool,req.params.id);
  if(!intent)return res.status(404).json({error:'Payment intent not found'});
  if(!await canSeeIntent(me,intent))return res.status(403).json({error:'Payment intent is outside your authorized scope'});
  res.json(intent);
}catch(e){next(e)}});

app.get('/api/payments/mine',async(req,res,next)=>{try{
  const me=await identity(req);
  const q=await pool.query("SELECT id,public_id,source_type,source_id,provider_code,logical_method,currency_code,amount,status,provider_status,created_at,updated_at FROM payment_intents WHERE payer_account_id=$1 ORDER BY created_at DESC LIMIT 150",[me.account.id]);
  res.json(q.rows);
}catch(e){next(e)}});

app.post('/api/payments/webhooks/:provider',body,async(req,res)=>res.status(501).json({
  error:'No verified payment-provider adapter is installed for this provider',
  code:'PAYMENT_PROVIDER_ADAPTER_REQUIRED',
  provider:clean(req.params.provider,80),
  note:'Client success pages are never payment authority. A signed provider webhook adapter must be implemented first.'
}));

app.get('/api/payments/admin/overview',async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'payment.view');
  res.json(await paymentFinanceOverview(pool));
}catch(e){next(e)}});

app.get('/api/payments/admin/fee-policies',async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'payment.view');
  res.json(await feePolicyOverview(pool));
}catch(e){next(e)}});

app.post('/api/payments/admin/providers',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
  const code=clean(req.body?.provider_code,80),name=clean(req.body?.display_name,160);
  if(!code||!name)return res.status(400).json({error:'Provider code and display name are required'});
  const methods=Array.isArray(req.body?.supported_methods)?req.body.supported_methods.map(x=>clean(x,50)).filter(Boolean).slice(0,20):[];
  const account=['gcash','bank','other'].includes(req.body?.ledger_account)?req.body.ledger_account:'other';
  const q=await pool.query("INSERT INTO payment_provider_configs(provider_code,display_name,adapter_version,status,country_code,supported_methods,ledger_account,config_metadata) VALUES($1,$2,'adapter_required','disabled','PH',$3::jsonb,$4,$5::jsonb) ON CONFLICT(provider_code) DO UPDATE SET display_name=EXCLUDED.display_name,supported_methods=EXCLUDED.supported_methods,ledger_account=EXCLUDED.ledger_account,updated_at=NOW() RETURNING id,provider_code,display_name,adapter_version,status,supported_methods,ledger_account",[
    code,name,JSON.stringify(methods),account,JSON.stringify({note:'Credentials must live in Railway/provider secret storage, never this table'})
  ]);
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',targetType:'payment_provider_config',targetId:String(q.rows[0].id),eventCode:'payment_provider_metadata_registered',after:q.rows[0],reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(q.rows[0]);
}catch(e){next(e)}});

app.post('/api/payments/admin/fee-policies',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'fee_policy.manage_limited');
  const policy=await createFeePolicy(pool,{policyCode:req.body?.policy_code,version:req.body?.version,serviceScope:req.body?.service_scope||'marketplace',territoryId:req.body?.territory_id?Number(req.body.territory_id):null,businessId:req.body?.business_id?Number(req.body.business_id):null,description:req.body?.description||'',createdBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'fee_policy.manage_limited',territoryId:policy.territory_id,targetType:'fee_policy',targetId:String(policy.id),eventCode:'fee_policy_draft_created',after:{policy_code:policy.policy_code,version:policy.version,status:policy.status},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(policy);
}catch(e){next(e)}});

app.post('/api/payments/admin/fee-policies/:id/rules',body,async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'fee_policy.manage_limited');
  const p=await pool.query("SELECT * FROM fee_policy_versions WHERE id=$1",[Number(req.params.id)]);
  if(!p.rowCount)return res.status(404).json({error:'Fee policy not found'});
  if(p.rows[0].status!=='draft')return res.status(409).json({error:'Only draft fee policies can be edited'});
  const rule=await addFeeRule(pool,Number(req.params.id),req.body||{});res.status(201).json(rule);
}catch(e){next(e)}});

app.post('/api/payments/admin/refunds',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
  const row=await createRefundRequest(pool,{intentId:req.body?.payment_intent_id||req.body?.payment_intent,amount:req.body?.amount,reason:req.body?.reason||'',requestedBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',targetType:'refund',targetId:String(row.id),eventCode:'refund_requested_provider_action_required',after:{amount:row.amount,status:row.status},reason:row.reason,correlationId:correlation(req)});
  res.status(201).json({...row,next_action:'PROVIDER_REFUND_ADAPTER_REQUIRED'});
}catch(e){next(e)}});

app.post('/api/payments/admin/reconciliation',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.reconcile');
  const row=await createReconciliationRun(pool,{providerCode:req.body?.provider_code,periodStart:req.body?.period_start,periodEnd:req.body?.period_end,statement:req.body?.statement_text||'',startedBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.reconcile',targetType:'reconciliation_run',targetId:String(row.id),eventCode:'reconciliation_run_created',after:{provider_code:row.provider_code,status:row.status,internal_payment_total:row.internal_payment_total},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/orders/merchant/:id/payment',body,(req,res)=>forwardJson(req,res,async()=>{
  const q=await pool.query("SELECT id FROM order_payments WHERE order_id=$1 AND status='confirmed' ORDER BY id DESC LIMIT 1",[Number(req.params.id)]);
  if(q.rowCount)await mirrorConfirmedOrderPayment(pool,Number(q.rows[0].id));
}));

function proxy(req,res){const headers={...req.headers,host:'127.0.0.1:'+upstreamPort};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Payment upstream unavailable'})});req.pipe(up)}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected payment-core error'})});

function start(){child=spawn(process.execPath,['server-legal.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error('Legal child exited '+code);process.exit(code||1)}})}
async function wait(){for(let i=0;i<380;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Legal child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log('Received '+sig);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log('Business & Life payment core gateway listening on '+port))).catch(e=>{console.error(e);process.exit(1)});
