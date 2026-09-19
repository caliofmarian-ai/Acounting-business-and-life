import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SUBSCRIPTION_SERVICE_SCOPES,SUBSCRIPTION_SUBJECT_TYPES,
  subscriptionReadinessState
} from '../profile-subscription-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('profile-subscription-core.js');
const server=read('server-payments.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const pkg=read('package.json');

test('monthly subscription applies only to Merchant Supplier and Local Services scopes',()=>{
  assert.deepEqual(SUBSCRIPTION_SERVICE_SCOPES,['marketplace','supplier','local_services']);
  assert.deepEqual(SUBSCRIPTION_SUBJECT_TYPES,{
    marketplace:'business',supplier:'account',local_services:'account'
  });
  assert.ok(!SUBSCRIPTION_SERVICE_SCOPES.includes('delivery'));
  assert.ok(!SUBSCRIPTION_SERVICE_SCOPES.includes('customer'));
});

test('subscription readiness is NOT_STARTED until monetization entitlement exists',()=>{
  assert.equal(subscriptionReadinessState({promoEndsAt:null}),'NOT_STARTED');
});

test('90-day entitlement keeps profile PROMOTIONAL before promo end',()=>{
  const state=subscriptionReadinessState({
    promoEndsAt:'2026-12-18T00:00:00Z',
    at:'2026-11-01T00:00:00Z',
    activePolicy:{status:'active',monthly_amount:500}
  });
  assert.equal(state,'PROMOTIONAL');
});

test('post-promo profile remains HOLD without an active priced plan',()=>{
  const at='2027-01-01T00:00:00Z',promoEndsAt='2026-12-18T00:00:00Z';
  assert.equal(subscriptionReadinessState({promoEndsAt,at,activePolicy:null}),'HOLD_NO_ACTIVE_POLICY');
  assert.equal(subscriptionReadinessState({promoEndsAt,at,activePolicy:{status:'draft',monthly_amount:500}}),'HOLD_NO_ACTIVE_POLICY');
  assert.equal(subscriptionReadinessState({promoEndsAt,at,activePolicy:{status:'active',monthly_amount:null}}),'HOLD_NO_ACTIVE_POLICY');
});

test('post-promo profile becomes READY only with active priced policy',()=>{
  const state=subscriptionReadinessState({
    promoEndsAt:'2026-12-18T00:00:00Z',
    at:'2027-01-01T00:00:00Z',
    activePolicy:{status:'active',monthly_amount:500}
  });
  assert.equal(state,'READY_TO_INVOICE');
});

test('existing invoice state takes precedence after promo',()=>{
  const base={promoEndsAt:'2026-12-18T00:00:00Z',at:'2027-01-01T00:00:00Z',activePolicy:{status:'active',monthly_amount:500}};
  assert.equal(subscriptionReadinessState({...base,latestInvoiceStatus:'open'}),'OPEN');
  assert.equal(subscriptionReadinessState({...base,latestInvoiceStatus:'paid'}),'PAID');
  assert.equal(subscriptionReadinessState({...base,latestInvoiceStatus:'past_due'}),'PAST_DUE');
  assert.equal(subscriptionReadinessState({...base,latestInvoiceStatus:'waived'}),'WAIVED');
  assert.equal(subscriptionReadinessState({...base,latestInvoiceStatus:'void'}),'VOID');
});

test('schema provides versioned policy and immutable invoice foundation without auto-generation',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_subscription_policy_versions/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_subscription_invoices/);
  assert.match(core,/UNIQUE\(policy_code,version\)/);
  assert.match(core,/UNIQUE\(entitlement_id,billing_period_start\)/);
  assert.match(core,/status<>'active' OR monthly_amount IS NOT NULL/);
  assert.match(core,/invoice_generation:'NOT_PERFORMED'/);
  assert.match(core,/live_policy_activation:'NOT_AVAILABLE_IN_THIS_SLICE'/);
});

test('draft policy creation allows undecided price and has no activation API in this slice',()=>{
  assert.match(core,/monthly_amount NUMERIC\(14,2\)/);
  assert.match(core,/VALUES\(\$1,\$2,\$3,'draft'/);
  assert.match(server,/\/api\/payments\/admin\/subscriptions\/policies\/drafts/);
  assert.match(server,/fee_policy\.manage_limited/);
  assert.match(server,/subscription_policy_draft_created/);
  assert.doesNotMatch(server,/\/api\/payments\/admin\/subscriptions\/policies\/activate/);
  assert.doesNotMatch(server,/subscription_policy_activated/);
});

test('Admin readiness API is Finance-read scoped',()=>{
  assert.match(server,/\/api\/payments\/admin\/subscriptions\/readiness/);
  const start=server.indexOf("app.get('/api/payments/admin/subscriptions/readiness'");
  const end=server.indexOf("app.post('/api/payments/admin/subscriptions/policies/drafts'",start);
  const block=server.slice(start,end);
  assert.match(block,/finance\.summary\.view/);
  assert.match(block,/subscriptionBillingReadiness/);
  assert.match(block,/listSubscriptionPolicies/);
});

test('Admin Finance UI shows promo HOLD READY and non-billable Customer Delivery boundaries',()=>{
  assert.match(ui,/SUBSCRIPTION BILLING/);
  assert.match(ui,/90-day promo → billing readiness/);
  assert.match(ui,/Customer = FREE/);
  assert.match(ui,/Delivery = no monthly subscription/);
  assert.match(ui,/Create subscription plan draft/);
  assert.match(ui,/value="99"/);
  assert.match(ui,/Owner-approved price is ₱99\/month/);
  assert.match(ui,/Billing is still inactive/);
  assert.match(css,/\.subscriptionBillingCard/);
  assert.match(css,/\.subscriptionStateGrid/);
});

test('project syntax contract checks subscription core and tests',()=>{
  assert.match(pkg,/node --check profile-subscription-core\.js/);
  assert.match(pkg,/node --check tests\/profile-subscription-billing\.test\.js/);
});
