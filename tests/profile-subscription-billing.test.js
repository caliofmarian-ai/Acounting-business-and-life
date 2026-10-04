import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SUBSCRIPTION_SERVICE_SCOPES,SUBSCRIPTION_SUBJECT_TYPES,SUBSCRIPTION_CANONICAL_PLAN_DRAFTS,
  SUBSCRIPTION_LIFECYCLE_RULES,subscriptionLifecycleSimulation,subscriptionPolicyActivationState,
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

test('schema provides versioned immutable plan and invoice foundations without automatic collection',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_subscription_policy_versions/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_subscription_invoices/);
  assert.match(core,/UNIQUE\(policy_code,version\)/);
  assert.match(core,/UNIQUE\(entitlement_id,billing_period_start\)/);
  assert.match(core,/policy_hash TEXT NOT NULL/);
  assert.match(core,/lifecycle_rules JSONB NOT NULL/);
  assert.match(core,/activation_requirements JSONB NOT NULL/);
  assert.match(core,/status<>'active' OR monthly_amount IS NOT NULL/);
  assert.match(core,/invoice_generation:'NOT_PERFORMED'/);
  assert.match(core,/automatic_collection:false/);
  assert.match(core,/production_charge_path:false/);
});

test('canonical Merchant Supplier and Local Services plan drafts are seeded at the Owner-approved target',()=>{
  assert.deepEqual(Object.keys(SUBSCRIPTION_CANONICAL_PLAN_DRAFTS),['marketplace','supplier','local_services']);
  for(const draft of Object.values(SUBSCRIPTION_CANONICAL_PLAN_DRAFTS))assert.equal(draft.monthly_amount,99);
  assert.match(core,/ensureCanonicalSubscriptionPlanDrafts/);
  assert.match(core,/ON CONFLICT\(policy_code,version\) DO NOTHING/);
  assert.match(core,/policy_hash/);
});

test('draft policy creation remains versioned and no activation endpoint is introduced',()=>{
  assert.match(core,/monthly_amount NUMERIC\(14,2\)/);
  assert.match(core,/VALUES\(\$1,\$2,\$3,'draft'/);
  assert.match(server,/\/api\/payments\/admin\/subscriptions\/policies\/drafts/);
  assert.match(server,/fee_policy\.manage_limited/);
  assert.match(server,/subscription_policy_draft_created/);
  assert.doesNotMatch(server,/\/api\/payments\/admin\/subscriptions\/policies\/activate/);
  assert.doesNotMatch(server,/subscription_policy_activated/);
});

test('activation readiness stays fail-closed until policy approval legal terms and live provider evidence exist',()=>{
  const policy={status:'draft',monthly_amount:99};
  const hold=subscriptionPolicyActivationState({policy,evidence:{legal:{ready:false},provider:{ready:false}}});
  assert.equal(hold.state,'HOLD');
  assert.equal(hold.ready,false);
  assert.deepEqual(new Set(hold.blockers),new Set([
    'explicit_policy_approval_required','legal_terms_not_active_reviewed','live_provider_evidence_missing'
  ]));
  const ready=subscriptionPolicyActivationState({
    policy:{status:'approved',monthly_amount:99},
    evidence:{legal:{ready:true},provider:{ready:true}}
  });
  assert.equal(ready.state,'READY');
  assert.equal(ready.ready,true);
});

test('lifecycle rules define renewal failure retry cancellation and grandfathering deterministically',()=>{
  assert.equal(SUBSCRIPTION_LIFECYCLE_RULES.grace_days,7);
  assert.deepEqual(SUBSCRIPTION_LIFECYCLE_RULES.retry_schedule_days,[1,3,7]);
  assert.match(SUBSCRIPTION_LIFECYCLE_RULES.cancellation,/period_end/);
  assert.match(SUBSCRIPTION_LIFECYCLE_RULES.grandfathering,/policy_snapshot/);
  const renewal=subscriptionLifecycleSimulation({scenario:'renewal_success',monthlyAmount:99});
  const failure=subscriptionLifecycleSimulation({scenario:'payment_failure',monthlyAmount:99});
  const cancellation=subscriptionLifecycleSimulation({scenario:'cancellation',monthlyAmount:99});
  const grandfathering=subscriptionLifecycleSimulation({scenario:'grandfathering',monthlyAmount:99});
  for(const x of [renewal,failure,cancellation,grandfathering])assert.equal(x.charge_attempted,false);
  assert.equal(renewal.state,'TEST_RENEWAL_READY');
  assert.deepEqual(failure.retry_schedule_days,[1,3,7]);
  assert.equal(cancellation.state,'CANCEL_AT_PERIOD_END');
  assert.equal(grandfathering.state,'POLICY_SNAPSHOT_PRESERVED');
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

test('Admin Finance UI shows plan evidence blockers lifecycle rules and no-charge simulation',()=>{
  assert.match(ui,/SUBSCRIPTION BILLING/);
  assert.match(ui,/90-day promo → billing readiness/);
  assert.match(ui,/Customer = FREE/);
  assert.match(ui,/Delivery = no monthly subscription/);
  assert.match(ui,/Create a new immutable plan draft/);
  assert.match(ui,/Immutable plan hash/);
  assert.match(ui,/Activation evidence/);
  assert.match(ui,/Lifecycle policy/);
  assert.match(ui,/Test renewal, failure, cancellation and grandfathering/);
  assert.match(ui,/\/api\/payments\/admin\/subscriptions\/simulate/);
  assert.match(ui,/No provider request and no real charge/);
  assert.match(server,/subscriptionLifecycleSimulation/);
  assert.match(server,/simulation_only:true,provider_call:false,real_charge:false/);
  assert.match(css,/\.subscriptionBillingCard/);
  assert.match(css,/\.subscriptionStateGrid/);
});

test('project syntax contract checks subscription core and tests',()=>{
  assert.match(pkg,/node --check profile-subscription-core\.js/);
  assert.match(pkg,/node --check tests\/profile-subscription-billing\.test\.js/);
});
