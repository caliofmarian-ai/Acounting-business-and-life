import express from 'express';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensurePayMongoSchema,payMongoRuntimeConfig,createPayMongoCheckout,
  processPayMongoWebhook,executePayMongoRefund,ensurePayMongoWebhook,payMongoWebhookBootstrapStatus
} from './paymongo-adapter.js';
import { requireAdminPermission,appendAdminAudit } from './admin-authorization.js';
import { emitNotificationEvent,businessNotificationRecipients } from './notification-core.js';

const {Pool}=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const upstreamPort=Number(process.env.INTERNAL_PAYMENTS_PORT||4607);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const body=express.json({limit:'30mb'});
let child;let shuttingDown=false;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||'',120);
async function upstream(path,options={}){return fetch('http://127.0.0.1:'+upstreamPort+path,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}

async function notifyPaymentConfirmed(result){
  if(!result?.ok||!result?.order_id||!result?.payment_id||result.duplicate)return;
  const q=await pool.query("SELECT o.id,o.order_number,o.customer_account_id,o.business_id,b.name business_name FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1",[Number(result.order_id)]);
  if(!q.rowCount)return;
  const o=q.rows[0],recipients=[];
  if(o.customer_account_id)recipients.push({accountId:Number(o.customer_account_id),roleHint:'customer'});
  recipients.push(...await businessNotificationRecipients(pool,o.business_id,'merchant'));
  await emitNotificationEvent(pool,{
    eventKey:'order:'+o.id+':paymongo:'+result.payment_id,
    eventCode:'order.payment_confirmed',
    sourceService:'paymongo',
    entityType:'order',
    entityId:String(o.id),
    correlationId:'paymongo:'+result.payment_id,
    category:'operational',
    priority:'high',
    emailDefault:false,
    pushDefault:true,
    data:{order_number:o.order_number||o.id,business_name:o.business_name||''},
    recipients
  }).catch(e=>console.error('PayMongo payment notification:',e.message));
}

app.post('/api/payments/webhooks/paymongo',express.raw({type:'application/json',limit:'2mb'}),async(req,res)=>{
  try{
    const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||'');
    const result=await processPayMongoWebhook(pool,{rawBody:raw,signatureHeader:req.headers['paymongo-signature']||''});
    await notifyPaymentConfirmed(result);
    if(result.manual_review)return res.status(202).json({ok:true,processing_status:'manual_review',reason:result.reason});
    return res.status(200).json({ok:true,duplicate:Boolean(result.duplicate),ignored:Boolean(result.ignored)});
  }catch(e){
    console.error('PayMongo webhook:',e.message);
    return res.status(e.status||500).json({error:e.status?e.message:'PayMongo webhook processing failed',code:e.code||'PAYMONGO_WEBHOOK_ERROR'});
  }
});

app.use(body);

const railwayServiceName=clean(process.env.RAILWAY_SERVICE_NAME||'',120);
const pwaInstallAllowed=process.env.PWA_INSTALL_ALLOWED==='1'||!railwayServiceName||railwayServiceName==='accounting-business-life';
async function servePwaAsset(req,res,path,type){
  if(!pwaInstallAllowed)return res.status(404).type('text/plain').send('PWA installation is disabled on preview services.');
  const r=await upstream(path,{headers:{...req.headers,host:'127.0.0.1:'+upstreamPort}});
  const body=await r.arrayBuffer();
  res.status(r.status);
  if(type)res.type(type);
  if(path==='/sw.js')res.setHeader('Cache-Control','no-store, max-age=0');
  res.send(Buffer.from(body));
}
app.get('/manifest.webmanifest',(req,res,next)=>servePwaAsset(req,res,'/manifest.webmanifest','application/manifest+json').catch(next));
app.get('/sw.js',(req,res,next)=>servePwaAsset(req,res,'/sw.js','application/javascript').catch(next));

app.get('/health',async(_req,res)=>{
  try{
    await pool.query('SELECT 1');
    const childAlive=Boolean(child&&!child.killed&&child.exitCode==null);
    const cfg=payMongoRuntimeConfig();
    res.status(childAlive?200:503).json({
      ok:childAlive,db:true,payment_core:childAlive,paymongo:true,
      paymongo_mode:cfg.mode,paymongo_secret_ready:cfg.secretReady,paymongo_webhook_ready:cfg.webhookReady,
      version:'0.15-paymongo-webhook-bootstrap'
    });
  }catch{res.status(503).json({ok:false,db:false,payment_core:false,paymongo:false,version:'0.15-paymongo-webhook-bootstrap'})}
});

