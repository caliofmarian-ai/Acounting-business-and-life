import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapResendWebhook,
  canonicalResendWebhookUrl,
  resendDeliveryWebhookEvents,
  resendWebhookReadiness
} from '../resend-webhook-bootstrap.js';

const jsonResponse=(status,body)=>({
  ok:status>=200&&status<300,
  status,
  async json(){return body}
});

test('canonical Resend webhook URL is derived from the public app base',()=>{
  assert.equal(
    canonicalResendWebhookUrl('https://caliof.com/some/path?x=1'),
    'https://caliof.com/api/notifications/webhooks/resend'
  );
  assert.equal(canonicalResendWebhookUrl('javascript:alert(1)'),'');
});

test('explicit Railway webhook secret always wins without calling Resend',async()=>{
  let calls=0;
  const result=await bootstrapResendWebhook({
    env:{
      AUTH_EMAIL_PROVIDER:'resend',
      AUTH_PUBLIC_BASE_URL:'https://caliof.com',
      RESEND_WEBHOOK_SECRET:'whsec_explicit',
      RESEND_WEBHOOK_AUTO_BOOTSTRAP:'true',
      RESEND_API_KEY:'re_should_not_be_used'
    },
    fetchImpl:async()=>{calls++;throw new Error('should not call')}
  });
  assert.equal(result.ready,true);
  assert.equal(result.source,'env');
  assert.equal(result.secret,'whsec_explicit');
  assert.equal(calls,0);
});

test('automatic bootstrap reuses exact existing webhook and secret',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body||''});
    return jsonResponse(200,{
      data:[{
        id:'wh_existing',
        endpoint:'https://caliof.com/api/notifications/webhooks/resend',
        signing_secret:'whsec_reused'
      }]
    });
  };
  const result=await bootstrapResendWebhook({
    env:{
      AUTH_EMAIL_PROVIDER:'resend',
      AUTH_PUBLIC_BASE_URL:'https://caliof.com',
      RESEND_WEBHOOK_AUTO_BOOTSTRAP:'true',
      RESEND_API_KEY:'re_test'
    },fetchImpl
  });
  assert.equal(result.ready,true);
  assert.equal(result.status,'reused');
  assert.equal(result.secret,'whsec_reused');
  assert.equal(calls.length,1);
});

test('automatic bootstrap creates one missing webhook with delivery events only',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body||''});
    if((options.method||'GET')==='GET')return jsonResponse(200,{data:[]});
    return jsonResponse(200,{
      id:'wh_created',
      signing_secret:'whsec_created'
    });
  };
  const result=await bootstrapResendWebhook({
    env:{
      AUTH_EMAIL_PROVIDER:'resend',
      AUTH_PUBLIC_BASE_URL:'https://caliof.com',
      RESEND_WEBHOOK_AUTO_BOOTSTRAP:'true',
      RESEND_API_KEY:'re_test'
    },fetchImpl
  });
  assert.equal(result.ready,true);
  assert.equal(result.status,'created');
  assert.equal(calls.length,2);
  const payload=JSON.parse(calls[1].body);
  assert.equal(payload.endpoint,'https://caliof.com/api/notifications/webhooks/resend');
  assert.deepEqual(payload.events,resendDeliveryWebhookEvents());
  assert.equal(payload.events.includes('email.received'),false);
  assert.equal(payload.events.includes('email.opened'),false);
  assert.equal(payload.events.includes('email.clicked'),false);
});

test('sending-only or unauthorized API key fails closed without crashing startup',async()=>{
  const result=await bootstrapResendWebhook({
    env:{
      AUTH_EMAIL_PROVIDER:'resend',
      AUTH_PUBLIC_BASE_URL:'https://caliof.com',
      RESEND_WEBHOOK_AUTO_BOOTSTRAP:'true',
      RESEND_API_KEY:'re_send_only'
    },
    fetchImpl:async()=>jsonResponse(403,{message:'forbidden'})
  });
  assert.equal(result.ready,false);
  assert.equal(result.status,'list_http_403');
  assert.equal(result.secret,'');
});

test('readiness projection never exposes the signing secret',()=>{
  const publicState=resendWebhookReadiness({
    ready:true,status:'created',source:'resend_api',endpoint:'https://caliof.com/api/notifications/webhooks/resend',webhook_id:'wh_1',secret:'whsec_private'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(publicState,'secret'),false);
  assert.equal(publicState.ready,true);
});
