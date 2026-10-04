import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-subscription-billing-770-smoke.js',import.meta.url),'utf8');

test('Production subscription billing smoke is read-only and production-gated',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/read_only:true/);
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCOMMIT\b|\bROLLBACK\b/i);
});

test('Production subscription billing smoke verifies plans gates and no-charge lifecycle scenarios',()=>{
  for(const marker of [
    'profile_subscription_policy_versions',
    'profile_subscription_invoices',
    'policy_hash',
    'activation_requirements',
    'profile_acceptance_before_charge',
    'subscriptionActivationEvidence',
    'subscriptionPolicyActivationState',
    'renewal_success',
    'payment_failure',
    'cancellation',
    'grandfathering',
    'PRODUCTION_SUBSCRIPTION_BILLING_770_SMOKE_RESULT'
  ])assert.ok(script.includes(marker),'missing #770 smoke marker: '+marker);
});
