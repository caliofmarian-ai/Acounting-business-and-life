import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../growth/reward-policy.json', import.meta.url), 'utf8'));

test('referral reward policy is disabled until owner economics are explicitly selected', () => {
  assert.equal(policy.defaultPolicy.enabled, false);
  assert.equal(policy.status, 'disabled_pending_owner_policy');
  assert.equal(policy.defaultPolicy.referrerReward, null);
  assert.equal(policy.defaultPolicy.referredUserReward, null);
});

test('signup does not imply reward and profile switching cannot multiply identities', () => {
  assert.ok(policy.invariants.includes('qualified is distinct from signed_up'));
  assert.ok(policy.invariants.includes('profile switching cannot create additional referral identities'));
});

test('cash reward requires explicit owner approval', () => {
  assert.ok(policy.candidateRewardKinds.includes('cash_or_currency_value_only_after_explicit_owner_approval'));
});
