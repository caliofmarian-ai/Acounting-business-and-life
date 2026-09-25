import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureNotificationSchema,emitNotificationEvent,businessNotificationRecipients,
  adminNotificationRecipients,processNotificationDeliveries,renderNotification,
  normalizeNotificationLocale,notificationAttentionPreference,saveNotificationAttentionPreference,
  notificationSoundPreferences,saveNotificationSoundPreference
} from './notification-core.js';
import { DEFAULT_NOTIFICATION_SOUND_VARIANT,notificationSoundVariants,notificationSoundSlots } from './notification-sound-options.js';
import { notificationAudioConfigured,notificationAudioDescriptor,presignNotificationAudioUrl } from './notification-audio-core.js';
import { notificationVoiceTranscriptMatrix } from './notification-voice-copy.js';
import { verifyResendWebhook,recordResendProviderEvent } from './resend-delivery-observability.js';
import { bootstrapResendWebhook,resendWebhookReadiness } from './resend-webhook-bootstrap.js';
import { startEmbeddedAdminOperations,stopEmbeddedAdminOperations } from './server-admin-operations.js';
import {authHardeningFetch} from './server-auth-hardening.js';

const {Pool}=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const jsonBody=express.json({limit:'30mb'});
const body=(req,res,next)=>req.body!==undefined?next():jsonBody(req,res,next);
const CATEGORIES=['operational','security','legal','support','compliance','marketing'];
const THREAD_ENTITY_TYPES=new Set(['support_ticket','order','delivery','purchase_order','service_job']);
const isNotificationThreadEntity=(type,id)=>Boolean(String(id??'').trim())&&THREAD_ENTITY_TYPES.has(String(type||''));
let adminApp=null;let adminReady=false;let shuttingDown=false;let workerTimer=null;let workerRunning=false;
let resendWebhookRuntime={ready:Boolean(process.env.RESEND_WEBHOOK_SECRET),status:process.env.RESEND_WEBHOOK_SECRET?'ready':'not_ready',source:process.env.RESEND_WEBHOOK_SECRET?'env':'none',endpoint:'',webhook_id:'',secret:process.env.RESEND_WEBHOOK_SECRET||''};

const clean=(v,max=1200)=>String(v??'').trim().slice(0,max);
const positiveId=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null};
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||crypto.randomUUID(),120);
async function upstream(path,options={}){return authHardeningFetch(path,options)}
export function isNotificationsOwnedPath(path=''){
  const pathname=String(path||'').split('?')[0];
  return pathname==='/notifications.css'
    ||pathname==='/notifications-ui.js'
    ||pathname==='/notifications-sw.js'
    ||pathname==='/manifest.webmanifest'
    ||pathname.startsWith('/api/notifications/');
}
export async function notificationsFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  if(isNotificationsOwnedPath(pathname)){
    throw Object.assign(new Error('Notifications-owned paths require in-process Notifications dispatch'),{
      status:500,code:'NOTIFICATIONS_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const ok=adminReady;
      return new Response(JSON.stringify({
        ok,db:true,admin_support:ok,notifications:true,
        resend_webhook:resendWebhookReadiness(resendWebhookRuntime),
        version:'0.16-notifications'
      }),{status:ok?200:503,headers:{'content-type':'application/json; charset=utf-8'}});
    }catch{
      return new Response(JSON.stringify({
        ok:false,db:false,admin_support:false,notifications:false,
        resend_webhook:resendWebhookReadiness(resendWebhookRuntime),
        version:'0.16-notifications'
      }),{status:503,headers:{'content-type':'application/json; charset=utf-8'}});
    }
  }
  if(pathname==='/'||pathname==='/index.html'){
    const r=await upstream(path,options);
    let html=await r.text();
    html=html.replace('</head>','  <link rel="stylesheet" href="/help-linking.css" />\n  <link rel="manifest" href="/manifest.webmanifest" />\n  <link rel="stylesheet" href="/notifications.css" />\n</head>')
      .replace('</body>','  <script src="/help-linking.js"></script>\n  <script type="module" src="/notifications-ui.js"></script>\n</body>');
    return new Response(html,{status:r.status,headers:{'content-type':'text/html; charset=utf-8'}});
  }
  return upstream(path,options);
}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
const uniqueRecipients=(...groups)=>[...new Map(groups.flat().filter(Boolean).map(x=>[Number(x.accountId),x])).values()];
async function safeEmit(spec){try{return await emitNotificationEvent(pool,spec)}catch(e){console.error('Notification event failed:',e.message);return null}}

