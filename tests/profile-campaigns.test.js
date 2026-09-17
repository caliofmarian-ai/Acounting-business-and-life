import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const campaigns = JSON.parse(readFileSync(new URL('../growth/campaigns.en-PH.json', import.meta.url), 'utf8'));
const expected = ['customer','merchant','supplier','courier','service_provider'];

test('campaign contract covers every public profile exactly once', () => {
  assert.deepEqual(Object.keys(campaigns.profiles).sort(), expected.sort());
});

test('every profile has a stable campaign, share copy and operational approval caveat', () => {
  for (const [role, profile] of Object.entries(campaigns.profiles)) {
    assert.ok(profile.campaignId.startsWith('referral_'));
    assert.equal(profile.sourceProfileRole, role);
    assert.ok(profile.shortShare.includes('{REFERRAL_URL}'));
    assert.ok(profile.email.body.includes('{REFERRAL_URL}'));
    const combined = [profile.shortShare, profile.groupShare, profile.email.body].join(' ');
    if (role !== 'customer') assert.match(combined, /approval|invite-only|approved|require/i);
  }
});

test('campaigns use only account-level referral placeholders and no recipient PII', () => {
  const serialized = JSON.stringify(campaigns);
  assert.doesNotMatch(serialized, /RECIPIENT_EMAIL|RECIPIENT_PHONE|CONTACT_LIST/);
  assert.ok(campaigns.common.requiredPlaceholders.includes('REFERRAL_URL'));
  assert.equal(campaigns.common.userInitiatedSharingOnly, true);
  assert.equal(campaigns.common.autoGroupPosting, false);
});

test('experiments cannot alter reward economics or authority silently', () => {
  assert.match(campaigns.experiments.rule, /not actual reward economics/i);
  assert.match(campaigns.experiments.rule, /profile-approval authority/i);
});
