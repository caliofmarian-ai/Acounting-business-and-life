import crypto from 'node:crypto';
import { registerProviderEvent, paymentIntentDetail, sanitizeProviderPayload } from './payment-core.js';

const API_BASE='https://api.paymongo.com';
const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const cents=v=>Math.round(Number(v)*100);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
let discoveredWebhook={secret:'',id:'',url:'',status:'unconfigured',source:'',updatedAt:null,error:''};

export function payMongoRuntimeConfig(){
  const secretKey=String(process.env.PAYMONGO_SECRET_KEY||'').trim();
  const envWebhookSecret=String(process.env.PAYMONGO_WEBHOOK_SECRET||'').trim();
  const webhookSecret=envWebhookSecret||discoveredWebhook.secret;
  const keyMode=secretKey.startsWith('sk_live_')?'live':secretKey.startsWith('sk_test_')?'test':'unknown';
  const requestedMode=String(process.env.PAYMONGO_MODE||'test').toLowerCase()==='live'?'live':'test';
  const liveAllowed=String(process.env.PAYMONGO_LIVE_ENABLED||'').toLowerCase()==='true';
  const mode=requestedMode==='live'&&liveAllowed?'live':'test';
  const methods=String(process.env.PAYMONGO_PAYMENT_METHODS||'card,gcash,paymaya,qrph')
    .split(',').map(x=>x.trim()).filter(Boolean)
    .filter(x=>['card','gcash','paymaya','qrph','grab_pay','shopeepay'].includes(x));
  return{
    secretKey,webhookSecret,keyMode,mode,liveAllowed,
    secretReady:Boolean(secretKey)&&(mode==='test'?keyMode==='test':keyMode==='live'),
    webhookReady:Boolean(webhookSecret),
    webhookSource:envWebhookSecret?'environment':(discoveredWebhook.secret?'paymongo_api_memory':''),
    webhookId:discoveredWebhook.id||'',webhookUrl:discoveredWebhook.url||'',webhookStatus:discoveredWebhook.status||'unconfigured',webhookBootstrapError:discoveredWebhook.error||'',
    methods:[...new Set(methods.length?methods:['card','gcash','paymaya','qrph'])],
    baseUrl:clean(process.env.AUTH_PUBLIC_BASE_URL||process.env.PUBLIC_BASE_URL||'',500),
    signatureToleranceSeconds:Math.max(60,Math.min(900,Number(process.env.PAYMONGO_WEBHOOK_TOLERANCE_SECONDS)||300))
  };
}

export async function ensurePayMongoSchema(pool){
  await pool.query("ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_session_id TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_payment_id TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_fee NUMERIC(14,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_net_amount NUMERIC(14,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_payment_method TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS provider_redirect_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb");
  const cfg=payMongoRuntimeConfig();
  const status=cfg.secretReady?(cfg.mode==='live'?'active':'sandbox'):'disabled';
  await pool.query(
    "INSERT INTO payment_provider_configs(provider_code,display_name,adapter_version,status,country_code,supported_methods,ledger_account,config_metadata) VALUES('paymongo','PayMongo','v0.15-hosted-checkout-v2',$1,'PH',$2::jsonb,'other',$3::jsonb) ON CONFLICT(provider_code) DO UPDATE SET display_name='PayMongo',adapter_version='v0.15-hosted-checkout-v2',status=EXCLUDED.status,supported_methods=EXCLUDED.supported_methods,ledger_account='other',config_metadata=EXCLUDED.config_metadata,updated_at=NOW()",
    [status,JSON.stringify(cfg.methods),JSON.stringify({integration:'hosted_checkout_v2',mode:cfg.mode,secret_ready:cfg.secretReady,webhook_ready:cfg.webhookReady,pass_on_fees:false})]
  );
}

function basicAuth(secretKey){
  return 'Basic '+Buffer.from(secretKey+':').toString('base64');
}

async function payMongoRequest(path,{method='GET',body=null,idempotencyKey=''}={}){
  const cfg=payMongoRuntimeConfig();
  if(!cfg.secretReady){
    const err=new Error(cfg.keyMode==='live'&&!cfg.liveAllowed?'PayMongo live key is present but live mode is not explicitly enabled':'PayMongo sandbox secret key is not configured');
    err.status=503;err.code='PAYMONGO_SECRET_KEY_REQUIRED';throw err;
  }
  const headers={Authorization:basicAuth(cfg.secretKey),'Content-Type':'application/json'};
  if(idempotencyKey)headers['Idempotency-Key']=clean(idempotencyKey,220);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(API_BASE+path,{method,headers,body:body==null?undefined:JSON.stringify(body),signal:controller.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      const msg=clean(data?.errors?.[0]?.detail||data?.errors?.[0]?.code||data?.message||('PayMongo HTTP '+r.status),500);
      const err=new Error(msg);err.status=502;err.code='PAYMONGO_API_ERROR';err.provider_status=r.status;err.provider_body=sanitizeProviderPayload(data);throw err;
    }
    return data;
  }finally{clearTimeout(timer)}
}


function webhookAttrs(resource){
  if(resource?.attributes&&typeof resource.attributes==='object')return resource.attributes;
  return{};
}

