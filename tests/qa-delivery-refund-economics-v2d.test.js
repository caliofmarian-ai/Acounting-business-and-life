import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const runner=readFileSync(new URL('../qa-delivery-refund-economics-v2d.js',import.meta.url),'utf8');

test('Delivery Refund Economics V2D runtime wave is registered',()=>{
  assert.match(qa,/DELIVERY_REFUND_ECONOMICS_V2D_RUNTIME_WAVE='delivery_refund_economics_v2d_runtime'/);
  assert.match(qa,/runDeliveryRefundEconomicsV2DAcceptance/);
  assert.match(qa,/config\.wave===DELIVERY_REFUND_ECONOMICS_V2D_RUNTIME_WAVE/);
});

test('refund economics runtime acceptance is transactionally isolated and provider-free',()=>{
  assert.match(runner,/await client\.query\('BEGIN'\)/);
  assert.match(runner,/await client\.query\('ROLLBACK'\)/);
  assert.match(runner,/reconcileDeliveryRefundEconomics/);
  assert.match(runner,/courierMoneyHomeSnapshot/);
  assert.match(runner,/external_provider_calls:0/);
  assert.match(runner,/real_provider_refund_invoked:false/);
  assert.doesNotMatch(runner,/executePayMongoRefund/);
});

test('runtime acceptance covers full partial cumulative and settlement-linked refund economics',()=>{
  assert.match(runner,/full_refund_reversed:true/);
  assert.match(runner,/partial_refund_manual_review:true/);
  assert.match(runner,/cumulative_full_refund_reversed:true/);
  assert.match(runner,/paid_or_settlement_linked_manual_review:true/);
  assert.match(runner,/courier_review_gross_compensation:0/);
  assert.match(runner,/courier_review_payout_eligible:0/);
  assert.match(runner,/idempotent_replay:true/);
  assert.match(runner,/fixture_transaction:'rolled_back'/);
});
