import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../growth/reward-policy.json', import.meta.url), 'utf8'));

test('Owner explicitly keeps referral rewards disabled for the initial pilot', () => {
  assert.equal(policy.defaultPolicy.enabled, false);
  assert.equal(policy.status, 'disabled_for_initial_pilot_owner_approved');
  assert.equal(policy.ownerDecision.initialPilotRewardsEnabled, false);
  assert.equal(policy.ownerDecision.approvedOn, '2026-09-18');
  assert.equal(policy.defaultPolicy.qualificationRule, null);
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
