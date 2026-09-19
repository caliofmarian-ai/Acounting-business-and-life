import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLiveReferralPayload,
  createOpaqueReferralCode,
  normalizeReferralProfileRole
} from '../growth/referral-account.js';
import { isValidReferralCode, PUBLIC_PROFILE_ROLES } from '../growth/referral-domain.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('live account referral codes are opaque and valid', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const code = createOpaqueReferralCode();
    assert.equal(isValidReferralCode(code), true);
    assert.match(code, /^r1_[A-Za-z0-9_-]{16}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 50);
});

test('live referral payload keeps one code while profile changes only attribution source', () => {
  const code = createOpaqueReferralCode();
  const urls = PUBLIC_PROFILE_ROLES.map(profileRole => buildLiveReferralPayload({
    code,
    origin: 'https://example.test',
    profileRole,
    inviterDisplayName: 'Example User'
  }));
  assert.equal(new Set(urls.map(item => item.code)).size, 1);
  assert.equal(new Set(urls.map(item => new URL(item.referralUrl).searchParams.get('profile'))).size, PUBLIC_PROFILE_ROLES.length);
  for (const item of urls) {
    assert.equal(item.grantsProfiles, false);
    assert.equal(item.grantsPermissions, false);
  }
});

test('unknown referral profile source is rejected', () => {
  assert.throws(() => normalizeReferralProfileRole('admin'), /unknown public profile role/);
});

test('Account/Auth exposes authenticated referral identity without role-grant side effects', () => {
  const source = read('server-auth.js');
  assert.match(source, /app\.get\('\/api\/growth\/referral', auth/);
  assert.match(source, /ensureAccountReferral\(pool, req\.accountId\)/);
  assert.match(source, /SELECT 1 FROM profiles WHERE account_id=\$1 AND role=\$2 AND enabled=TRUE/);
  assert.doesNotMatch(source, /api\/growth\/referral[\s\S]{0,1600}(INSERT INTO profiles|UPDATE profiles)/);
});

test('Promotion Center belongs to the selected profile settings, not the avatar drawer', () => {
  const shell = read('public/shell.js');
  const settings = read('public/profile-settings-ui.js');
  const drawer=shell.slice(shell.indexOf('function renderDrawer'),shell.indexOf('function renderAccountSettings'));
  assert.doesNotMatch(drawer,/Promotion Center/);
  assert.match(settings,/id="profilePromotionCenter"/);
  assert.match(settings,/promotion-center\.html\?profile=/);
});

test('Promotion Center loads the authenticated account identity and never defaults to demo identity', () => {
  const page = read('public/referral/promotion-center.html');
  assert.match(page, /\/api\/growth\/referral\?profile=/);
  assert.match(page, /Authorization:'Bearer '\+auth/);
  assert.match(page, /Sign in required/);
  assert.doesNotMatch(page, /r1_DemoReferral/);
  assert.match(page, /direct referral sending stays disabled/i);
});

test('live referral endpoint adds a local QR tied to the exact campaign URL with a qr-origin marker', () => {
  const server = read('server-auth.js');
  const page = read('public/referral/promotion-center.html');
  assert.match(server, /buildLocalReferralQr\(payload\.referralUrl\)/);
  assert.match(server, /qr \}/);
  assert.match(page, /data\.qr\.referralUrl!==data\.referralUrl/);
  assert.match(page, /data\.qr\.marker!=='qr'/);
  assert.match(page, /#qr/);
  assert.match(page, /Changing the sharing profile regenerates this QR locally/i);
  assert.doesNotMatch(page, /api\.qrserver|quickchart|chart\.google/);
});
