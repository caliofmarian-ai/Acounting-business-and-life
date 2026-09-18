import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const decision = readFileSync(
  new URL('../docs/growth/OWNER_PILOT_POLICY_DECISION.md', import.meta.url),
  'utf8'
);
const privacy = JSON.parse(
  readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8')
);
const rewards = JSON.parse(
  readFileSync(new URL('../growth/reward-policy.json', import.meta.url), 'utf8')
);

test('Owner pilot decision records selected product policy', () => {
  assert.match(decision, /status: OWNER_APPROVED_PRODUCT_POLICY/);
  assert.match(decision, /registration_context_v1/);
  assert.match(decision, /12 months after conversion/);
  assert.match(decision, /legitimate-interest assessment path/);
  assert.match(decision, /rewards OFF for the initial pilot/i);
  assert.match(decision, /PostHog.*remain OFF/is);
});

test('Owner product policy does not equal privacy/controller activation', () => {
  assert.match(decision, /runtime_activation: NONE/);
  assert.match(decision, /privacy_controller_approval: PENDING/);
  assert.match(decision, /PRIVACY_CONTROLLER_ACTIVATION_APPROVED = false/);
  assert.match(decision, /POSTHOG_ACTIVATION_APPROVED = false/);
  assert.match(decision, /REWARD_ACTIVATION_APPROVED = false/);
  assert.equal(privacy.retention.productionReady, false);
  assert.equal(privacy.convertedAttribution.lawfulBasisSelected, false);
});

test('canonical machine-readable policy matches Owner decision', () => {
  assert.equal(privacy.convertedAttribution.attributionModel, 'registration_context_v1');
  assert.equal(privacy.convertedAttribution.attributionModelOwnerApproved, true);
  assert.equal(privacy.convertedAttribution.attributionModelActivationApproved, false);
  assert.equal(privacy.convertedAttribution.retentionMonthsTarget, 12);
  assert.equal(privacy.convertedAttribution.retentionActivationApproved, false);
  assert.equal(privacy.retention.convertedAttributionRetentionRule.period, '12_months_after_conversion');
  assert.equal(privacy.retention.convertedAttributionRetentionRule.activationApproved, false);
});

test('rewards stay disabled with no invented economics', () => {
  assert.equal(rewards.status, 'disabled_for_initial_pilot_owner_approved');
  assert.equal(rewards.defaultPolicy.enabled, false);
  assert.equal(rewards.defaultPolicy.qualificationRule, null);
  assert.equal(rewards.defaultPolicy.referrerReward, null);
  assert.equal(rewards.defaultPolicy.referredUserReward, null);
  assert.equal(rewards.defaultPolicy.rewardCurrency, null);
  assert.equal(rewards.defaultPolicy.rewardKind, null);
});
