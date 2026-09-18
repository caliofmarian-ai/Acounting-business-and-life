import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brief = readFileSync(
  new URL('../docs/growth/OWNER_ACTIVATION_DECISION_BRIEF.md', import.meta.url),
  'utf8'
);
const privacy = JSON.parse(
  readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8')
);
const rewards = JSON.parse(
  readFileSync(new URL('../growth/reward-policy.json', import.meta.url), 'utf8')
);

test('recorded Owner decision still does not approve runtime activation', () => {
  assert.match(brief, /status: OWNER_DECISION_RECORDED/);
  assert.match(brief, /runtime_activation: NONE/);
  assert.match(brief, /No broad "turn everything on" action is permitted/);
  assert.match(brief, /OWNER_PILOT_POLICY_DECISION\.md/);
});

test('owner decision brief records product choices while runtime and rewards remain HOLD', () => {
  assert.equal(privacy.retention.convertedAttributionRetentionRule.period, '12_months_after_conversion');
  assert.equal(privacy.retention.convertedAttributionRetentionRule.activationApproved, false);
  assert.equal(privacy.convertedAttribution.attributionModel, 'registration_context_v1');
  assert.equal(privacy.convertedAttribution.attributionModelActivationApproved, false);
  assert.equal(privacy.convertedAttribution.lawfulBasisSelected, false);
  assert.equal(rewards.status, 'disabled_for_initial_pilot_owner_approved');
  assert.equal(rewards.defaultPolicy.enabled, false);
  assert.equal(rewards.defaultPolicy.qualificationRule, null);
  assert.equal(rewards.defaultPolicy.referrerReward, null);
  assert.equal(rewards.defaultPolicy.referredUserReward, null);
});

test('pilot product policy is explicitly Owner approved', () => {
  assert.match(brief, /Owner decision for pilot — APPROVED PRODUCT POLICY/);
  assert.match(brief, /Rewards are OFF for the initial pilot by Owner decision/);
  assert.match(brief, /12 months after conversion/);
  assert.match(brief, /Project Owner approved this model on 2026-09-18/);
});

test('legal and PostHog gates remain separate from Owner product choice', () => {
  assert.match(brief, /does not by itself establish the legal basis/);
  assert.match(brief, /final controller\/privacy approval/);
  assert.match(brief, /PostHog: OFF until the correct Business & Life project is connected and verified/);
});