function webhookResourceList(json){
  if(Array.isArray(json?.data))return json.data;
  if(json?.data&&typeof json.data==='object'&&json.data.id)return[json.data];
  return[];
}

function publicWebhookState(extra={}){
  return{
    id:discoveredWebhook.id||'',
    url:discoveredWebhook.url||'',
    status:discoveredWebhook.status||'unconfigured',
    source:discoveredWebhook.source||'',
    ready:Boolean(discoveredWebhook.secret||process.env.PAYMONGO_WEBHOOK_SECRET),
    updated_at:discoveredWebhook.updatedAt||null,
    error:discoveredWebhook.error||'',
    ...extra
  };
}

async function updateWebhookProviderMetadata(pool,cfg,state){
  const metadata={
    integration:'hosted_checkout_v2',
    mode:cfg.mode,
    secret_ready:cfg.secretReady,
    webhook_ready:Boolean(state.ready),
    webhook_id:state.id||'',
    webhook_url:state.url||'',
    webhook_status:state.status||'unconfigured',
    webhook_secret_source:state.source||'',
    webhook_bootstrap_error:state.error||'',
    webhook_events:['checkout_session.payment.paid'],
    pass_on_fees:false
  };
  await pool.query(
    "UPDATE payment_provider_configs SET adapter_version='v0.15-hosted-checkout-v2',status=$1,config_metadata=$2::jsonb,updated_at=NOW() WHERE provider_code='paymongo'",
    [cfg.secretReady?(cfg.mode==='live'?'active':'sandbox'):'disabled',JSON.stringify(metadata)]
  );
}

export function payMongoWebhookBootstrapStatus(){
  const cfg=payMongoRuntimeConfig();
  return{
    ...publicWebhookState(),
    mode:cfg.mode,
    secret_key_ready:cfg.secretReady,
    environment_webhook_secret:Boolean(process.env.PAYMONGO_WEBHOOK_SECRET)
  };
}

export async function ensurePayMongoWebhook(pool,{force=false}={}){
  const cfg=payMongoRuntimeConfig();
  if(process.env.PAYMONGO_WEBHOOK_SECRET){
    discoveredWebhook={
      ...discoveredWebhook,
      secret:String(process.env.PAYMONGO_WEBHOOK_SECRET),
      status:'ready',
      source:'environment',
      updatedAt:new Date().toISOString(),
      error:''
    };
    const state=publicWebhookState({created:false,reused:true});
    await updateWebhookProviderMetadata(pool,cfg,state).catch(()=>{});
    return state;
  }
  if(!cfg.secretReady){
    discoveredWebhook={secret:'',id:'',url:'',status:'waiting_for_secret_key',source:'',updatedAt:new Date().toISOString(),error:''};
    const state=publicWebhookState({created:false,reused:false});
    await updateWebhookProviderMetadata(pool,cfg,state).catch(()=>{});
    return state;
  }
  if(!cfg.baseUrl||!/^https:\/\//i.test(cfg.baseUrl)){
    discoveredWebhook={secret:'',id:'',url:'',status:'configuration_error',source:'',updatedAt:new Date().toISOString(),error:'public_https_base_url_required'};
    const state=publicWebhookState({created:false,reused:false});
    await updateWebhookProviderMetadata(pool,cfg,state).catch(()=>{});
    return state;
  }
  if(discoveredWebhook.secret&&!force)return publicWebhookState({created:false,reused:true});
  const target=cfg.baseUrl.replace(/\/+$/,'')+'/api/payments/webhooks/paymongo';
  try{
    const list=await payMongoRequest('/v1/webhooks?limit=100&url='+encodeURIComponent(target));
    let resources=webhookResourceList(list);
    const livemode=cfg.mode==='live';
    let hook=resources.find(r=>{
      const a=webhookAttrs(r),events=Array.isArray(a.events)?a.events:[];
      return a.url===target&&Boolean(a.livemode)===livemode&&events.includes('checkout_session.payment.paid');
    })||null;
    let created=false;
    if(hook&&webhookAttrs(hook).status==='disabled'){
      await payMongoRequest('/v1/webhooks/'+encodeURIComponent(hook.id)+'/enable',{method:'POST'});
      const refreshed=await payMongoRequest('/v1/webhooks/'+encodeURIComponent(hook.id));
      hook=refreshed?.data||hook;
    }
    if(!hook){
      const createdJson=await payMongoRequest('/v1/webhooks',{
        method:'POST',
        body:{data:{attributes:{url:target,events:['checkout_session.payment.paid']}}},
        idempotencyKey:'bl-webhook-'+cfg.mode+'-'+hash(target).slice(0,24)
      });
      hook=createdJson?.data||null;
      created=true;
    }
    if(!hook?.id)throw new Error('PayMongo did not return a webhook id');
    let attrs=webhookAttrs(hook);
    if(!attrs.secret_key){
      const detailed=await payMongoRequest('/v1/webhooks/'+encodeURIComponent(hook.id));
      hook=detailed?.data||hook;attrs=webhookAttrs(hook);
    }
    const secret=clean(attrs.secret_key,500);
    if(!secret)throw new Error('PayMongo webhook resource did not return a verification secret');
    discoveredWebhook={
      secret,
      id:clean(hook.id,200),
      url:clean(attrs.url||target,1000),
      status:clean(attrs.status||'enabled',60),
      source:'paymongo_api_memory',
      updatedAt:new Date().toISOString(),
      error:''
    };
    const state=publicWebhookState({created,reused:!created});
    await updateWebhookProviderMetadata(pool,payMongoRuntimeConfig(),state);
    return state;
  }catch(e){
    discoveredWebhook={
      secret:'',
      id:discoveredWebhook.id||'',
      url:target,
      status:'bootstrap_failed',
      source:'',
      updatedAt:new Date().toISOString(),
      error:clean(e.code||e.message,300)
    };
    const state=publicWebhookState({created:false,reused:false});
    await updateWebhookProviderMetadata(pool,cfg,state).catch(()=>{});
    return state;
  }
}

