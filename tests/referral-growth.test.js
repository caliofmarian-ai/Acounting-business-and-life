import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  PUBLIC_PROFILE_ROLES,
  buildReferralUrl,
  generateReferralCode,
  isValidReferralCode,
  referralAttributionEnvelope,
  transitionReferral
} from '../growth/referral-domain.js';

const SECRET = 'test-referral-secret-change-me';

test('referral codes are stable, opaque and contain no account id', () => {
  const first = generateReferralCode({ accountId: 12345, secret: SECRET });
  const second = generateReferralCode({ accountId: 12345, secret: SECRET });
  assert.equal(first, second);
  assert.equal(isValidReferralCode(first), true);
  assert.equal(first.includes('12345'), false);
});

test('same account receives one account-level referral identity regardless of profile source', () => {
  const code = generateReferralCode({ accountId: 9, secret: SECRET });
  const urls = PUBLIC_PROFILE_ROLES.map(profileRole => buildReferralUrl({
    origin: 'https://example.test',
    code,
    profileRole
  }));
  assert.equal(new Set(urls.map(value => new URL(value).searchParams.get('ref'))).size, 1);
  assert.equal(new Set(urls.map(value => new URL(value).searchParams.get('profile'))).size, PUBLIC_PROFILE_ROLES.length);
});

test('referral URL contains only opaque referral and bounded campaign metadata', () => {
  const code = generateReferralCode({ accountId: 77, secret: SECRET });
  const url = new URL(buildReferralUrl({
    origin: 'https://example.test',
    code,
    campaign: 'Launch PH / Bacoor',
    source: 'profile',
    medium: 'referral',
    profileRole: 'merchant'
  }));
  assert.equal(url.pathname, '/referral/');
  assert.equal(url.searchParams.get('ref'), code);
  assert.equal(url.searchParams.get('profile'), 'merchant');
  assert.equal(url.searchParams.has('email'), false);
  assert.equal(url.searchParams.has('phone'), false);
  assert.equal(url.searchParams.has('account_id'), false);
});

test('marketing attribution explicitly grants no profiles or permissions', () => {
  const code = generateReferralCode({ accountId: 77, secret: SECRET });
  const envelope = referralAttributionEnvelope({ code, profileRole: 'courier' });
  assert.equal(envelope.grantsProfiles, false);
  assert.equal(envelope.grantsPermissions, false);
});

test('referral state is monotonic and reward requires qualification', () => {
  const clicked = transitionReferral({ state: 'created' }, 'click', { referrerAccountId: 1, referredAccountId: 2 });
  const signed = transitionReferral(clicked, 'signup', { referrerAccountId: 1, referredAccountId: 2 });
  assert.throws(
    () => transitionReferral(signed, 'reward', { referrerAccountId: 1, referredAccountId: 2 }),
    /invalid referral transition/
  );
  const qualified = transitionReferral(signed, 'qualify', { referrerAccountId: 1, referredAccountId: 2 });
  const rewarded = transitionReferral(qualified, 'reward', { referrerAccountId: 1, referredAccountId: 2 });
  assert.equal(rewarded.state, 'rewarded');
});

test('repeated same-state event is idempotent', () => {
  const clicked = transitionReferral({ state: 'created' }, 'click', { referrerAccountId: 1, referredAccountId: 2 });
  const again = transitionReferral(clicked, 'click', { referrerAccountId: 1, referredAccountId: 2 });
  assert.equal(again.state, 'clicked');
  assert.equal(again.idempotent, true);
});

test('self referral is rejected before reward qualification', () => {
  const rejected = transitionReferral({ state: 'created' }, 'signup', { referrerAccountId: 5, referredAccountId: 5 });
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.rejectionReason, 'self_referral');
});

test('static referral page is public-safe and preserves governance boundary', () => {
  const html = readFileSync(new URL('../public/referral/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/referral/referral.js', import.meta.url), 'utf8');
  assert.match(html, /does not automatically approve Merchant, Supplier, Courier or Service Provider access/);
  assert.match(js, /navigator\.share/);
  assert.match(js, /wa\.me/);
  assert.match(js, /t\.me\/share\/url/);
  assert.doesNotMatch(js, /contacts/i);
});

test('new referral JavaScript parses cleanly without changing package scripts', () => {
  for (const file of ['growth/referral-domain.js','public/referral/referral.js','tests/referral-growth.test.js']) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