async function orderInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT o.*,b.name business_name FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1`,[key]);
  return q.rows[0]||null;
}
async function deliveryInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT d.*,o.order_number,o.customer_account_id,o.business_id,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=o.business_id WHERE d.id=$1`,[key]);
  return q.rows[0]||null;
}
async function poInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT p.*,b.name business_name,COALESCE(s.supplier_name,a.display_name) supplier_name FROM purchase_orders p JOIN businesses b ON b.id=p.business_id JOIN accounts a ON a.id=p.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=p.supplier_account_id WHERE p.id=$1`,[key]);
  return q.rows[0]||null;
}
async function serviceJobInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT j.*,c.name service_label FROM service_jobs j LEFT JOIN service_categories c ON c.id=j.category_id WHERE j.id=$1`,[key]);
  return q.rows[0]||null;
}
async function supportInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[key]);return q.rows[0]||null;
}
async function incidentInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT * FROM incident_reports WHERE id=$1`,[key]);return q.rows[0]||null;
}
async function applicationInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT * FROM profile_applications WHERE id=$1`,[key]);return q.rows[0]||null;
}
async function authorizationInfo(id){
  const key=positiveId(id);if(!key)return null;
  const q=await pool.query(`SELECT * FROM profile_authorizations WHERE id=$1`,[key]);return q.rows[0]||null;
}

async function forwardJson(req,res,after){
  if(!adminApp)return res.status(503).json({error:'Admin + Support runtime is not ready'});
  const notificationParams={...req.params};
  const chunks=[];let observedBytes=0;let completed=false;
  const capture=chunk=>{
    if(!after||chunk==null||observedBytes>=2_000_000)return;
    const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk));
    observedBytes+=part.length;
    if(observedBytes<=2_000_000)chunks.push(part);
  };
  const originalWrite=res.write.bind(res),originalEnd=res.end.bind(res);
  const restore=()=>{res.write=originalWrite;res.end=originalEnd};
  const finishHook=()=>{
    if(completed)return;completed=true;
    if(!after||res.statusCode<200||res.statusCode>=400)return;
    const text=Buffer.concat(chunks).toString('utf8');let data={};try{data=text?JSON.parse(text):{}}catch{}
    req.params=notificationParams;
    Promise.resolve().then(()=>after(data)).catch(e=>console.error('Post-transaction notification hook:',e.message));
  };
  res.write=function(chunk,...args){capture(chunk);return originalWrite(chunk,...args)};
  res.end=function(chunk,...args){capture(chunk);restore();const out=originalEnd(chunk,...args);finishHook();return out};
  adminApp.handle(req,res,err=>{
    restore();
    if(res.writableEnded)return;
    if(err){console.error(err);return res.status(err.status||500).json({error:err.status?err.message:'Unexpected Admin + Support error'})}
    if(!res.headersSent)res.status(502).json({error:'Admin + Support runtime did not handle request'});
  });
}

async function emitOrderEvent(req,id,eventCode,{merchant=false,customer=true,emailDefault=false,pushDefault=true,priority='normal'}={}){
  const o=await orderInfo(id);if(!o)return;
  const recipients=[];
  if(customer&&o.customer_account_id)recipients.push({accountId:Number(o.customer_account_id),roleHint:'customer'});
  if(merchant)recipients.push(...await businessNotificationRecipients(pool,o.business_id,'merchant'));
  await safeEmit({eventKey:`order:${o.id}:${eventCode}:${eventCode==='order.payment_confirmed'?o.paid_amount:o.order_status}`,eventCode,sourceService:'orders',entityType:'order',entityId:String(o.id),correlationId:correlation(req),category:'operational',priority,emailDefault,pushDefault,data:{order_number:o.order_number||o.id,customer_name:o.customer_name||'Customer',business_name:o.business_name||'',delivery_suffix:o.fulfilment_method==='delivery'?' before delivery':''},recipients:uniqueRecipients(recipients)});
}

async function emitDeliveryEvent(req,id,eventCode,{courier=false}={}){
  const d=await deliveryInfo(id);if(!d)return;
  const merchant=await businessNotificationRecipients(pool,d.business_id,'merchant');
  const recipients=uniqueRecipients({accountId:Number(d.customer_account_id),roleHint:'customer'},...merchant,courier&&d.courier_account_id?{accountId:Number(d.courier_account_id),roleHint:'courier'}:null);
  await safeEmit({eventKey:`delivery:${d.id}:${eventCode}:${d.status}`,eventCode,sourceService:'delivery',entityType:'delivery',entityId:String(d.id),correlationId:correlation(req),category:'operational',priority:eventCode==='delivery.completed'?'normal':'high',emailDefault:false,pushDefault:true,data:{order_number:d.order_number||d.order_id,business_name:d.business_name||'',status:d.status},recipients});
}
async function emitPoEvent(req,id,eventCode,{toSupplier=false,toMerchant=true,emailDefault=false}={}){
  const p=await poInfo(id);if(!p)return;
  const recipients=[];
  if(toSupplier)recipients.push({accountId:Number(p.supplier_account_id),roleHint:'supplier'});
  if(toMerchant)recipients.push(...await businessNotificationRecipients(pool,p.business_id,'merchant'));
  await safeEmit({eventKey:`po:${p.id}:${eventCode}:${p.status}:${p.payment_status}:${p.paid_amount}`,eventCode,sourceService:'suppliers',entityType:'purchase_order',entityId:String(p.id),correlationId:correlation(req),category:'operational',priority:'high',emailDefault,pushDefault:true,data:{po_number:p.po_number||p.id,business_name:p.business_name||'',supplier_name:p.supplier_name||'Supplier',status:p.status},recipients:uniqueRecipients(recipients)});
}
async function emitServiceEvent(req,id,eventCode,{toCustomer=false,toProvider=false}={}){
  const j=await serviceJobInfo(id);if(!j)return;
  const recipients=[];
  if(toCustomer)recipients.push({accountId:Number(j.customer_account_id),roleHint:'customer'});
  if(toProvider)recipients.push({accountId:Number(j.provider_account_id),roleHint:'service_provider'});
  await safeEmit({eventKey:`service:${j.id}:${eventCode}:${j.status}:${j.updated_at}`,eventCode,sourceService:'services',entityType:'service_job',entityId:String(j.id),correlationId:correlation(req),category:'operational',priority:'normal',emailDefault:false,pushDefault:true,data:{service_label:j.service_label||'service',status:j.status},recipients:uniqueRecipients(recipients)});
}

