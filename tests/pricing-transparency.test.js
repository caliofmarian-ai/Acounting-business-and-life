import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT,
  OWNER_APPROVED_MONTHLY_SUBSCRIPTION_PHP,
  OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,
  OWNER_APPROVED_DELIVERY_PROMO_DAYS,
  monetizationPolicyDraft
} from '../monetization-policy-v2.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Owner-approved public pricing is ₱99 per month plus 0.50 percent after promo',()=>{
  assert.equal(OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT,0.5);
  assert.equal(OWNER_APPROVED_MONTHLY_SUBSCRIPTION_PHP,99);
  for(const role of ['merchant','supplier','local_services']){
    assert.equal(monetizationPolicyDraft(role).monthly_subscription_amount,99);
    assert.equal(monetizationPolicyDraft(role).transaction_rate_pct,0.5);
    assert.equal(monetizationPolicyDraft(role).promotional_days,90);
  }
});

test('Customer and Delivery pricing boundaries remain separate',()=>{
  assert.equal(monetizationPolicyDraft('customer').transaction_rate_pct,0);
  assert.equal(OWNER_APPROVED_DELIVERY_PROMO_DAYS,30);
  assert.equal(OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,10);
});

test('public pricing endpoint exposes Business & Life and PayMongo separately',()=>{
  const server=read('server-payments.js');
  assert.match(server,/app\.get\('\/api\/public\/pricing'/);
  assert.match(server,/OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT/);
  assert.match(server,/OWNER_APPROVED_MONTHLY_SUBSCRIPTION_PHP/);
  assert.match(server,/PAYMONGO_PH_PAYMENT_BENCHMARKS/);
  assert.match(server,/promotion_disclosure/);
  assert.doesNotMatch(server,/90 days completely free/i);
});

test('Guest includes Pricing & benefits and reads canonical public pricing',()=>{
  const guest=read('public/guest-explore.js');
  assert.match(guest,/Pricing & benefits/);
  assert.match(guest,/\/api\/public\/pricing/);
  assert.match(guest,/PayMongo benchmark rates/);
  assert.match(guest,/Monthly subscription after promo/);
  assert.match(guest,/Business & Life does not relabel PayMongo fees as its own fee/);
});

test('shared disclosure renderer is present on economic decision surfaces',()=>{
  const renderer=read('public/pricing-transparency.js');
  for(const marker of ['merchant','courier','customer_checkout','public'])assert.match(renderer,new RegExp(marker));
  assert.match(read('public/marketplace-ui.js'),/data-bl-pricing="merchant"/);
  assert.match(read('public/marketplace-ui.js'),/data-bl-pricing="customer_checkout"/);
  assert.match(read('public/suppliers-ui.js'),/data-bl-pricing="supplier"/);
  assert.match(read('public/services-ui.js'),/data-bl-pricing="local_services"/);
  assert.match(read('public/profile-settings-ui.js'),/data-bl-pricing/);
  assert.match(read('public/payments-ui.js'),/data-bl-pricing="customer_checkout"/);
});

test('fee communication never collapses Business & Life and processor charges',()=>{
  const renderer=read('public/pricing-transparency.js');
  assert.match(renderer,/Payment-processor charges are separate/i);
  assert.match(renderer,/Digital payment processing is a separate PayMongo\/provider cost/i);
  assert.match(renderer,/Monthly subscription:/);
  assert.doesNotMatch(renderer,/completely free/i);
});