app.get('/api/payments/paymongo/status',async(req,res,next)=>{
  try{
    await identity(req);
    const cfg=payMongoRuntimeConfig();
    const p=await pool.query("SELECT provider_code,display_name,adapter_version,status,supported_methods,ledger_account,config_metadata,updated_at FROM payment_provider_configs WHERE provider_code='paymongo'");
    const bootstrap=payMongoWebhookBootstrapStatus();
    res.json({
      provider:'paymongo',mode:cfg.mode,secret_ready:cfg.secretReady,webhook_ready:cfg.webhookReady,
      live_enabled:cfg.liveAllowed,methods:cfg.methods,ready:Boolean(cfg.secretReady&&cfg.webhookReady),
      webhook:{id:bootstrap.id,url:bootstrap.url,status:bootstrap.status,source:bootstrap.source,updated_at:bootstrap.updated_at,error:bootstrap.error},
      configuration:p.rows[0]||null
    });
  }catch(e){next(e)}
});

app.post('/api/payments/paymongo/checkout/:intent',async(req,res,next)=>{
  try{
    const me=await identity(req);
    const result=await createPayMongoCheckout(pool,{intentPublicId:req.params.intent,accountId:Number(me.account.id)});
    res.status(result.already_paid?200:201).json(result);
  }catch(e){next(e)}
});

app.post('/api/payments/admin/paymongo/webhook/bootstrap',async(req,res,next)=>{
  try{
    const me=await identity(req);
    const assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
    const state=await ensurePayMongoWebhook(pool,{force:true});
    await appendAdminAudit(pool,{
      actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',
      targetType:'payment_provider_config',targetId:'paymongo',eventCode:'paymongo_webhook_bootstrap',
      after:{id:state.id,url:state.url,status:state.status,source:state.source,ready:state.ready,error:state.error},
      reason:'PayMongo webhook bootstrap/retry',correlationId:correlation(req)
    });
    res.status(state.ready?200:503).json(state);
  }catch(e){next(e)}
});

app.post('/api/payments/admin/paymongo/refunds/:id/execute',async(req,res,next)=>{
  try{
    const me=await identity(req);
    const assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
    const refund=await executePayMongoRefund(pool,{refundId:Number(req.params.id),actorAccountId:Number(me.account.id)});
    await appendAdminAudit(pool,{
      actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',
      targetType:'refund',targetId:String(refund.id),eventCode:'paymongo_refund_executed',
      after:{provider_refund_id:refund.provider_refund_id,status:refund.status,amount:refund.amount},
      reason:refund.reason||'',correlationId:correlation(req)
    });
    res.json(refund);
  }catch(e){next(e)}
});

function proxy(req,res){
  const parsedJsonBody=req.body!==undefined&&!['GET','HEAD'].includes(req.method)&&Boolean(req.is('application/json'));
  const payload=parsedJsonBody?Buffer.from(JSON.stringify(req.body??{})):null;
  const headers={...req.headers,host:'127.0.0.1:'+upstreamPort};
  if(payload){
    headers['content-length']=String(payload.length);
    delete headers['transfer-encoding'];
  }
  const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{
    res.statusCode=ur.statusCode||502;
    for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);
    ur.pipe(res);
  });
  up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Payment Core upstream unavailable'})});
  if(payload)up.end(payload);else req.pipe(up);
}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected PayMongo adapter error',code:err.code||undefined})});

async function initDb(){
  await ensurePayMongoSchema(pool);
  const state=await ensurePayMongoWebhook(pool);
  if(state.ready)console.log('PayMongo webhook ready: '+state.status+' via '+state.source);
  else console.log('PayMongo webhook not ready: '+state.status+(state.error?' ('+state.error+')':''));
}
function start(){
  child=spawn(process.execPath,['server-payments.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});
  child.on('exit',code=>{if(!shuttingDown){console.error('Payment Core child exited '+code);process.exit(code||1)}});
}
async function wait(){
  for(let i=0;i<420;i++){
    try{const r=await upstream('/health');if(r.ok)return}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Payment Core child failed health check');
}
async function shutdown(sig){
  if(shuttingDown)return;shuttingDown=true;console.log('Received '+sig);
  if(child&&!child.killed)child.kill('SIGTERM');
  await pool.end().catch(()=>{});
  process.exit(0);
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
start();
wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log('Business & Life PayMongo webhook-bootstrap gateway listening on '+port))).catch(e=>{console.error(e);process.exit(1)});
