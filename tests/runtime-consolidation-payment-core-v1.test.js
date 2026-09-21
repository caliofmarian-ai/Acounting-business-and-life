import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const publicServer=read('server-paymongo.js');
const paymentServer=read('server-payments.js');
const legalServer=read('server-legal.js');

test('public runtime mounts Payment Core in-process instead of spawning port 4607',()=>{
  assert.match(publicServer,/startEmbeddedPaymentCore/);
  assert.match(publicServer,/app\.use\(paymentApp\)/);
  assert.doesNotMatch(publicServer,/spawn\(process\.execPath,\['server-payments\.js'\]/);
  assert.doesNotMatch(publicServer,/INTERNAL_PAYMENTS_PORT/);
  assert.doesNotMatch(publicServer,/\|\|4607/);
  assert.doesNotMatch(publicServer,/Payment Core child failed health check/);
});

test('Payment Core remains standalone-capable for rollback while exposing embedded lifecycle',()=>{
  assert.match(paymentServer,/export async function startEmbeddedPaymentCore/);
  assert.match(paymentServer,/export async function stopEmbeddedPaymentCore/);
  assert.match(paymentServer,/directExecution/);
  assert.match(paymentServer,/Business & Life payment core gateway listening on/);
  assert.match(paymentServer,/startEmbeddedLegal/);
  assert.doesNotMatch(paymentServer,/\|\|4507/);
});

test('embedded forwarding preserves original JSON bytes through the remaining Legal proxy boundary',()=>{
  assert.match(publicServer,/verify:\(req,_res,buf\)=>\{req\.rawBody=Buffer\.from\(buf\)\}/);
  assert.match(legalServer,/Buffer\.isBuffer\(req\.rawBody\)/);
  assert.match(legalServer,/const payload=rawPayload\|\|/);
  assert.match(legalServer,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('public health reflects embedded Payment Core readiness without a child process handle',()=>{
  assert.match(publicServer,/let paymentCoreReady=false/);
  assert.match(publicServer,/const childAlive=paymentCoreReady/);
  assert.match(publicServer,/paymentCoreReady=true/);
  assert.doesNotMatch(publicServer,/let child;/);
});
