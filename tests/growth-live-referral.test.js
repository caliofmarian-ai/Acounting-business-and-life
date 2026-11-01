import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLiveReferralPayload,
  createOpaqueReferralCode,
  normalizeReferralProfileRole
} from '../growth/referral-account.js';
import { isValidReferralCode, PUBLIC_PROFILE_ROLES } from '../growth/referral-domain.js';
import { fixture, tick, referral } from './promotion-page-fixture.js';

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

test('Promotion Center loads the authenticated account identity and never defaults to demo identity', async t => {
  const page = read('public/referral/promotion-center.html');
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  assert.ok(f.requests.some(request => request.path === '/api/growth/referral?profile=merchant'));
  assert.equal(f.el('referralCode').textContent, referral('merchant').code);
  assert.match(page, /<script src="\/session-security\.js"><\/script>/);
  assert.doesNotMatch(page, /Authorization:'Bearer '|localStorage\.getItem\('abl_token'\)/);
  assert.doesNotMatch(page, /r1_DemoReferral/);
  f.signOut(); await f.document.fire('abl:auth-expired');
  assert.equal(f.el('signin').hidden, false);
  assert.equal(f.el('referralUrl').value, '');
});

test('live referral endpoint adds a local QR tied to the exact campaign URL with a qr-origin marker', async t => {
  const server = read('server-auth.js');
  assert.match(server, /buildLocalReferralQr\(payload\.referralUrl\)/);
  assert.match(server, /qr \}/);
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('qrImage').src, referral('merchant').qr.dataUrl);
  assert.equal(f.el('qrImage').hidden, false);
  f.el('role').value = 'customer'; await f.el('role').fire('change');
  assert.equal(f.el('qrImage').src, undefined, 'old QR clears before the new request resolves');
  await tick();
  assert.equal(f.ui.controller.getCurrent().identity.qr.referralUrl, referral('customer').referralUrl);
  assert.equal(f.ui.controller.getCurrent().identity.qr.marker, 'qr');
  assert.equal(f.requests.every(request => request.path.startsWith('/api/')), true);
});