export async function createPayMongoCheckout(pool,{intentPublicId,accountId}){
  const cfg=payMongoRuntimeConfig();
  if(!cfg.baseUrl||!/^https:\/\//i.test(cfg.baseUrl))throw Object.assign(new Error('A public HTTPS base URL is required for PayMongo redirects'),{status:503});
  const q=await pool.query(
    "SELECT i.*,o.order_number,o.customer_account_id,o.business_id,o.currency_code,o.outstanding_amount,b.name business_name FROM payment_intents i JOIN orders o ON o.id=i.source_id AND i.source_type='order' JOIN businesses b ON b.id=o.business_id WHERE i.public_id=$1",
    [clean(intentPublicId,120)]
  );
  if(!q.rowCount)throw Object.assign(new Error('Payment intent not found'),{status:404});
  const i=q.rows[0];
  if(Number(i.payer_account_id)!==Number(accountId)||Number(i.customer_account_id)!==Number(accountId))throw Object.assign(new Error('Payment intent belongs to another Customer'),{status:403});
  if(i.status==='succeeded')return{already_paid:true,intent:i};
  if(!['requires_provider','requires_action','processing'].includes(i.status))throw Object.assign(new Error('Payment intent cannot open PayMongo checkout from its current status'),{status:409});
  if(cents(i.amount)<100)throw Object.assign(new Error('PayMongo requires at least PHP 1.00'),{status:409});

  const previous=await pool.query(
    "SELECT * FROM payment_attempts WHERE payment_intent_id=$1 AND provider_code='paymongo' AND status IN ('requires_action','processing') AND provider_redirect_url<>'' ORDER BY attempt_no DESC LIMIT 1",
    [i.id]
  );
  if(previous.rowCount){
    return{checkout_url:previous.rows[0].provider_redirect_url,checkout_session_id:previous.rows[0].provider_attempt_id,reused:true,intent:await paymentIntentDetail(pool,i.id)};
  }

  const body={data:{attributes:{
    line_items:[{name:clean('Order '+(i.order_number||i.source_id)+' balance',120),amount:cents(i.amount),currency:'PHP',quantity:1}],
    payment_method_types:cfg.methods,
    success_url:cfg.baseUrl+'/?payment_result=paymongo&status=return&intent='+encodeURIComponent(i.public_id),
    cancel_url:cfg.baseUrl+'/?payment_result=paymongo&status=cancel&intent='+encodeURIComponent(i.public_id),
    reference_number:clean(i.order_number||('ORDER-'+i.source_id),120),
    send_email_receipt:false,
    pass_on_fees:false,
    metadata:{
      bl_payment_intent_public_id:String(i.public_id),
      bl_order_id:String(i.source_id),
      bl_business_id:String(i.business_id)
    }
  }}};
  const json=await payMongoRequest('/v2/checkout_sessions',{method:'POST',body,idempotencyKey:'bl-checkout-'+i.public_id});
  const session=json?.data;
  const sessionId=clean(session?.id,200),checkoutUrl=clean(session?.attributes?.checkout_url,1500);
  if(!sessionId||!/^https:\/\/checkout\.paymongo\.com\//i.test(checkoutUrl))throw Object.assign(new Error('PayMongo did not return a valid checkout session'),{status:502});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const n=await client.query("SELECT COALESCE(MAX(attempt_no),0)+1 n FROM payment_attempts WHERE payment_intent_id=$1",[i.id]);
    await client.query(
      "INSERT INTO payment_attempts(payment_intent_id,attempt_no,provider_code,provider_attempt_id,status,amount,currency_code,provider_redirect_url,metadata_json) VALUES($1,$2,'paymongo',$3,'requires_action',$4,$5,$6,$7::jsonb)",
      [i.id,Number(n.rows[0].n),sessionId,i.amount,i.currency_code||'PHP',checkoutUrl,JSON.stringify({mode:cfg.mode,methods:cfg.methods,pass_on_fees:false})]
    );
    await client.query(
      "UPDATE payment_intents SET provider_code='paymongo',provider_session_id=$1,status='requires_action',provider_status='checkout_session_created',updated_at=NOW() WHERE id=$2 AND status<>'succeeded'",
      [sessionId,i.id]
    );
    await client.query("INSERT INTO payment_audit_events(payment_intent_id,event_code,provider_code,after_json,correlation_id) VALUES($1,'paymongo_checkout_created','paymongo',$2::jsonb,$3)",[i.id,JSON.stringify({checkout_session_id:sessionId,methods:cfg.methods,mode:cfg.mode}),'paymongo-checkout:'+sessionId]);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  return{checkout_url:checkoutUrl,checkout_session_id:sessionId,reused:false,intent:await paymentIntentDetail(pool,i.id)};
}

function safeHexEqual(a,b){
  const sa=String(a||''),sb=String(b||'');
  if(!/^[0-9a-f]{64}$/i.test(sa)||!/^[0-9a-f]{64}$/i.test(sb))return false;
  return crypto.timingSafeEqual(Buffer.from(sa,'hex'),Buffer.from(sb,'hex'));
}

export function verifyPayMongoSignature(rawBody,signatureHeader,nowSeconds=Math.floor(Date.now()/1000)){
  const cfg=payMongoRuntimeConfig();
  if(!cfg.webhookSecret)return{ok:false,reason:'webhook_secret_not_configured'};
  const parts={};
  for(const item of String(signatureHeader||'').split(',')){
    const idx=item.indexOf('=');if(idx>0)parts[item.slice(0,idx).trim()]=item.slice(idx+1).trim();
  }
  const ts=Number(parts.t);
  if(!Number.isFinite(ts))return{ok:false,reason:'signature_timestamp_missing'};
  if(Math.abs(nowSeconds-ts)>cfg.signatureToleranceSeconds)return{ok:false,reason:'signature_timestamp_outside_tolerance'};
  const selected=cfg.mode==='live'?parts.li:parts.te;
  if(!selected)return{ok:false,reason:'signature_for_mode_missing'};
  const expected=crypto.createHmac('sha256',cfg.webhookSecret).update(String(ts)+'.').update(rawBody).digest('hex');
  return{ok:safeHexEqual(selected,expected),reason:safeHexEqual(selected,expected)?'ok':'signature_mismatch',timestamp:ts,mode:cfg.mode};
}

function normalizeEvent(body,rawBody){
  const d=body?.data||{};
  if(typeof d.type==='string'&&d.type!=='event'&&d.data)return{eventType:d.type,eventId:clean(d.id||('sha256:'+hash(rawBody)),200),resource:d.data};
  if(d.type==='event'&&d.attributes)return{eventType:clean(d.attributes.type,160),eventId:clean(d.id||('sha256:'+hash(rawBody)),200),resource:d.attributes.data};
  if(typeof body?.event_type==='string'&&d)return{eventType:clean(body.event_type,160),eventId:clean(d.id||('sha256:'+hash(rawBody)),200),resource:d};
  return{eventType:'unknown',eventId:'sha256:'+hash(rawBody),resource:d};
}

function checkoutAttrs(resource){
  if(resource?.attributes)return resource.attributes;
  if(resource?.data?.attributes)return resource.data.attributes;
  return{};
}

async function markProviderEvent(pool,id,status,errorCode=''){
  await pool.query("UPDATE provider_events SET processing_status=$1,error_code=$2,processed_at=NOW() WHERE id=$3",[status,clean(errorCode,120),id]);
}

export async function processPayMongoWebhook(pool,{rawBody,signatureHeader}){
  const sig=verifyPayMongoSignature(rawBody,signatureHeader);
  if(!sig.ok)throw Object.assign(new Error('Invalid PayMongo webhook signature: '+sig.reason),{status:400,code:'PAYMONGO_WEBHOOK_SIGNATURE_INVALID'});
  let body;try{body=JSON.parse(rawBody.toString('utf8'))}catch{throw Object.assign(new Error('PayMongo webhook body is not valid JSON'),{status:400})}
  const evt=normalizeEvent(body,rawBody);
  const resource=evt.resource||{},attrs=checkoutAttrs(resource),sessionId=clean(resource?.id||resource?.data?.id,200);
  const meta=attrs.metadata&&typeof attrs.metadata==='object'?attrs.metadata:{};
  let intent=null;
  const publicId=clean(meta.bl_payment_intent_public_id,120);
  if(publicId)intent=(await pool.query("SELECT * FROM payment_intents WHERE public_id=$1",[publicId])).rows[0]||null;
  if(!intent&&sessionId)intent=(await pool.query("SELECT * FROM payment_intents WHERE provider_session_id=$1",[sessionId])).rows[0]||null;
  const pe=await registerProviderEvent(pool,{providerCode:'paymongo',providerEventId:evt.eventId,eventType:evt.eventType,payload:body,signatureVerified:true,replayKey:evt.eventId,intentId:intent?.id||null});
  if(pe.processing_status==='processed')return{ok:true,duplicate:true,event_type:evt.eventType};
  if(evt.eventType!=='checkout_session.payment.paid'){await markProviderEvent(pool,pe.id,'ignored');return{ok:true,ignored:true,event_type:evt.eventType}}
  if(!intent){await markProviderEvent(pool,pe.id,'manual_review','payment_intent_not_found');return{ok:false,manual_review:true,reason:'payment_intent_not_found'}}

  const uniquePaid=[...new Map((Array.isArray(attrs.payments)?attrs.payments:[]).filter(p=>p?.attributes?.status==='paid').map(p=>[p.id,p])).values()];
  if(uniquePaid.length!==1){await markProviderEvent(pool,pe.id,'manual_review','unexpected_paid_payment_count');return{ok:false,manual_review:true,reason:'unexpected_paid_payment_count'}}
  const payment=uniquePaid[0],pa=payment.attributes||{};
  const amountCents=Number(pa.amount),currency=clean(pa.currency||'PHP',10).toUpperCase();
  if(!Number.isInteger(amountCents)||amountCents!==cents(intent.amount)||currency!=='PHP'){
    await markProviderEvent(pool,pe.id,'manual_review','amount_or_currency_mismatch');
    return{ok:false,manual_review:true,reason:'amount_or_currency_mismatch'};
  }
  const providerPaymentId=clean(payment.id,200);
  const providerIntentId=clean(attrs.payment_intent?.id||pa.payment_intent_id,200);
  const fee=money((Number(pa.fee)||0)/100),net=money((Number(pa.net_amount)||amountCents)/100);
  const sourceType=clean(pa.source?.type||'paymongo',60);

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const iq=await client.query("SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE",[intent.id]);
    const i=iq.rows[0];
    if(i.status==='succeeded'){await client.query("UPDATE provider_events SET processing_status='processed',processed_at=NOW() WHERE id=$1",[pe.id]);await client.query('COMMIT');return{ok:true,duplicate:true}}
    if(i.source_type!=='order')throw Object.assign(new Error('PayMongo confirmation only supports order intents in V0.14'),{status:409});
    if(i.provider_session_id&&sessionId&&i.provider_session_id!==sessionId){await client.query("UPDATE provider_events SET processing_status='manual_review',error_code='checkout_session_mismatch',processed_at=NOW() WHERE id=$1",[pe.id]);await client.query('COMMIT');return{ok:false,manual_review:true,reason:'checkout_session_mismatch'}}
    const oq=await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE",[i.source_id]);
    if(!oq.rowCount)throw Object.assign(new Error('Order not found for PayMongo payment'),{status:404});
    const o=oq.rows[0],outstanding=money(Number(o.total)-Number(o.paid_amount));
    if(Number(i.amount)>outstanding+0.001){
      await client.query("UPDATE provider_events SET processing_status='manual_review',error_code='outstanding_balance_changed',processed_at=NOW() WHERE id=$1",[pe.id]);
      await client.query('COMMIT');return{ok:false,manual_review:true,reason:'outstanding_balance_changed'};
    }
    const alloc=await client.query("SELECT component_code,amount FROM payment_allocations WHERE payment_intent_id=$1",[i.id]);
    const merchandise=money(alloc.rows.filter(x=>x.component_code==='merchandise').reduce((s,x)=>s+Number(x.amount),0));
    const delivery=money(alloc.rows.filter(x=>x.component_code==='delivery').reduce((s,x)=>s+Number(x.amount),0));
    const op=await client.query(
      "INSERT INTO order_payments(order_id,payment_intent_id,amount,merchandise_amount,delivery_amount,account,method_code,provider_code,provider_reference,status,received_by_account_id) VALUES($1,$2,$3,$4,$5,'other',$6,'paymongo',$7,'confirmed',NULL) ON CONFLICT(payment_intent_id) WHERE payment_intent_id IS NOT NULL DO UPDATE SET provider_reference=EXCLUDED.provider_reference RETURNING *",
      [o.id,i.id,i.amount,merchandise,delivery,sourceType,providerPaymentId]
    );
    const orderPaymentId=Number(op.rows[0].id),paid=money(Number(o.paid_amount)+Number(i.amount)),remaining=money(Number(o.total)-paid),paymentStatus=remaining<=0.001?'paid':'partial';
    await client.query("UPDATE orders SET paid_amount=$1,outstanding_amount=$2,payment_status=$3,updated_at=NOW() WHERE id=$4",[paid,remaining,paymentStatus,o.id]);
    if(merchandise>0)await client.query(
      "INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES($1,'sale',$2,$3,$4,'other',$5,'order_payment',$6,NOW()) ON CONFLICT DO NOTHING",
      [o.business_id,'Order '+(o.order_number||o.id),merchandise,sourceType,'PayMongo-confirmed merchandise payment for '+(o.order_number||o.id),orderPaymentId]
    );
    if(delivery>0){
      const dq=await client.query("SELECT id FROM deliveries WHERE order_id=$1",[o.id]);
      await client.query("INSERT INTO delivery_financial_events(order_id,delivery_id,event_type,amount,currency_code,source_payment_id) VALUES($1,$2,'delivery_fee_received',$3,$4,$5) ON CONFLICT(event_type,source_payment_id) DO NOTHING",[o.id,dq.rows[0]?.id||null,delivery,o.currency_code||'PHP',orderPaymentId]);
    }
    if(paymentStatus==='paid'&&o.order_status==='awaiting_payment'){
      await client.query("UPDATE orders SET order_status='accepted',accepted_at=COALESCE(accepted_at,NOW()),updated_at=NOW() WHERE id=$1",[o.id]);
      await client.query("INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,'awaiting_payment','accepted',NULL,'PayMongo webhook confirmed payment')",[o.id]);
    }
    await client.query("UPDATE payment_allocations SET settlement_status='eligible' WHERE payment_intent_id=$1 AND component_code IN ('merchandise','delivery') AND settlement_status='pending'",[i.id]);
    if(fee>0)await client.query(
      "INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,fee_policy_version_id,rule_snapshot,settlement_status) SELECT $1,'processor_fee','processor','paymongo',$2,$3,'PHP',NULL,$4::jsonb,'paid' WHERE NOT EXISTS(SELECT 1 FROM payment_allocations WHERE payment_intent_id=$1 AND component_code='processor_fee' AND economic_party_id='paymongo')",
      [i.id,i.amount,fee,JSON.stringify({provider:'paymongo',payment_id:providerPaymentId,checkout_session_id:sessionId,net_amount:net,fee_source:'verified_webhook'})]
    );
    await client.query(
      "UPDATE payment_intents SET status='succeeded',provider_code='paymongo',provider_session_id=$1,provider_payment_id=$2,provider_intent_id=$3,provider_status='paid',provider_fee=$4,provider_net_amount=$5,provider_payment_method=$6,succeeded_at=NOW(),updated_at=NOW() WHERE id=$7",
      [sessionId,providerPaymentId,providerIntentId,fee,net,sourceType,i.id]
    );
    await client.query("UPDATE payment_attempts SET status='succeeded',finished_at=NOW() WHERE payment_intent_id=$1 AND provider_code='paymongo' AND provider_attempt_id=$2",[i.id,sessionId]);
    await client.query("UPDATE provider_events SET processing_status='processed',processed_at=NOW() WHERE id=$1",[pe.id]);
    await client.query("INSERT INTO payment_audit_events(payment_intent_id,event_code,provider_code,after_json,correlation_id) VALUES($1,'paymongo_checkout_paid','paymongo',$2::jsonb,$3)",[i.id,JSON.stringify({checkout_session_id:sessionId,payment_id:providerPaymentId,payment_intent_id:providerIntentId,amount:Number(i.amount),fee,net_amount:net,payment_method:sourceType}),'paymongo-event:'+evt.eventId]);
    await client.query('COMMIT');
    return{ok:true,intent:await paymentIntentDetail(pool,i.id),order_id:o.id,payment_id:providerPaymentId};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});await markProviderEvent(pool,pe.id,'failed',clean(e.code||'processing_error',120)).catch(()=>{});throw e}finally{client.release()}
}


