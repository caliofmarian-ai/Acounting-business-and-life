import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const draft = readFileSync(new URL('../docs/growth/REFERRAL_PRIVACY_NOTICE_DRAFT.md', import.meta.url), 'utf8');
const guardrails = JSON.parse(readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8'));

test('referral privacy supplement is explicitly non-publishable and legally gated', () => {
  assert.match(draft, /status: DRAFT/);
  assert.match(draft, /publication_status: NOT_FOR_PUBLICATION/);
  assert.match(draft, /LEGAL DECISION REQUIRED/);
  assert.match(draft, /referralAnalyticsLawfulBasis = TO_BE_CONFIRMED/);
});

test('privacy draft reflects the canonical 90-day unconverted retention and unresolved later classes', () => {
  assert.equal(guardrails.retention.unconvertedReferralEventDays, 90);
  assert.equal(guardrails.retention.convertedAttributionRetentionRule, null);
  assert.equal(guardrails.retention.rewardEvidenceRetentionRule, null);
  assert.equal(guardrails.retention.productionReady, false);
  assert.match(draft, /\*\*90 days\*\*/);
  assert.match(draft, /Converted attribution[\s\S]*TO BE CONFIRMED — HOLD/);
  assert.match(draft, /Reward\/payment\/accounting evidence[\s\S]*TO BE CONFIRMED — HOLD/);
});

test('privacy draft preserves the analytics PII denylist and address-book boundary', () => {
  for (const term of ['raw email address','raw phone number','recipient name','contact\/address-book contents','authentication token','reset token','referral secret']) {
    assert.match(draft, new RegExp(term, 'i'));
  }
  assert.match(draft, /without Business & Life silently uploading the user's address book/i);
});

test('privacy draft does not falsely claim external PostHog is enabled', () => {
  assert.match(draft, /external PostHog delivery is fail-closed and currently not approved for activation/i);
  assert.match(draft, /Do not use a PostHog project belonging to another organization or product/i);
  assert.match(draft, /external referral analytics remains \*\*HOLD\*\*/);
});
