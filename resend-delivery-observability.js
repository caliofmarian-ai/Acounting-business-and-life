import crypto from 'node:crypto';
const SUPPORTED_RESEND_EVENTS=new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed'
]);

const STATUS_BY_EVENT=Object.freeze({
  'email.sent':'sent',
  'email.delivered':'delivered',
  'email.delivery_delayed':'delivery_delayed',
  'email.bounced':'bounced',
  'email.complained':'complained',
  'email.failed':'failed',
  'email.suppressed':'suppressed'
});

const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const headerValue=v=>Array.isArray(v)?clean(v[0],1000):clean(v,1000);
const digest=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:Buffer.from(String(v??''),'utf8')).digest('hex');

export function resendProviderEventTypes(){return [...SUPPORTED_RESEND_EVENTS]}

export function resendProviderStatus(eventType=''){
  return STATUS_BY_EVENT[clean(eventType,80)]||'';
}

export function verifyResendWebhook({rawBody,headers={},secret='',now=Date.now()}) {
  const webhookSecret=clean(secret,500);
  if(!webhookSecret)throw Object.assign(new Error('Resend webhook is not configured'),{status:503,code:'resend_webhook_not_configured'});
  const payload=Buffer.isBuffer(rawBody)?rawBody.toString('utf8'):String(rawBody??'');
  if(!payload)throw Object.assign(new Error('Empty webhook payload'),{status:400,code:'empty_webhook_payload'});
  const id=headerValue(headers['svix-id']??headers['Svix-Id']);
  const timestampRaw=headerValue(headers['svix-timestamp']??headers['Svix-Timestamp']);
  const signatureHeader=headerValue(headers['svix-signature']??headers['Svix-Signature']);
  if(!id||!timestampRaw||!signatureHeader)throw Object.assign(new Error('Missing webhook signature headers'),{status:400,code:'missing_webhook_signature'});

  const timestamp=Number.parseInt(timestampRaw,10);
  const nowSeconds=Math.floor(Number(now)/1000);
  if(!Number.isFinite(timestamp)||Math.abs(nowSeconds-timestamp)>300){
    throw Object.assign(new Error('Invalid Resend webhook timestamp'),{status:400,code:'invalid_webhook_timestamp'});
  }

  let key;
  try{
    const encoded=webhookSecret.startsWith('whsec_')?webhookSecret.slice(6):webhookSecret;
    key=Buffer.from(encoded,'base64');
  }catch{
    throw Object.assign(new Error('Invalid Resend webhook secret'),{status:500,code:'invalid_webhook_secret'});
  }
  if(!key.length)throw Object.assign(new Error('Invalid Resend webhook secret'),{status:500,code:'invalid_webhook_secret'});

  const signedContent=id+'.'+timestamp+'.'+payload;
  const expected=crypto.createHmac('sha256',key).update(signedContent,'utf8').digest('base64');
  const valid=signatureHeader.split(/\s+/).some(item=>{
    const comma=item.indexOf(',');
    if(comma<0||item.slice(0,comma)!=='v1')return false;
    const received=item.slice(comma+1);
    const a=Buffer.from(received,'utf8'),b=Buffer.from(expected,'utf8');
    return a.length===b.length&&crypto.timingSafeEqual(a,b);
  });
  if(!valid)throw Object.assign(new Error('Invalid Resend webhook signature'),{status:400,code:'invalid_webhook_signature'});

  let event;
  try{event=JSON.parse(payload)}catch{throw Object.assign(new Error('Invalid Resend webhook body'),{status:400,code:'invalid_webhook_body'})}
  if(!event||typeof event!=='object')throw Object.assign(new Error('Invalid Resend webhook body'),{status:400,code:'invalid_webhook_body'});
  return{event,providerEventId:id,payloadDigest:digest(rawBody)};
}

export async function ensureResendObservabilitySchema(pool){
  await pool.query(`
    ALTER TABLE notification_deliveries
      ADD COLUMN IF NOT EXISTS provider_status TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS provider_last_event_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS notification_provider_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      provider_reference TEXT NOT NULL,
      delivery_id BIGINT REFERENCES notification_deliveries(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      payload_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider,provider_event_id)
    );
    CREATE INDEX IF NOT EXISTS notification_provider_events_reference_idx
      ON notification_provider_events(provider,provider_reference,occurred_at DESC);
    CREATE INDEX IF NOT EXISTS notification_provider_events_delivery_idx
      ON notification_provider_events(delivery_id,occurred_at DESC);
  `);
}

