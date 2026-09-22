import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Delivery Runtime V9 has a focused fresh-order acceptance wave',()=>{
  assert.match(qa,/const DELIVERY_RUNTIME_V9_WAVE='delivery_runtime_v9'/);
  assert.match(qa,/runDeliveryRuntimeV9Acceptance/);
  assert.match(qa,/config\.wave===DELIVERY_RUNTIME_V9_WAVE/);
  assert.match(qa,/wave:DELIVERY_RUNTIME_V9_WAVE/);
  assert.match(qa,/Controlled QA Delivery Runtime V9/);
  assert.match(qa,/paymentMode:'merchant_confirmation'/);
});

test('Delivery Runtime V9 verifies quote lifecycle completion security and monetization',()=>{
  for(const marker of [
    'FROM deliveries d',
    'FROM delivery_quotes q',
    'service_monetization_events',
    "service_scope='marketplace'",
    "service_scope='delivery'",
    'completion_code_security:true',
    'tracking_closed_after_completion:true',
    'marketplace_monetization_event:true',
    'delivery_monetization_event:true',
    'QA credential restore failed'
  ])assert.ok(qa.includes(marker),`missing Delivery V9 acceptance marker: ${marker}`);
  assert.match(qa,/q\.status!==\'used\'/);
  assert.match(qa,/d\.status!==\'delivered\'/);
  assert.match(qa,/d\.order_status!==\'completed\'/);
  assert.match(qa,/d\.payment_status!==\'paid\'/);
});