export async function payMongoLivePilotEvidence(pool){
  const q=await pool.query(`
    SELECT i.id,i.public_id,i.provider_payment_id,i.succeeded_at,
      EXISTS(
        SELECT 1 FROM provider_events pe
        WHERE pe.payment_intent_id=i.id
          AND pe.provider_code='paymongo'
          AND pe.signature_verified=TRUE
          AND pe.processing_status='processed'
      ) webhook_confirmed,
      EXISTS(
        SELECT 1
        FROM reconciliation_items ri
        JOIN reconciliation_runs rr ON rr.id=ri.reconciliation_run_id
        WHERE rr.provider_code='paymongo'
          AND rr.status='matched'
          AND ri.item_type='payment'
          AND ri.internal_ref=i.public_id
          AND ri.provider_ref=i.provider_payment_id
          AND ri.status='matched'
      ) reconciliation_matched,
      (
        SELECT rr.public_id
        FROM reconciliation_items ri
        JOIN reconciliation_runs rr ON rr.id=ri.reconciliation_run_id
        WHERE rr.provider_code='paymongo'
          AND rr.status='matched'
          AND ri.item_type='payment'
          AND ri.internal_ref=i.public_id
          AND ri.provider_ref=i.provider_payment_id
          AND ri.status='matched'
        ORDER BY rr.completed_at DESC NULLS LAST,rr.id DESC
        LIMIT 1
      ) reconciliation_run_public_id
    FROM payment_intents i
    WHERE i.provider_code='paymongo'
      AND i.status='succeeded'
      AND i.provider_payment_id<>''
      AND EXISTS(
        SELECT 1 FROM payment_attempts a
        WHERE a.payment_intent_id=i.id
          AND a.provider_code='paymongo'
          AND a.status='succeeded'
          AND COALESCE(a.metadata_json->>'mode','')='live'
      )
    ORDER BY i.succeeded_at DESC NULLS LAST,i.id DESC
    LIMIT 1
  `);
  const row=q.rows[0]||null;
  return{
    live_payment_confirmed:Boolean(row?.webhook_confirmed),
    live_reconciliation_matched:Boolean(row?.reconciliation_matched),
    latest_live_intent_public_id:row?.public_id||'',
    latest_live_provider_payment_id:row?.provider_payment_id||'',
    latest_live_succeeded_at:row?.succeeded_at||null,
    reconciliation_run_public_id:row?.reconciliation_run_public_id||''
  };
}

