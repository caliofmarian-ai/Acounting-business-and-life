import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionChannelLinks, copyPromotionLink } from '../public/referral/promotion-page.js';
import { promotionText } from '../public/referral/promotion-copy.js';
import { fixture, Element, read, referral, tick } from './promotion-page-fixture.js';

test('center shows only enabled roles, uses account language and renders a verified link/QR', async t => {
  const f = fixture({ locale: 'fil-PH' }); t.after(() => f.ui.destroy()); await tick();
  assert.deepEqual(f.el('role').children.map(node => node.value), ['customer', 'merchant']);
  assert.equal(f.el('role').value, 'merchant');
  assert.equal(f.document.documentElement.lang, 'fil-PH');
  assert.equal(f.el('copy').textContent, 'Kopyahin ang link');
  assert.equal(f.el('referralUrl').value, referral('merchant').referralUrl);
  assert.equal(f.el('qrImage').hidden, false);
  assert.equal(f.el('copy').disabled, false);
  assert.equal(f.el('progressLink').textContent, 'Handa na');
  assert.equal(f.requests.every(request => !request.init.method || request.init.method === 'GET'), true);
});

test('center carries saved design, message and locale choices into Marketing Kit', async t => {
  const f = fixture({ query: '?profile=merchant&template=STORY_REFERRAL_V1&variant=clarity_v1&format=jpg' }); t.after(() => f.ui.destroy()); await tick();
  f.el('locale').value = 'fil-PH'; await f.el('locale').fire('change');
  const destination = new URL(f.el('marketingKit').href, 'https://caliof.com');
  assert.equal(destination.searchParams.get('template'), 'STORY_REFERRAL_V1');
  assert.equal(destination.searchParams.get('variant'), 'clarity_v1');
  assert.equal(destination.searchParams.get('locale'), 'fil-PH');
  assert.equal(destination.searchParams.get('format'), 'jpg');
  const saved = JSON.parse([...f.values.values()][0]);
  assert.equal(saved.profile, 'merchant');
  assert.equal(saved.locale, 'fil-PH');
  assert.equal('referralUrl' in saved, false);
  assert.equal('name' in saved, false);
});

test('clipboard denial selects the actual referral link and explains manual copying', async t => {
  const f = fixture({ clipboard: { writeText: async () => { throw new Error('Clipboard blocked'); } } }); t.after(() => f.ui.destroy()); await tick();
  await f.el('copy').fire('click');
  assert.equal(f.el('referralUrl').selected, true);
  assert.equal(f.el('referralUrl').value, referral('merchant').referralUrl);
  assert.equal(f.el('status').textContent, promotionText('en-PH', 'manualCopy'));
  assert.doesNotMatch(f.el('status').textContent, /browser address/);
});

test('expiry removes the center identity and QR immediately and reveals usable recovery', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  f.signOut(); await f.document.fire('abl:auth-expired');
  assert.equal(f.el('signin').hidden, false);
  assert.equal(f.el('referralUrl').value, '');
  assert.equal(f.el('qrImage').src, undefined);
  assert.equal(f.el('qrImage').hidden, true);
  assert.equal(f.el('copy').disabled, true);
  assert.equal(f.el('channels').hidden, true);
  assert.doesNotMatch(read('public/referral/promotion.css'), /\.signin\s*\{[^}]*display\s*:\s*none/);
});

test('late native-share completion does not report success for an expired context', async t => {
  let finishShare; const sharing = new Promise(resolve => { finishShare = resolve; });
  const f = fixture({ share: () => sharing }); t.after(() => f.ui.destroy()); await tick();
  const action = f.el('share').fire('click');
  f.signOut(); await f.document.fire('abl:auth-expired');
  finishShare(); await action;
  assert.equal(f.el('status').textContent, promotionText('en-PH', 'signInTitle'));
  assert.equal(f.captured.some(event => event.event === 'referral_shared'), false);
});

test('kit prepares PNG by default and download message does not claim filesystem success', async t => {
  const f = fixture({ page: 'kit' }); t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('format').value, 'png');
  assert.equal(f.ui.getPrepared().mimeType, 'image/png');
  assert.equal(f.el('export').disabled, false);
  assert.equal(f.el('print').disabled, false);
  await f.el('export').fire('click');
  assert.equal(f.downloads.length, 1);
  assert.equal(f.el('status').textContent, promotionText('en-PH', 'downloadStarted'));
  assert.equal(f.el('preview').children[0].tagName, 'IMG');
});

test('kit keeps selected template and message through a language change and its back link', async t => {
  const f = fixture({ page: 'kit', query: '?profile=merchant&template=STORY_REFERRAL_V1&variant=money_visibility_v1' }); t.after(() => f.ui.destroy()); await tick();
  f.el('locale').value = 'fil-PH'; await f.el('locale').fire('change'); await tick();
  assert.equal(f.el('template').value, 'STORY_REFERRAL_V1');
  assert.equal(f.el('variant').value, 'money_visibility_v1');
  assert.equal(f.el('export').textContent, 'I-download ang larawan');
  const back = new URL(f.el('back').href, 'https://caliof.com');
  assert.equal(back.searchParams.get('locale'), 'fil-PH');
  assert.equal(back.searchParams.get('variant'), 'money_visibility_v1');
  assert.equal(back.searchParams.get('template'), 'STORY_REFERRAL_V1');
});

