import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read, referral, tick } from './promotion-page-fixture.js';

const copyNode = (f, key) => f.document.querySelectorAll('[data-i18n]').find(node => node.dataset.i18n === key);

test('Promotion Center describes platform invitations and unavailable rewards without earnings promises', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  assert.equal(copyNode(f, 'inviteShare').textContent, 'INVITE & SHARE');
  assert.match(copyNode(f, 'availabilityNote').textContent, /Rewards and automatic invitations are not enabled/);
  assert.match(copyNode(f, 'invitationScope').textContent, /do not create product discounts or automatically approve business profiles/);
  assert.match(copyNode(f, 'promotionIntro').textContent, /Invite people to Business & Life/);
});

test('Promotion Center offers only canonical enabled profiles and explains an unavailable query choice', async t => {
  const f = fixture({ query: '?profile=supplier' }); t.after(() => f.ui.destroy()); await tick();
  assert.deepEqual(f.el('role').children.map(node => node.value), ['customer', 'merchant']);
  assert.equal(f.el('role').value, 'merchant');
  assert.match(f.el('feedbackText').textContent, /not available on this account/);
  assert.equal(f.el('referralUrl').value, referral('merchant').referralUrl);
  assert.equal(f.requests.some(request => request.path.includes('profile=supplier')), false);
});

test('Promotion Center uses the cookie-session bootstrap and real API identity without activation side effects', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  const html = read('public/referral/promotion-center.html');
  assert.match(html, /<script src="\/session-security\.js"><\/script>/);
  assert.match(html, /type="module" src="\/referral\/promotion-page\.js"/);
  assert.equal(f.el('referralCode').textContent, referral('merchant').code);
  assert.ok(f.requests.some(request => request.path === '/api/me'));
  assert.ok(f.requests.some(request => request.path === '/api/growth/referral?profile=merchant'));
  assert.equal(f.requests.every(request => !request.init.method || request.init.method === 'GET'), true);
});

test('Promotion Center shares its actual invitation and passes language/profile into the Marketing Kit', async t => {
  const f = fixture({ locale: 'fil-PH' }); t.after(() => f.ui.destroy()); await tick();
  const invitation = referral('merchant').referralUrl;
  assert.equal(new URL(f.el('tg').href).searchParams.get('url'), invitation);
  assert.ok(decodeURIComponent(f.el('wa').href).includes(invitation));
  assert.ok(f.el('sms').href.startsWith('sms:'));
  assert.ok(f.el('mail').href.startsWith('mailto:'));
  const kit = new URL(f.el('marketingKit').href, 'https://caliof.com');
  assert.equal(kit.pathname, '/referral/marketing-kit.html');
  assert.equal(kit.searchParams.get('profile'), 'merchant');
  assert.equal(kit.searchParams.get('locale'), 'fil-PH');
});

test('Promotion Center readiness represents loaded link and decoded QR without invented conversion totals', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('progressLink').textContent, 'Ready');
  assert.equal(f.el('progressQr').textContent, 'Ready');
  assert.equal(f.el('qrImage').src, referral('merchant').qr.dataUrl);
  assert.match(copyNode(f, 'availabilityNote').textContent, /Referral totals are not available here/);
  assert.equal(f.el('progressConversions'), undefined);
  f.signOut(); await f.document.fire('abl:auth-expired');
  assert.equal(f.el('progressLink').textContent, 'Unavailable');
  assert.equal(f.el('progressQr').textContent, 'Unavailable');
  assert.equal(f.el('qrImage').src, undefined);
  assert.equal(f.el('signin').hidden, false);
});
