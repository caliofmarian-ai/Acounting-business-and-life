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
  assert.match(paymentServer,/app\.use\(appInstance\)/);
  assert.doesNotMatch(paymentServer,/spawn\(process\.execPath,\['server-legal\.js'\]/);
  assert.doesNotMatch(paymentServer,/INTERNAL_LEGAL_PORT/);
  assert.doesNotMatch(paymentServer,/\|\|4507/);
  assert.doesNotMatch(paymentServer,/Legal child failed health check/);
});

test('Legal embeds Notifications and retires localhost port 4407',()=>{
  assert.match(legalServer,/startEmbeddedNotifications/);
  assert.match(legalServer,/stopEmbeddedNotifications/);
  assert.match(legalServer,/notificationsApp=await startEmbeddedNotifications\(\)/);
  assert.match(legalServer,/notificationsReady=true/);
  assert.doesNotMatch(legalServer,/INTERNAL_NOTIFICATIONS_PORT/);
  assert.doesNotMatch(legalServer,/\|\|4407/);
  assert.doesNotMatch(legalServer,/127\.0\.0\.1:4407/);
  assert.doesNotMatch(legalServer,/spawn\(process\.execPath,\['server-notifications\.js'\]/);
  assert.doesNotMatch(legalServer,/Notification child failed health check/);
  assert.match(legalServer,/Business & Life legal\/consent mounted in-process/);
});

test('Notifications remains standalone rollback-capable while exposing embedded lifecycle',()=>{
  assert.match(notificationServer,/export async function startEmbeddedNotifications\(\)/);
  assert.match(notificationServer,/export async function stopEmbeddedNotifications\(\)/);
  assert.match(notificationServer,/directExecution/);
  assert.match(notificationServer,/Business & Life notification gateway mounted in-process/);
  assert.match(notificationServer,/Business & Life notification gateway listening on/);
  assert.match(notificationServer,/startEmbeddedAdminOperations/);
});

test('Resend signed payload bytes survive public JSON parsing and in-process Legal dispatch',()=>{
  assert.match(publicServer,/verify:\(req,_res,buf\)=>\{req\.rawBody=Buffer\.from\(buf\)\}/);
  assert.match(notificationServer,/Buffer\.isBuffer\(req\.rawBody\)&&req\.rawBody\.length/);
  assert.match(notificationServer,/\?req\.rawBody/);
  assert.match(notificationServer,/Buffer\.isBuffer\(req\.body\)\?req\.body:null/);
  assert.match(notificationServer,/verifyResendWebhook\(\{\s*rawBody,/s);
  assert.doesNotMatch(legalServer,/JSON\.stringify\(req\.body\?\?\{\}\).*webhook/s);
  assert.doesNotMatch(legalServer,/http\.request/);
});

test('public Payment Core and Legal have no localhost Notifications dependency',()=>{
  for(const source of [publicServer,paymentServer,legalServer]){
    assert.doesNotMatch(source,/INTERNAL_NOTIFICATIONS_PORT/);
    assert.doesNotMatch(source,/\|\|4407/);
    assert.doesNotMatch(source,/127\.0\.0\.1:4407/);
  }
  assert.match(publicServer,/authHardeningFetch/);
  assert.match(paymentServer,/authHardeningFetch/);
  assert.match(paymentServer,/notificationsFetch/);
  assert.match(legalServer,/notificationsFetch/);
});

test('Payment Core health reflects embedded Legal readiness without a Legal child handle',()=>{
  assert.match(paymentServer,/let legalReady=false/);
  assert.match(paymentServer,/const childAlive=legalReady/);
  assert.match(paymentServer,/legalReady=true/);
  assert.match(paymentServer,/stopEmbeddedLegal/);
  assert.doesNotMatch(paymentServer,/let child;/);
});
