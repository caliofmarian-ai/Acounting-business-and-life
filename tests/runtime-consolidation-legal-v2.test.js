import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const publicServer=read('server-paymongo.js');
const paymentServer=read('server-payments.js');
const legalServer=read('server-legal.js');
const notificationServer=read('server-notifications.js');

test('Payment Core mounts Legal in-process instead of spawning port 4507',()=>{
  assert.match(paymentServer,/startEmbeddedLegal/);
  assert.match(paymentServer,/mountLegalApp/);
  assert.match(paymentServer,/app\.use\(legalApp\)/);
  assert.doesNotMatch(paymentServer,/spawn\(process\.execPath,\['server-legal\.js'\]/);
  assert.doesNotMatch(paymentServer,/INTERNAL_LEGAL_PORT/);
  assert.doesNotMatch(paymentServer,/\|\|4507/);
  assert.doesNotMatch(paymentServer,/Legal child failed health check/);
});

test('Legal remains standalone-capable and owns the remaining Notifications child boundary',()=>{
  assert.match(legalServer,/export async function startEmbeddedLegal/);
  assert.match(legalServer,/export async function stopEmbeddedLegal/);
  assert.match(legalServer,/directExecution/);
  assert.match(legalServer,/startupWaitAttempts\(340\)/);
  assert.match(legalServer,/spawn\(process\.execPath,\['server-notifications\.js'\]/);
  assert.match(legalServer,/Business & Life legal\/consent gateway listening on/);
});

test('Resend signed payload bytes survive public JSON parsing and embedded Legal',()=>{
  assert.match(publicServer,/verify:\(req,_res,buf\)=>\{req\.rawBody=Buffer\.from\(buf\)\}/);
  assert.match(legalServer,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.match(legalServer,/const payload=rawPayload\|\|/);
  assert.match(legalServer,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(legalServer,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
  assert.match(notificationServer,/express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(notificationServer,/verifyResendWebhook/);
});

test('public and Payment Core internal identity calls bypass retired Legal port',()=>{
  assert.match(publicServer,/INTERNAL_NOTIFICATIONS_PORT\|\|4407/);
  assert.match(paymentServer,/INTERNAL_NOTIFICATIONS_PORT\|\|4407/);
  assert.doesNotMatch(publicServer,/INTERNAL_LEGAL_PORT/);
  assert.doesNotMatch(publicServer,/\|\|4507/);
});

test('Payment Core health reflects embedded Legal readiness without a Legal child handle',()=>{
  assert.match(paymentServer,/let legalReady=false/);
  assert.match(paymentServer,/const childAlive=legalReady/);
  assert.match(paymentServer,/legalReady=true/);
  assert.match(paymentServer,/stopEmbeddedLegal/);
  assert.doesNotMatch(paymentServer,/let child;/);
});
