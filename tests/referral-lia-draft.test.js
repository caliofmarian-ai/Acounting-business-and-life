import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const draft = readFileSync(
  new URL('../docs/growth/REFERRAL_LEGITIMATE_INTEREST_ASSESSMENT_DRAFT.md', import.meta.url),
  'utf8'
);
const privacy = JSON.parse(
  readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8')
);
const rewards = JSON.parse(
  readFileSync(new URL('../growth/reward-policy.json', import.meta.url), 'utf8')
);

test('referral LIA remains draft and does not select a lawful basis', () => {
  assert.match(draft, /status: DRAFT/);
  assert.match(draft, /publication_status: NOT_FOR_PUBLICATION/);
  assert.match(draft, /legal_basis_selected: false/);
  assert.match(draft, /owner_direction: pursue_legitimate_interest_assessment/);
  assert.match(draft, /LIA_OUTCOME = PENDING_CONTROLLER_APPROVAL/);
  assert.match(draft, /LAWFUL_BASIS_SELECTED = false/);
});

test('LIA records Owner product choices but preserves controller and reward HOLD gates', () => {
  assert.equal(privacy.retention.convertedAttributionRetentionRule.period, '12_months_after_conversion');
  assert.equal(privacy.retention.convertedAttributionRetentionRule.activationApproved, false);
  assert.equal(privacy.convertedAttribution.attributionModel, 'registration_context_v1');
  assert.equal(privacy.convertedAttribution.attributionModelOwnerApproved, true);
  assert.equal(privacy.convertedAttribution.attributionModelActivationApproved, false);
  assert.equal(privacy.convertedAttribution.lawfulBasisSelected, false);
  assert.equal(rewards.defaultPolicy.enabled, false);
  assert.equal(rewards.defaultPolicy.qualificationRule, null);
  assert.match(draft, /Converted retention \| OWNER TARGET: 12 months; controller activation PENDING/);
  assert.match(draft, /Converted attribution model \| OWNER APPROVED: registration_context_v1; runtime HOLD/);
  assert.match(draft, /Reward purpose\/economics \| HOLD/);
});

test('LIA cites official Philippines privacy sources and keeps PostHog unverified', () => {
  assert.match(draft, /https:\/\/privacy\.gov\.ph\/data-privacy-act\//);
  assert.match(draft, /NPC-Circular-No\.-2023-07_Guidelines-on-Legitimate-Interest/);
  assert.match(draft, /https:\/\/privacy\.gov\.ph\/implementing-rules-regulations-data-privacy-act-2012\//);
  assert.match(draft, /https:\/\/privacy\.gov\.ph\/right-to-object\//);
  assert.match(draft, /PostHog context is not accepted as verified Business & Life destination evidence/);
});

test('LIA cannot be interpreted as direct-marketing or reward authorization', () => {
  assert.match(draft, /does not authorize:/);
  assert.match(draft, /unsolicited direct marketing/);
  assert.match(draft, /No production flag may be enabled solely because this draft exists/);
});
