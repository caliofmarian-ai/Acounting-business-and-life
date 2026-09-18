import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = JSON.parse(readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8'));

test('all initial referral channels are user initiated', () => {
  for (const channel of Object.values(rules.channelRules)) {
    assert.equal(channel.userInitiated, true);
  }
  assert.equal(rules.channelRules.group_share.autoPosting, false);
});

test('public referral privacy prohibits raw contact data and secrets', () => {
  assert.match(rules.classification.rawEmail, /prohibited/);
  assert.match(rules.classification.rawPhone, /prohibited/);
  assert.equal(rules.classification.addressBook, 'bulk_collection_prohibited');
  assert.ok(rules.analytics.prohibitedProperties.includes('email'));
  assert.ok(rules.analytics.prohibitedProperties.includes('phone'));
  assert.ok(rules.analytics.prohibitedProperties.includes('referral_secret'));
});

test('marketing consent does not collapse legal, operational or location categories', () => {
  assert.equal(rules.consentBoundary.operationalNotifications, 'separate_from_marketing');
  assert.equal(rules.consentBoundary.legalAcceptance, 'separate_from_marketing');
  assert.equal(rules.consentBoundary.locationConsent, 'separate_from_marketing');
});

test('Owner-approved referral retention targets remain fail-closed until controller activation', () => {
  assert.equal(rules.retention.productionReady, false);
  assert.equal(rules.retention.unconvertedReferralEventDays, 90);
  assert.equal(rules.retention.convertedAttributionRetentionRule.ownerProductPolicyApproved, true);
  assert.equal(rules.retention.convertedAttributionRetentionRule.period, '12_months_after_conversion');
  assert.equal(rules.retention.convertedAttributionRetentionRule.activationApproved, false);
  assert.equal(rules.retention.convertedAttributionRetentionRule.privacyControllerApprovalRequired, true);
  assert.equal(rules.retention.rewardEvidenceRetentionRule, null);
  assert.match(rules.retention.gateReason, /12-month converted-attribution product-policy target/i);
  assert.match(rules.retention.gateReason, /privacy\/controller/i);
});

test('referral attribution cannot grant authority', () => {
  for (const allowed of Object.values(rules.authorization)) assert.equal(allowed, false);
});
