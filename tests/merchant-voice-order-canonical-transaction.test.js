import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const guard=readFileSync(new URL('../merchant-voice-order-idempotency.js',import.meta.url),'utf8');
const approval=readFileSync(new URL('../merchant-voice-order-confirm.js',import.meta.url),'utf8');
const create=orders.slice(orders.indexOf('async function createOrder('),orders.indexOf('\nasync function ',orders.indexOf('async function createOrder(')+10));
test('normal Merchant counter creation still owns and completes its existing single transaction',()=>{
  assert.match(create,/client:sharedClient=null/);
  assert.match(create,/const client=sharedClient\|\|await pool\.connect\(\)/);
  assert.match(create,/if\(!sharedClient\)await client\.query\('BEGIN'\)/);
  assert.match(create,/if\(!sharedClient\)\{await client\.query\('COMMIT'\);return orderDetail\(id\)\}/);
  assert.match(create,/if\(!sharedClient\)client\.release\(\)/);
  assert.match(orders,/app\.post\('\/api\/orders\/merchant\/create'/);
});
test('voice approval borrows exactly the same checked-out PostgreSQL client, never nested transaction',()=>{
  assert.match(orders,/installMerchantVoiceOrderConfirmation\(app,/);
  assert.match(orders,/createCanonicalOrder:createOrder,orderDetail,bodyMiddleware:body/);
  assert.match(approval,/withVoiceOrderExactlyOnce/);
  assert.match(approval,/createCanonicalOrder\(\{businessId:bid/);
  assert.match(approval,/merchantCounterSnapshots|canonicalSnapshots\(client/);
  assert.match(guard,/await client\.query\('BEGIN'\)/);
  assert.match(guard,/await client\.query\('COMMIT'\)/);
  assert.match(guard,/await client\.query\('ROLLBACK'\)/);
  assert.match(create,/if\(!sharedClient\)\{try\{await client\.query\('ROLLBACK'\)/);
});
test('explicit operator confirmation is feature-gated and never infers paid or customer presence',()=>{
  assert.match(approval,/ORDER_VOICE_CREATE_ENABLED==='1'/);
  assert.match(approval,/operator_confirmed!==true/);
  assert.match(approval,/counterPresence:false/);
  assert.match(approval,/paymentMethod:'cash'/);
  assert.match(approval,/expectedCurrencyCode:'PHP'/);
  assert.match(orders,/ensureVoiceOrderSubmissionSchema\(pool\)/);
  assert.match(orders,/TOKEN_SECRET/);
});