// Orders
async function emitOrderCreated(req,data){
  const id=data.id||data.order?.id;
  if(!id)return;
  const o=await orderInfo(id);
  if(!o)return;
  const merchants=await businessNotificationRecipients(pool,o.business_id,'merchant');
  await safeEmit({
    eventKey:`order:${o.id}:created`,
    eventCode:'order.created',
    sourceService:'orders',
    entityType:'order',
    entityId:String(o.id),
    correlationId:correlation(req),
    category:'operational',
    priority:'high',
    emailDefault:false,
    pushDefault:true,
    data:{
      order_number:o.order_number||o.id,
      customer_name:o.customer_name||'Customer',
      business_name:o.business_name||''
    },
    recipients:merchants
  });
}
app.post('/api/orders',body,(req,res)=>forwardJson(req,res,data=>emitOrderCreated(req,data)));
app.post('/api/marketplace/checkout',body,(req,res)=>forwardJson(req,res,data=>emitOrderCreated(req,data)));
app.post('/api/orders/:id/check-in',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.customer_checked_in',{merchant:true,customer:false,priority:'high'})));
app.post('/api/orders/merchant/:id/confirm-presence',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.customer_checked_in',{merchant:false,customer:true})));
app.post('/api/orders/merchant/:id/start',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.preparing',{customer:true})));
app.post('/api/orders/merchant/:id/ready',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.ready',{customer:true,priority:'high'})));
app.post('/api/orders/merchant/:id/payment',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.payment_confirmed',{merchant:true,customer:true})));
app.post('/api/orders/merchant/:id/complete',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.completed',{customer:true})));
app.post('/api/orders/merchant/:id/cancel',body,(req,res)=>forwardJson(req,res,()=>emitOrderEvent(req,req.params.id,'order.cancelled',{customer:true,emailDefault:true,priority:'high'})));

// Delivery
app.post('/api/admin/deliveries/:id/assign',body,(req,res)=>forwardJson(req,res,()=>emitDeliveryEvent(req,req.params.id,'delivery.assigned',{courier:true})));
app.post('/api/courier/deliveries/:id/status',body,(req,res)=>forwardJson(req,res,async data=>{
  const status=data.status||data.delivery?.status||(await deliveryInfo(req.params.id))?.status;
  const code=status==='picked_up'?'delivery.picked_up':status==='in_transit'?'delivery.in_transit':status==='courier_arrived_at_customer'?'delivery.arrived':null;
  if(code)await emitDeliveryEvent(req,req.params.id,code);
}));
app.post('/api/courier/deliveries/:id/complete',body,(req,res)=>forwardJson(req,res,()=>emitDeliveryEvent(req,req.params.id,'delivery.completed')));

// Supplier / procurement
app.post('/api/procurement/relationships/invite',body,(req,res)=>forwardJson(req,res,async data=>{const supplierId=positiveId(data.supplier_account_id||req.body?.supplier_account_id);if(!supplierId)return;const businessId=positiveId(data.business_id||req.body?.business_id);if(!businessId)return;const b=await pool.query(`SELECT name FROM businesses WHERE id=$1`,[businessId]);await safeEmit({eventKey:`supplier-rel:${businessId}:${supplierId}:invited`,eventCode:'supplier.relationship_invited',sourceService:'suppliers',entityType:'supplier_relationship',entityId:`${businessId}:${supplierId}`,correlationId:correlation(req),category:'operational',priority:'normal',emailDefault:true,pushDefault:true,data:{business_name:b.rows[0]?.name||'A business'},recipients:[{accountId:supplierId,roleHint:'supplier'}]})}));
app.post('/api/supplier/relationships/:businessId/respond',body,(req,res)=>forwardJson(req,res,async data=>{const supplierId=Number(data.supplier_account_id);if(!supplierId)return;const merchant=await businessNotificationRecipients(pool,Number(req.params.businessId),'merchant');const s=await pool.query(`SELECT COALESCE(s.supplier_name,a.display_name) supplier_name FROM accounts a LEFT JOIN supplier_profiles s ON s.account_id=a.id WHERE a.id=$1`,[supplierId]);await safeEmit({eventKey:`supplier-rel:${req.params.businessId}:${supplierId}:${data.state}`,eventCode:'supplier.relationship_updated',sourceService:'suppliers',entityType:'supplier_relationship',entityId:`${req.params.businessId}:${supplierId}`,correlationId:correlation(req),category:'operational',priority:'normal',emailDefault:false,pushDefault:true,data:{supplier_name:s.rows[0]?.supplier_name||'Supplier',status:data.state||''},recipients:merchant})}));
app.post('/api/procurement/orders',body,(req,res)=>forwardJson(req,res,async data=>{const id=data.id||data.order?.id;if(id)await emitPoEvent(req,id,'procurement.po_created',{toSupplier:true,toMerchant:false,emailDefault:true})}));
app.post('/api/supplier/orders/:id/respond',body,(req,res)=>forwardJson(req,res,()=>emitPoEvent(req,req.params.id,'procurement.po_updated',{toMerchant:true})));
app.post('/api/supplier/orders/:id/status',body,(req,res)=>forwardJson(req,res,()=>emitPoEvent(req,req.params.id,'procurement.po_updated',{toMerchant:true})));
app.post('/api/procurement/orders/:id/receive',body,(req,res)=>forwardJson(req,res,()=>emitPoEvent(req,req.params.id,'procurement.po_updated',{toSupplier:true,toMerchant:false})));
app.post('/api/procurement/orders/:id/payment',body,(req,res)=>forwardJson(req,res,()=>emitPoEvent(req,req.params.id,'procurement.payment_received',{toSupplier:true,toMerchant:false,emailDefault:true})));

// Local Services
app.post('/api/services/jobs',body,(req,res)=>forwardJson(req,res,async data=>{const id=data.id;if(id)await emitServiceEvent(req,id,'service.request_created',{toProvider:true})}));
app.post('/api/service-provider/jobs/:id/quote',body,(req,res)=>forwardJson(req,res,()=>emitServiceEvent(req,req.params.id,'service.quote_created',{toCustomer:true})));
app.post('/api/services/jobs/:id/accept-quote',body,(req,res)=>forwardJson(req,res,()=>emitServiceEvent(req,req.params.id,'service.quote_accepted',{toProvider:true})));
app.post('/api/service-provider/jobs/:id/status',body,(req,res)=>forwardJson(req,res,()=>emitServiceEvent(req,req.params.id,'service.status_changed',{toCustomer:true})));
app.post('/api/services/jobs/:id/confirm-completion',body,(req,res)=>forwardJson(req,res,()=>emitServiceEvent(req,req.params.id,'service.status_changed',{toProvider:true})));

// Support + incidents
app.post('/api/support/tickets',body,(req,res)=>forwardJson(req,res,async data=>{const id=Number(data.id);if(!id)return;const t=await supportInfo(id);if(!t)return;const admins=await adminNotificationRecipients(pool,{territoryId:t.territory_id,permission:'support.manage',destination:t.requested_destination||'support'});await safeEmit({eventKey:`support:${id}:created`,eventCode:'support.ticket_created',sourceService:'support',entityType:'support_ticket',entityId:String(id),correlationId:correlation(req),category:'support',priority:t.priority==='urgent'?'urgent':'high',emailDefault:t.requested_destination==='platform_admin',pushDefault:true,data:{ticket_id:id,subject:t.subject||''},recipients:admins})}));
app.post('/api/support/tickets/:id/reply',body,(req,res)=>forwardJson(req,res,async()=>{const t=await supportInfo(req.params.id);if(!t)return;const latest=await pool.query(`SELECT id FROM support_messages WHERE ticket_id=$1 ORDER BY id DESC LIMIT 1`,[t.id]);const admins=t.assigned_admin_account_id?[{accountId:Number(t.assigned_admin_account_id),roleHint:'admin'}]:await adminNotificationRecipients(pool,{territoryId:t.territory_id,permission:'support.manage',destination:t.requested_destination||'support'});await safeEmit({eventKey:`support:${t.id}:user-reply:${latest.rows[0]?.id||Date.now()}`,eventCode:'support.user_reply',sourceService:'support',entityType:'support_ticket',entityId:String(t.id),correlationId:correlation(req),category:'support',priority:'normal',emailDefault:false,pushDefault:true,data:{ticket_id:t.id,subject:t.subject||''},recipients:admins})}));
app.post('/api/admin/support/:id/messages',body,(req,res)=>forwardJson(req,res,async()=>{if(req.body?.visibility==='internal')return;const t=await supportInfo(req.params.id);if(!t)return;const latest=await pool.query(`SELECT id FROM support_messages WHERE ticket_id=$1 ORDER BY id DESC LIMIT 1`,[t.id]);await safeEmit({eventKey:`support:${t.id}:admin-reply:${latest.rows[0]?.id||Date.now()}`,eventCode:'support.reply',sourceService:'support',entityType:'support_ticket',entityId:String(t.id),correlationId:correlation(req),category:'support',priority:'high',emailDefault:true,pushDefault:true,data:{ticket_id:t.id,subject:t.subject||''},recipients:[{accountId:Number(t.requester_account_id),roleHint:''}]})}));
app.patch('/api/admin/incidents/:id',body,(req,res)=>forwardJson(req,res,async()=>{const i=await incidentInfo(req.params.id);if(!i)return;const action=await pool.query(`SELECT id FROM incident_actions WHERE incident_id=$1 ORDER BY id DESC LIMIT 1`,[i.id]);await safeEmit({eventKey:`incident:${i.id}:update:${action.rows[0]?.id||i.status}`,eventCode:'incident.updated',sourceService:'incidents',entityType:'incident',entityId:String(i.id),correlationId:correlation(req),category:'support',priority:i.status==='escalated'?'urgent':'high',emailDefault:true,pushDefault:true,data:{incident_id:i.id,status:i.status},recipients:[{accountId:Number(i.reporter_account_id),roleHint:''}]})}));

// Profile governance
app.post('/api/governance/applications/:id/submit',body,(req,res)=>forwardJson(req,res,async data=>{const a=await applicationInfo(data.id||req.params.id);if(!a)return;const perm=a.role==='merchant'?'merchant.approve':a.role==='supplier'?'supplier.approve':a.role==='courier'?'courier.verify':'profiles.review_service_provider';const admins=await adminNotificationRecipients(pool,{territoryId:a.territory_id,permission:perm,destination:'support'});await safeEmit({eventKey:`profile-app:${a.id}:submitted`,eventCode:'profile.application_submitted',sourceService:'governance',entityType:'profile_application',entityId:String(a.id),correlationId:correlation(req),category:'operational',priority:'normal',emailDefault:false,pushDefault:true,data:{role:a.role,status:a.status},recipients:admins})}));
app.post('/api/governance/admin/applications/:id/review',body,(req,res)=>forwardJson(req,res,async()=>{const a=await applicationInfo(req.params.id);if(!a)return;await safeEmit({eventKey:`profile-app:${a.id}:review:${a.status}`,eventCode:'profile.application_reviewed',sourceService:'governance',entityType:'profile_application',entityId:String(a.id),correlationId:correlation(req),category:'operational',priority:'high',emailDefault:true,pushDefault:true,data:{role:a.role,status:a.status},recipients:[{accountId:Number(a.account_id),roleHint:a.role}]})}));
app.post('/api/governance/admin/authorizations/:id/status',body,(req,res)=>forwardJson(req,res,async()=>{const a=await authorizationInfo(req.params.id);if(!a)return;await safeEmit({eventKey:`profile-auth:${a.id}:${a.status}`,eventCode:'profile.authorization_changed',sourceService:'governance',entityType:'profile_authorization',entityId:String(a.id),correlationId:correlation(req),category:'security',priority:'high',mandatory:true,emailDefault:true,pushDefault:true,data:{role:a.role,status:a.status},recipients:[{accountId:Number(a.account_id),roleHint:a.role}]})}));

// Notification APIs
app.post('/api/notifications/webhooks/resend',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
  try{
    const rawBody=Buffer.isBuffer(req.rawBody)&&req.rawBody.length
      ?req.rawBody
      :(Buffer.isBuffer(req.body)?req.body:null);
    if(!rawBody)throw Object.assign(new Error('Resend raw body is required'),{status:400});
    const verified=verifyResendWebhook({
      rawBody,
      headers:req.headers,
      secret:resendWebhookRuntime.secret||process.env.RESEND_WEBHOOK_SECRET||''
    });
    const result=await recordResendProviderEvent(pool,{
      providerEventId:verified.providerEventId,
      event:verified.event,
      payloadDigest:verified.payloadDigest
    });
    res.status(result.ignored?202:200).json({
      ok:true,
      ignored:Boolean(result.ignored),
      duplicate:Boolean(result.duplicate),
      matched:Boolean(result.matched)
    });
  }catch(e){
    const status=Number(e?.status)||500;
    if(status>=500)console.error('Resend webhook:',e?.message||'unexpected error');
    res.status(status).json({error:status===503?'Resend webhook is not configured':'Invalid Resend webhook'});
  }
});
app.get('/health',async(req,res)=>{const r=await notificationsFetch('/health',{headers:req.headers});const payload=await r.json().catch(()=>({ok:false}));res.status(r.status).json(payload)});
app.get('/notifications.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','notifications.css'),'utf8')));
app.get('/notifications-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','notifications-ui.js'),'utf8')));
app.get('/notifications-sw.js',(_q,res)=>res.type('application/javascript').set('Service-Worker-Allowed','/').send(readFileSync(join(__dirname,'public','notifications-sw.js'),'utf8')));
app.get('/manifest.webmanifest',(_q,res)=>res.type('application/manifest+json').send(readFileSync(join(__dirname,'public','manifest.webmanifest'),'utf8')));
async function root(req,res){const r=await notificationsFetch(req.path,{headers:req.headers});res.status(r.status).type('html').send(await r.text())}
app.get('/',root);app.get('/index.html',root);