test('rendering failure leaves no old preview or enabled export controls', async t => {
  const f = fixture({ page: 'kit', generateSvg: () => { throw new Error('Layout rejected'); } }); t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('export').disabled, true);
  assert.equal(f.el('share').disabled, true);
  assert.equal(f.el('print').disabled, true);
  assert.equal(f.ui.getPrepared(), null);
  assert.equal(f.el('preview').children[0].textContent, promotionText('en-PH', 'previewError'));
});

test('failed raster export keeps the valid preview and print available, without a false success', async t => {
  const f = fixture({ page: 'kit', createExport: async () => { throw new Error('Canvas unavailable'); } }); t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('export').disabled, true);
  assert.equal(f.el('share').disabled, true);
  assert.equal(f.el('print').disabled, false);
  assert.equal(f.el('preview').children[0].tagName, 'IMG');
  assert.equal(f.el('status').textContent, promotionText('en-PH', 'exportError'));
});

test('old asynchronous export completion cannot enable sharing for a newer selection', async t => {
  const exports = [];
  const f = fixture({ page: 'kit', createExport: options => new Promise(resolve => exports.push({ options, resolve })) }); t.after(() => f.ui.destroy()); await tick();
  assert.equal(exports.length, 1);
  f.el('role').value = 'customer'; await f.el('role').fire('change'); await tick();
  assert.equal(exports.length, 2);
  exports[0].resolve({ blob: new Blob(['old']), filename: 'old.png', mimeType: 'image/png' }); await tick();
  assert.equal(f.ui.getPrepared(), null);
  assert.equal(f.el('export').disabled, true);
  exports[1].resolve({ blob: new Blob(['new']), filename: 'new.png', mimeType: 'image/png' }); await tick();
  assert.equal(f.ui.getPrepared().filename, 'new.png');
  assert.equal(f.ui.getPrepared().loaded.profile, 'customer');
  assert.equal(f.el('export').disabled, false);
});

test('auth expiry clears the kit preview, prepared blob and all export actions', async t => {
  const f = fixture({ page: 'kit' }); t.after(() => f.ui.destroy()); await tick();
  assert.ok(f.ui.getPrepared());
  f.signOut(); await f.document.fire('abl:auth-expired');
  assert.equal(f.ui.getPrepared(), null);
  assert.equal(f.el('preview').children[0].tagName, 'DIV');
  assert.equal(f.el('signin').hidden, false);
  assert.equal(f.el('export').disabled, true);
  assert.equal(f.el('print').disabled, true);
});

test('channel URLs carry the real invitation and safely encode localized messages', () => {
  const url = referral('merchant').referralUrl;
  const links = promotionChannelLinks(url, 'Inimbitahan ka ni Maria & Co.');
  assert.equal(new URL(links.tg).searchParams.get('url'), url);
  assert.ok(decodeURIComponent(links.wa).includes(url));
  assert.ok(links.mail.startsWith('mailto:'));
  assert.ok(links.sms.startsWith('sms:'));
});

test('copy helper does not report completion after its original identity becomes stale', async () => {
  let current = true, finish; const operation = new Promise(resolve => { finish = resolve; });
  const copy = copyPromotionLink({ url: referral('merchant').referralUrl, clipboard: { writeText: () => operation }, input: new Element('input'), isCurrent: () => current });
  current = false; finish();
  assert.equal(await copy, '');
});

test('missing clipboard API still selects the real referral link for manual recovery', async () => {
  const input = new Element('input');
  const url = referral('merchant').referralUrl;
  assert.equal(await copyPromotionLink({ url, clipboard: undefined, input }), 'manualCopy');
  assert.equal(input.selected, true);
  assert.equal(input.value, url);
  assert.deepEqual(input.selection, [0, url.length]);
});

test('failed optional artwork is explained without blocking export and Retry attempts it again', async t => {
  let attempts = 0;
  const brandAsset = { src: '/referral/assets/test.webp', alt: { 'en-PH': 'Business community', 'fil-PH': 'Komunidad ng negosyo' } };
  const f = fixture({ page: 'kit', brandAsset, loadBrandAsset: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Artwork timed out');
    return { dataUrl: 'data:image/png;base64,AAAA', alt: 'Business community' };
  } });
  t.after(() => f.ui.destroy()); await tick();
  assert.equal(attempts, 1);
  assert.equal(f.el('export').disabled, false);
  assert.equal(f.el('feedbackText').textContent, promotionText('en-PH', 'artworkUnavailable'));
  assert.equal(f.el('retry').hidden, false);
  await f.el('retry').fire('click'); await tick();
  assert.equal(attempts, 2);
  assert.equal(f.el('export').disabled, false);
  assert.equal(f.el('feedback').hidden, true);
});

test('backgrounded native-share completion is never attributed to an unverified returning context', async t => {
  let finishShare;
  const f = fixture({ share: () => new Promise(resolve => { finishShare = resolve; }) });
  t.after(() => f.ui.destroy()); await tick();
  const action = f.el('share').fire('click');
  f.document.visibilityState = 'hidden'; await f.document.fire('visibilitychange');
  assert.equal(f.el('referralUrl').value, '');
  assert.equal(f.captured.filter(event => event.event === 'referral_shared').length, 0);
  finishShare(); await action;
  assert.notEqual(f.el('status').textContent, promotionText('en-PH', 'shareDone'));
  assert.equal(f.captured.filter(event => event.event === 'referral_shared').length, 0);
});