async function updateDeliveryProviderState(client,deliveryId,eventType,occurredAt){
  const providerStatus=resendProviderStatus(eventType);
  if(!providerStatus||!Number(deliveryId))return;
  await client.query(`
    UPDATE notification_deliveries
    SET provider_status=$1,provider_last_event_at=$2,updated_at=NOW()
    WHERE id=$3
      AND (provider_last_event_at IS NULL OR provider_last_event_at<=$2)
  `,[providerStatus,occurredAt,Number(deliveryId)]);
}

export async function recordResendProviderEvent(pool,{providerEventId,event,payloadDigest=''}) {
  const eventType=clean(event?.type,80);
  if(!SUPPORTED_RESEND_EVENTS.has(eventType))return{ignored:true,event_type:eventType||'unknown'};
  const providerReference=clean(event?.data?.email_id,300);
  if(!providerReference)throw Object.assign(new Error('Resend event has no email_id'),{status:400,code:'resend_email_id_missing'});
  const occurredAt=new Date(event?.created_at||event?.data?.created_at||'');
  if(Number.isNaN(occurredAt.getTime()))throw Object.assign(new Error('Resend event has an invalid timestamp'),{status:400,code:'resend_event_timestamp_invalid'});
  const eventId=clean(providerEventId,300);
  if(!eventId)throw Object.assign(new Error('Resend event has no provider event id'),{status:400,code:'resend_event_id_missing'});
  const payloadHash=clean(payloadDigest,128);
  if(!/^[a-f0-9]{64}$/i.test(payloadHash))throw Object.assign(new Error('Resend event digest is invalid'),{status:400,code:'resend_event_digest_invalid'});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const delivery=await client.query(`
      SELECT id FROM notification_deliveries
      WHERE provider='resend' AND provider_reference=$1
      ORDER BY id DESC LIMIT 1
      FOR UPDATE
    `,[providerReference]);
    const deliveryId=Number(delivery.rows[0]?.id)||null;
    const inserted=await client.query(`
      INSERT INTO notification_provider_events(
        provider,provider_event_id,provider_reference,delivery_id,event_type,occurred_at,payload_digest
      ) VALUES('resend',$1,$2,$3,$4,$5,$6)
      ON CONFLICT(provider,provider_event_id) DO NOTHING
      RETURNING id
    `,[eventId,providerReference,deliveryId,eventType,occurredAt.toISOString(),payloadHash]);

    if(!inserted.rowCount){
      if(deliveryId)await client.query(`
        UPDATE notification_provider_events SET delivery_id=$1
        WHERE provider='resend' AND provider_event_id=$2 AND delivery_id IS NULL
      `,[deliveryId,eventId]);
      await client.query('COMMIT');
      return{duplicate:true,matched:Boolean(deliveryId),delivery_id:deliveryId,event_type:eventType};
    }

    if(deliveryId)await updateDeliveryProviderState(client,deliveryId,eventType,occurredAt.toISOString());
    await client.query('COMMIT');
    return{recorded:true,matched:Boolean(deliveryId),delivery_id:deliveryId,event_type:eventType};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release()}
}

export async function reconcileResendDeliveryFromEvents(pool,deliveryId,providerReference){
  const id=Number(deliveryId),reference=clean(providerReference,300);
  if(!id||!reference)return{matched:false};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`
      UPDATE notification_provider_events SET delivery_id=$1
      WHERE provider='resend' AND provider_reference=$2 AND delivery_id IS NULL
    `,[id,reference]);
    const latest=await client.query(`
      SELECT event_type,occurred_at FROM notification_provider_events
      WHERE provider='resend' AND provider_reference=$1
      ORDER BY occurred_at DESC,id DESC LIMIT 1
    `,[reference]);
    if(latest.rowCount)await updateDeliveryProviderState(client,id,latest.rows[0].event_type,latest.rows[0].occurred_at);
    await client.query('COMMIT');
    return{matched:Boolean(latest.rowCount),event_type:latest.rows[0]?.event_type||''};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release()}
}
