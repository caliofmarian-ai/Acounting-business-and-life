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

test('owner activation brief does not silently approve runtime activation', () => {
  assert.match(brief, /status: DRAFT_FOR_OWNER_DECISION/);
  assert.match(brief, /runtime_activation: NONE/);
  assert.match(brief, /NOT APPROVED/);
  assert.match(brief, /No broad "turn everything on" action is permitted/);
});

test('owner decision brief preserves canonical HOLD values', () => {
  assert.equal(privacy.retention.convertedAttributionRetentionRule, null);
  assert.equal(privacy.convertedAttribution.attributionModel, null);
  assert.equal(rewards.defaultPolicy.enabled, false);
  assert.equal(rewards.defaultPolicy.qualificationRule, null);
  assert.equal(rewards.defaultPolicy.referrerReward, null);
  assert.equal(rewards.defaultPolicy.referredUserReward, null);
});

test('pilot recommendation is explicit but remains a recommendation', () => {
  assert.match(brief, /Use `registration_context_v1` for the first pilot/);
  assert.match(brief, /Keep rewards OFF for the initial pilot/);
  assert.match(brief, /12 months as the candidate pending privacy\/controller approval/);
  assert.match(brief, /This recommendation becomes policy only after explicit Owner approval/);
});

test('legal and PostHog gates remain separate from Owner product choice', () => {
  assert.match(brief, /does not by itself establish the legal basis/);
  assert.match(brief, /final controller\/privacy approval/);
  assert.match(brief, /PostHog: OFF until the correct Business & Life project is connected and verified/);
});