app.get('/api/notifications',async(req,res,next)=>{try{
  const me=await identity(req),limit=Math.max(1,Math.min(100,Number(req.query.limit)||50)),threaded=String(req.query.threaded||'')==='all';
  const soundPreferences=await notificationSoundPreferences(pool,me.account.id);
  const{rows}=await pool.query(`
    WITH base AS (
      SELECT r.id recipient_id,r.read_at,r.dismissed_at,r.locale,r.role_hint,e.id event_id,e.event_code,e.entity_type,e.entity_id,e.category,e.priority,e.data_json,e.created_at,
        CASE WHEN (e.entity_type='support_ticket' OR ($3::boolean AND e.entity_type IN ('order','delivery','purchase_order','service_job'))) AND e.entity_id<>''
          THEN e.entity_type||':'||e.entity_id ELSE 'recipient:'||r.id::text END thread_key
      FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id
      JOIN notification_deliveries d ON d.recipient_id=r.id AND d.channel='in_app' AND d.status='delivered'
      WHERE r.account_id=$1 AND r.dismissed_at IS NULL
    ), inbox AS (
      SELECT base.*,
        ROW_NUMBER() OVER(PARTITION BY thread_key ORDER BY created_at DESC,event_id DESC) thread_rank,
        (COUNT(*) OVER(PARTITION BY thread_key))::int thread_count,
        (COUNT(*) FILTER (WHERE read_at IS NULL) OVER(PARTITION BY thread_key))::int unread_count
      FROM base
    ) SELECT recipient_id,read_at,dismissed_at,locale,role_hint,event_id,event_code,entity_type,entity_id,category,priority,data_json,created_at,thread_key,thread_count,unread_count
      FROM inbox WHERE thread_rank=1 ORDER BY created_at DESC LIMIT $2
  `,[me.account.id,limit,threaded]);
  const out=[];for(const row of rows){const msg=await renderNotification(pool,row,'in_app');const attention={...msg.attention,soundVariant:soundPreferences[msg.attention.soundSlot]??DEFAULT_NOTIFICATION_SOUND_VARIANT};out.push({...row,title:msg.title,body:msg.body,attention})}
  res.json(out)
}catch(e){next(e)}});
app.get('/api/notifications/unread-count',async(req,res,next)=>{try{
  const me=await identity(req),threaded=String(req.query.threaded||'')==='all';
  const q=await pool.query(`
    WITH base AS (
      SELECT r.id recipient_id,r.read_at,e.id event_id,e.entity_type,e.entity_id,e.created_at,
        CASE WHEN (e.entity_type='support_ticket' OR ($2::boolean AND e.entity_type IN ('order','delivery','purchase_order','service_job'))) AND e.entity_id<>''
          THEN e.entity_type||':'||e.entity_id ELSE 'recipient:'||r.id::text END thread_key
      FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id
      JOIN notification_deliveries d ON d.recipient_id=r.id AND d.channel='in_app' AND d.status='delivered'
      WHERE r.account_id=$1 AND r.dismissed_at IS NULL
    ), inbox AS (
      SELECT base.*,ROW_NUMBER() OVER(PARTITION BY thread_key ORDER BY created_at DESC,event_id DESC) thread_rank,
        (COUNT(*) FILTER (WHERE read_at IS NULL) OVER(PARTITION BY thread_key))::int unread_count
      FROM base
    ) SELECT COUNT(*)::int n FROM inbox WHERE thread_rank=1 AND unread_count>0
  `,[me.account.id,threaded]);
  res.json({unread:Number(q.rows[0].n)})
}catch(e){next(e)}});
app.patch('/api/notifications/:id/read',body,async(req,res,next)=>{try{
  const me=await identity(req),recipientId=Number(req.params.id),threaded=req.body?.threaded===true;
  const target=await pool.query(`SELECT e.entity_type,e.entity_id FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id WHERE r.id=$1 AND r.account_id=$2`,[recipientId,me.account.id]);
  if(!target.rowCount)return res.status(404).json({error:'Notification not found'});
  const x=target.rows[0];let q;
  if(threaded&&isNotificationThreadEntity(x.entity_type,x.entity_id)){
    q=await pool.query(`UPDATE notification_recipients r SET read_at=COALESCE(r.read_at,NOW()) FROM notification_events e WHERE r.event_id=e.id AND r.account_id=$1 AND e.entity_type=$2 AND e.entity_id=$3 AND r.dismissed_at IS NULL RETURNING r.id,r.read_at`,[me.account.id,x.entity_type,x.entity_id]);
  }else q=await pool.query(`UPDATE notification_recipients SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND account_id=$2 RETURNING id,read_at`,[recipientId,me.account.id]);
  if(!q.rowCount)return res.status(404).json({error:'Notification not found'});
  res.json(q.rows.find(row=>Number(row.id)===recipientId)||q.rows[0]);
}catch(e){next(e)}});
app.post('/api/notifications/read-all',body,async(req,res,next)=>{try{const me=await identity(req);await pool.query(`UPDATE notification_recipients SET read_at=COALESCE(read_at,NOW()) WHERE account_id=$1 AND dismissed_at IS NULL`,[me.account.id]);res.json({ok:true})}catch(e){next(e)}});
app.delete('/api/notifications/:id',async(req,res,next)=>{try{
  const me=await identity(req),recipientId=Number(req.params.id),threaded=['1','all','true'].includes(String(req.query.threaded||'').toLowerCase());
  const target=await pool.query(`SELECT e.entity_type,e.entity_id FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id WHERE r.id=$1 AND r.account_id=$2`,[recipientId,me.account.id]);
  if(!target.rowCount)return res.status(404).json({error:'Notification not found'});
  const x=target.rows[0],bulk=x.entity_type==='support_ticket'||(threaded&&isNotificationThreadEntity(x.entity_type,x.entity_id));
  if(bulk)await pool.query(`UPDATE notification_recipients r SET dismissed_at=NOW() FROM notification_events e WHERE r.event_id=e.id AND r.account_id=$1 AND e.entity_type=$2 AND e.entity_id=$3`,[me.account.id,x.entity_type,x.entity_id]);
  else await pool.query(`UPDATE notification_recipients SET dismissed_at=NOW() WHERE id=$1 AND account_id=$2`,[recipientId,me.account.id]);
  res.json({ok:true})
}catch(e){next(e)}});

