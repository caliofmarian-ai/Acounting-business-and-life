import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import {
  resendProviderEventTypes,
  resendProviderStatus,
  verifyResendWebhook
} from '../resend-delivery-observability.js';

const core=readFileSync(new URL('../resend-delivery-observability.js',import.meta.url),'utf8');
const notifications=readFileSync(new URL('../notification-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-notifications.js',import.meta.url),'utf8');

function signedEvent(event,{timestamp=Math.floor(Date.now()/1000)}={}){
  const raw=Buffer.from(JSON.stringify(event),'utf8');
  const secretBytes=Buffer.from('business-life-resend-test-secret-32b');
  const secret='whsec_'+secretBytes.toString('base64');
  const id='msg_test_'+Date.now();
  const signature='v1,'+crypto.createHmac('sha256',secretBytes)
    .update(id+'.'+timestamp+'.'+raw.toString('utf8'),'utf8')
    .digest('base64');
  return{
    raw,secret,
    headers:{
      'svix-id':id,
      'svix-timestamp':String(timestamp),
      'svix-signature':signature
    }
  };
}

test('Resend observability accepts only the delivery outcome event families we use',()=>{
  assert.deepEqual(resendProviderEventTypes(),[
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed'
  ]);
  assert.equal(resendProviderStatus('email.delivered'),'delivered');
  assert.equal(resendProviderStatus('email.delivery_delayed'),'delivery_delayed');
  assert.equal(resendProviderStatus('email.bounced'),'bounced');
  assert.equal(resendProviderStatus('email.opened'),'');
});

test('valid Svix-signed Resend payload verifies from raw bytes',()=>{
  const event={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'email_test_123'}};
  const signed=signedEvent(event);
  const out=verifyResendWebhook({rawBody:signed.raw,headers:signed.headers,secret:signed.secret});
  assert.equal(out.event.type,'email.delivered');
  assert.equal(out.event.data.email_id,'email_test_123');
  assert.equal(out.providerEventId,signed.headers['svix-id']);
  assert.match(out.payloadDigest,/^[a-f0-9]{64}$/);
});

test('altering the raw body invalidates the Resend webhook signature',()=>{
  const event={type:'email.bounced',created_at:new Date().toISOString(),data:{email_id:'email_test_456'}};
  const signed=signedEvent(event);
  const altered=Buffer.from(JSON.stringify({...event,type:'email.delivered'}),'utf8');
  assert.throws(
    ()=>verifyResendWebhook({rawBody:altered,headers:signed.headers,secret:signed.secret}),
    /Invalid Resend webhook signature/
  );
});

test('stale signed Resend webhook is rejected to prevent replay',()=>{
  const event={type:'email.sent',created_at:new Date().toISOString(),data:{email_id:'email_test_stale'}};
  const timestamp=Math.floor(Date.now()/1000)-301;
  const signed=signedEvent(event,{timestamp});
  assert.throws(
    ()=>verifyResendWebhook({rawBody:signed.raw,headers:signed.headers,secret:signed.secret}),
    /Invalid Resend webhook timestamp/
  );
});

test('webhook route preserves exact raw bytes in embedded and standalone runtimes',()=>{
  assert.match(server,/\/api\/notifications\/webhooks\/resend/);
  assert.match(server,/express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(server,/Buffer\.isBuffer\(req\.rawBody\)&&req\.rawBody\.length/);
  assert.match(server,/\?req\.rawBody/);
  assert.match(server,/Buffer\.isBuffer\(req\.body\)\?req\.body:null/);
  assert.match(server,/if\(!rawBody\)throw Object\.assign\(new Error\('Resend raw body is required'\)/);
  assert.match(server,/verifyResendWebhook\(\{\s*rawBody,/s);
  assert.match(server,/RESEND_WEBHOOK_SECRET/);
  assert.match(server,/recordResendProviderEvent/);
  assert.doesNotMatch(server,/JSON\.stringify\(req\.body\?\?\{\}\).*verifyResendWebhook/s);
});

test('provider evidence is idempotent and stores minimized delivery metadata only',()=>{
  assert.match(core,/UNIQUE\(provider,provider_event_id\)/);
  assert.match(core,/payload_digest TEXT NOT NULL/);
  assert.match(core,/provider_reference TEXT NOT NULL/);
  assert.match(core,/delivery_id BIGINT REFERENCES notification_deliveries/);
  assert.doesNotMatch(core,/recipient_email|email_body|email_subject|raw_payload/);
  assert.doesNotMatch(core,/event\?\.data\?\.(to|from|subject|html|text)/);
});

test('accepted Resend sends reconcile any provider event that won the timing race',()=>{
  assert.match(notifications,/provider_status='accepted'/);
  assert.match(notifications,/reconcileResendDeliveryFromEvents\(pool,deliveryId,sent\.reference/);
  assert.match(notifications,/reconcileResendDeliveryFromEvents\(pool,row\.id,reference/);
});

test('provider outcome is separate from legacy internal delivery status',()=>{
  assert.match(core,/ADD COLUMN IF NOT EXISTS provider_status TEXT NOT NULL DEFAULT ''/);
  assert.match(core,/ADD COLUMN IF NOT EXISTS provider_last_event_at TIMESTAMPTZ/);
  assert.match(core,/provider_last_event_at IS NULL OR provider_last_event_at<=\$2/);
  assert.match(notifications,/status='delivered'.*provider_status='accepted'/s);
});