async function findPayMongoPaymentById(providerPaymentId){
  let after='';
  for(let page=0;page<20;page++){
    const query=new URLSearchParams({limit:'100'});
    if(after)query.set('after',after);
    const json=await payMongoRequest('/v1/payments?'+query.toString());
    const rows=Array.isArray(json?.data)?json.data:[];
    const found=rows.find(x=>String(x?.id||'')===String(providerPaymentId));
    if(found)return found;
    if(rows.length<100)break;
    const next=clean(rows[rows.length-1]?.id,220);
    if(!next||next===after)break;
    after=next;
  }
  return null;
}

export async function reconcilePayMongoLivePayment(pool,{intentPublicId,actorAccountId=null}={}){
  const cfg=payMongoRuntimeConfig();
  if(cfg.mode!=='live'||cfg.keyMode!=='live'||!cfg.liveAllowed||!cfg.secretReady){
    throw Object.assign(new Error('PayMongo live mode and live secret key are required for live reconciliation'),{status:409,code:'PAYMONGO_LIVE_RECONCILIATION_NOT_READY'});
  }
  const q=await pool.query(`
    SELECT i.*,
      EXISTS(
        SELECT 1 FROM payment_attempts a
        WHERE a.payment_intent_id=i.id
          AND a.provider_code='paymongo'
          AND a.status='succeeded'
          AND COALESCE(a.metadata_json->>'mode','')='live'
      ) live_attempt,
      EXISTS(
        SELECT 1 FROM provider_events pe
        WHERE pe.payment_intent_id=i.id
          AND pe.provider_code='paymongo'
          AND pe.signature_verified=TRUE
          AND pe.processing_status='processed'
      ) verified_webhook
    FROM payment_intents i
    WHERE i.public_id=$1 AND i.provider_code='paymongo' AND i.status='succeeded'
  `,[clean(intentPublicId,120)]);
  if(!q.rowCount)throw Object.assign(new Error('Confirmed PayMongo payment intent not found'),{status:404});
  const i=q.rows[0];
  if(!i.live_attempt||!i.verified_webhook)throw Object.assign(new Error('This payment does not have verified LIVE PayMongo evidence'),{status:409,code:'PAYMONGO_LIVE_EVIDENCE_REQUIRED'});
  if(!i.provider_payment_id)throw Object.assign(new Error('PayMongo payment reference is missing'),{status:409});

  const existing=await pool.query(`
    SELECT rr.* FROM reconciliation_items ri
    JOIN reconciliation_runs rr ON rr.id=ri.reconciliation_run_id
    WHERE rr.provider_code='paymongo'
      AND rr.status='matched'
      AND ri.item_type='payment'
      AND ri.internal_ref=$1
      AND ri.provider_ref=$2
      AND ri.status='matched'
    ORDER BY rr.id DESC LIMIT 1
  `,[i.public_id,i.provider_payment_id]);
  if(existing.rowCount)return{matched:true,reused:true,run:existing.rows[0],evidence:await payMongoLivePilotEvidence(pool)};

  const provider=await findPayMongoPaymentById(i.provider_payment_id);
  if(!provider)throw Object.assign(new Error('PayMongo API did not return the confirmed provider payment'),{status:409,code:'PAYMONGO_PROVIDER_PAYMENT_NOT_FOUND'});
  const a=provider.attributes||{};
  const providerAmount=money((Number(a.amount)||0)/100);
  const providerFee=money((Number(a.fee)||0)/100);
  const providerNet=money((Number(a.net_amount)||Number(a.amount)||0)/100);
  const providerCurrency=clean(a.currency||'',10).toUpperCase();
  const providerStatus=clean(a.status||'',40);
  const providerLive=Boolean(a.livemode);
  const mismatch=[];
  if(providerStatus!=='paid')mismatch.push('provider_status_not_paid');
  if(!providerLive)mismatch.push('provider_payment_not_live');
  if(providerCurrency!=='PHP')mismatch.push('currency_mismatch');
  if(Math.abs(providerAmount-Number(i.amount))>0.001)mismatch.push('amount_mismatch');
  if(Math.abs(providerFee-Number(i.provider_fee||0))>0.001)mismatch.push('processor_fee_mismatch');
  if(Math.abs(providerNet-Number(i.provider_net_amount||0))>0.001)mismatch.push('provider_net_amount_mismatch');

  const runPublic='rec_paymongo_'+crypto.randomBytes(12).toString('hex');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const run=await client.query(`
      INSERT INTO reconciliation_runs(
        public_id,provider_code,period_start,period_end,status,
        internal_payment_total,provider_payment_total,
        internal_settlement_total,provider_settlement_total,
        mismatch_count,statement_sha256,started_by_account_id,completed_at
      ) VALUES($1,'paymongo',COALESCE($2::timestamptz,NOW()),NOW(),$3,$4,$5,0,0,$6,$7,$8,NOW())
      RETURNING *
    `,[
      runPublic,i.succeeded_at,mismatch.length?'mismatch':'matched',
      money(i.amount),providerAmount,mismatch.length,
      hash(JSON.stringify({id:provider.id,status:providerStatus,livemode:providerLive,amount:a.amount,currency:providerCurrency,fee:a.fee,net_amount:a.net_amount})),
      actorAccountId||null
    ]);
    const itemStatus=mismatch.includes('amount_mismatch')?'amount_mismatch':(mismatch.length?'manual_review':'matched');
    await client.query(`
      INSERT INTO reconciliation_items(
        reconciliation_run_id,item_type,internal_ref,provider_ref,
        internal_amount,provider_amount,variance,status,detail_json
      ) VALUES($1,'payment',$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,[
      run.rows[0].id,i.public_id,i.provider_payment_id,money(i.amount),providerAmount,
      money(providerAmount-Number(i.amount)),itemStatus,
      JSON.stringify({
        mode:'live',
        provider_status:providerStatus,
        provider_livemode:providerLive,
        internal_processor_fee:money(i.provider_fee||0),
        provider_processor_fee:providerFee,
        internal_net_amount:money(i.provider_net_amount||0),
        provider_net_amount:providerNet,
        mismatch_codes:mismatch
      })
    ]);
    await client.query(`
      INSERT INTO payment_audit_events(
        actor_account_id,payment_intent_id,event_code,provider_code,after_json,correlation_id
      ) VALUES($1,$2,$3,'paymongo',$4::jsonb,$5)
    `,[
      actorAccountId||null,i.id,
      mismatch.length?'paymongo_live_reconciliation_mismatch':'paymongo_live_reconciliation_matched',
      JSON.stringify({run_public_id:runPublic,provider_payment_id:i.provider_payment_id,mismatch_codes:mismatch}),
      'paymongo-reconciliation:'+i.provider_payment_id
    ]);
    await client.query('COMMIT');
    return{matched:mismatch.length===0,reused:false,run:run.rows[0],mismatch_codes:mismatch,evidence:await payMongoLivePilotEvidence(pool)};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

export async function executePayMongoRefund(pool,{refundId,actorAccountId=null}){
  const cfg=payMongoRuntimeConfig();
  const q=await pool.query("SELECT r.*,i.provider_code,i.provider_payment_id,i.public_id intent_public_id FROM refunds r JOIN payment_intents i ON i.id=r.payment_intent_id WHERE r.id=$1",[Number(refundId)]);
  if(!q.rowCount)throw Object.assign(new Error('Refund not found'),{status:404});
  const r=q.rows[0];
  if(r.provider_code!=='paymongo'||!r.provider_payment_id)throw Object.assign(new Error('Refund is not linked to a confirmed PayMongo payment'),{status:409});
  if(r.status==='succeeded')return r;
  if(!['requested','failed','manual_review'].includes(r.status))throw Object.assign(new Error('Refund is already being processed'),{status:409});
  let reason='others';
  const low=String(r.reason||'').toLowerCase();
  if(low.includes('duplicate'))reason='duplicate';else if(low.includes('fraud'))reason='fraudulent';
  const body={data:{attributes:{amount:cents(r.amount),payment_id:r.provider_payment_id,reason,notes:clean(r.reason||'Business & Life refund',255)}}};
  await pool.query("UPDATE refunds SET status='processing',provider_status='requesting' WHERE id=$1",[r.id]);
  try{
    const json=await payMongoRequest('/v1/refunds',{method:'POST',body,idempotencyKey:'bl-refund-'+r.public_id});
    const ref=json?.data,attrs=ref?.attributes||{},status=clean(attrs.status||'processing',40);
    const mapped=['succeeded','failed','processing','pending'].includes(status)?status:'processing';
    await pool.query("UPDATE refunds SET provider_refund_id=$1,status=$2,provider_status=$3,processed_at=CASE WHEN $2='succeeded' THEN NOW() ELSE processed_at END WHERE id=$4",[clean(ref?.id,200),mapped,status,r.id]);
    if(mapped==='succeeded'){
      await pool.query("INSERT INTO payment_allocations(payment_intent_id,component_code,economic_party_type,economic_party_id,gross_base,amount,currency_code,rule_snapshot,settlement_status) VALUES($1,'refund','customer_refund','',$2,$3,$4,$5::jsonb,'paid')",[r.payment_intent_id,r.amount,-Math.abs(Number(r.amount)),r.currency_code||'PHP',JSON.stringify({provider:'paymongo',refund_id:ref?.id,payment_id:r.provider_payment_id})]);
      const total=await pool.query("SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE payment_intent_id=$1 AND status='succeeded'",[r.payment_intent_id]);
      const intent=await pool.query("SELECT amount FROM payment_intents WHERE id=$1",[r.payment_intent_id]);
      const full=money(total.rows[0].total)>=money(intent.rows[0].amount)-0.001;
      await pool.query("UPDATE payment_intents SET status=$1,updated_at=NOW() WHERE id=$2",[full?'refunded':'partially_refunded',r.payment_intent_id]);
    }
    await pool.query("INSERT INTO payment_audit_events(actor_account_id,payment_intent_id,event_code,provider_code,after_json,correlation_id) VALUES($1,$2,'paymongo_refund_requested','paymongo',$3::jsonb,$4)",[actorAccountId,r.payment_intent_id,JSON.stringify({refund_id:ref?.id,status:mapped,amount:Number(r.amount)}),'paymongo-refund:'+r.public_id]);
    return (await pool.query("SELECT * FROM refunds WHERE id=$1",[r.id])).rows[0];
  }catch(e){
    await pool.query("UPDATE refunds SET status='failed',provider_status=$1 WHERE id=$2",[clean(e.code||e.message,120),r.id]).catch(()=>{});
    throw e;
  }
}