app.get('/api/notifications/preferences',async(req,res,next)=>{try{const me=await identity(req);const q=await pool.query(`SELECT preferred_locale FROM accounts WHERE id=$1`,[me.account.id]);const prefs=await pool.query(`SELECT * FROM notification_preferences WHERE account_id=$1 ORDER BY category,profile_role`,[me.account.id]);const attentionPreferences=await notificationAttentionPreference(pool,me.account.id);const soundPreferences=await notificationSoundPreferences(pool,me.account.id);const preferredLocale=normalizeNotificationLocale(q.rows[0]?.preferred_locale);res.json({preferred_locale:preferredLocale,categories:CATEGORIES,preferences:prefs.rows,attention_preferences:attentionPreferences,sound_variants:notificationSoundVariants(),sound_slots:notificationSoundSlots(),sound_preferences:soundPreferences,default_sound_variant:DEFAULT_NOTIFICATION_SOUND_VARIANT,voice_transcripts:notificationVoiceTranscriptMatrix('en-PH'),planned_voice_transcripts:notificationVoiceTranscriptMatrix(preferredLocale),localized_voice_variants:{'fil-PH':[2]},audio_configured:notificationAudioConfigured(),push_configured:Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY&&process.env.WEB_PUSH_VAPID_PRIVATE_KEY)})}catch(e){next(e)}});
app.put('/api/notifications/attention-preferences',body,async(req,res,next)=>{try{const me=await identity(req);const current=await notificationAttentionPreference(pool,me.account.id);const saved=await saveNotificationAttentionPreference(pool,me.account.id,{sound_enabled:req.body?.sound_enabled??current.sound_enabled,vibration_enabled:req.body?.vibration_enabled??current.vibration_enabled,important_alerts_enabled:req.body?.important_alerts_enabled??current.important_alerts_enabled});res.json(saved)}catch(e){next(e)}});
app.put('/api/notifications/sound-preference',body,async(req,res,next)=>{try{const me=await identity(req);const saved=await saveNotificationSoundPreference(pool,me.account.id,req.body?.sound_slot,req.body?.variant);res.json(saved)}catch(e){next(e)}});
app.get('/api/notifications/audio-url',async(req,res,next)=>{try{
  const me=await identity(req);
  const soundSlot=clean(req.query.sound_slot,80);
  const saved=await notificationSoundPreferences(pool,me.account.id);
  const requestedVariant=req.query.variant==null||req.query.variant===''?(saved[soundSlot]??DEFAULT_NOTIFICATION_SOUND_VARIANT):req.query.variant;
  const localeRow=await pool.query(`SELECT preferred_locale FROM accounts WHERE id=$1`,[me.account.id]);
  const descriptor=notificationAudioDescriptor({soundSlot,variant:requestedVariant,locale:normalizeNotificationLocale(localeRow.rows[0]?.preferred_locale)});
  const expiresIn=900;
  const url=presignNotificationAudioUrl({key:descriptor.key,expiresIn});
  res.set('Cache-Control','no-store').json({...descriptor,url,expires_in:expiresIn});
}catch(e){next(e)}});
app.put('/api/notifications/preferences',body,async(req,res,next)=>{try{const me=await identity(req),category=clean(req.body?.category,40),role=clean(req.body?.profile_role,40);if(!CATEGORIES.includes(category))return res.status(400).json({error:'Unknown notification category'});if(category==='security'&&req.body?.in_app_enabled===false)return res.status(409).json({error:'Security notifications must remain available in-app'});const inApp=category==='security'?true:req.body?.in_app_enabled!==false,email=Boolean(req.body?.email_enabled),push=req.body?.push_enabled!==false;const{rows}=await pool.query(`INSERT INTO notification_preferences(account_id,profile_role,category,in_app_enabled,email_enabled,push_enabled) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,profile_role,category) DO UPDATE SET in_app_enabled=EXCLUDED.in_app_enabled,email_enabled=EXCLUDED.email_enabled,push_enabled=EXCLUDED.push_enabled,updated_at=NOW() RETURNING *`,[me.account.id,role,category,inApp,email,push]);res.json(rows[0])}catch(e){next(e)}});
app.put('/api/notifications/locale',body,async(req,res,next)=>{try{const me=await identity(req),locale=normalizeNotificationLocale(req.body?.locale);await pool.query(`UPDATE accounts SET preferred_locale=$1,updated_at=NOW() WHERE id=$2`,[locale,me.account.id]);res.json({ok:true,preferred_locale:locale})}catch(e){next(e)}});

app.get('/api/notifications/push/config',async(_req,res)=>res.json({enabled:Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY&&process.env.WEB_PUSH_VAPID_PRIVATE_KEY),public_key:process.env.WEB_PUSH_VAPID_PUBLIC_KEY||''}));
app.post('/api/notifications/push/subscribe',body,async(req,res,next)=>{try{const me=await identity(req),endpoint=clean(req.body?.endpoint,2000),p256dh=clean(req.body?.keys?.p256dh,1000),auth=clean(req.body?.keys?.auth,1000);if(!endpoint||!p256dh||!auth)return res.status(400).json({error:'Valid push subscription required'});await pool.query(`INSERT INTO push_subscriptions(account_id,endpoint,p256dh,auth,user_agent,last_seen_at,revoked_at) VALUES($1,$2,$3,$4,$5,NOW(),NULL) ON CONFLICT(endpoint) DO UPDATE SET account_id=EXCLUDED.account_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent,last_seen_at=NOW(),revoked_at=NULL`,[me.account.id,endpoint,p256dh,auth,clean(req.headers['user-agent'],400)]);res.json({ok:true})}catch(e){next(e)}});
app.delete('/api/notifications/push/subscriptions',async(req,res,next)=>{try{const me=await identity(req);await pool.query(`UPDATE push_subscriptions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL`,[me.account.id]);res.json({ok:true})}catch(e){next(e)}});

app.use((req,res,next)=>{
  if(!adminApp)return res.status(503).json({error:'Admin + Support runtime is not ready'});
  return adminApp(req,res,next);
});
app.use((err,_req,res,_next)=>{const status=Number(err?.status)||500;if(status>=500)console.error(err);if(res.headersSent)return;res.status(status).json({error:status<500?err.message:'Unexpected notification error'})});

async function runWorker(){if(workerRunning)return;workerRunning=true;try{for(let i=0;i<5;i++){const n=await processNotificationDeliveries(pool,{limit:20});if(n<20)break}}catch(e){console.error('Notification worker:',e.message)}finally{workerRunning=false}}
async function bootstrapResendObservability(){
  const result=await bootstrapResendWebhook();
  resendWebhookRuntime=result;
  const safe=resendWebhookReadiness(result);
  if(safe.ready)console.log('Resend delivery webhook ready: '+safe.status+' ('+safe.source+')');
  else console.log('Resend delivery webhook not ready: '+safe.status);
  return safe;
}
let embeddedStartPromise=null;
export async function startEmbeddedNotifications(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      adminApp=await startEmbeddedAdminOperations();
      adminReady=true;
      await ensureNotificationSchema(pool);
      await bootstrapResendObservability();
      workerTimer=setInterval(runWorker,8000);
      runWorker();
      console.log('Business & Life notification gateway mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}
async function stopNotifications(){
  if(shuttingDown)return;
  shuttingDown=true;
  if(workerTimer)clearInterval(workerTimer);
  workerTimer=null;
  adminReady=false;
  await stopEmbeddedAdminOperations().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedNotifications(){await stopNotifications()}
async function shutdown(sig){console.log(`Received ${sig}`);await stopNotifications();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedNotifications()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life notification gateway listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
