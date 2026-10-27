import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionChannelLinks, copyPromotionLink } from '../public/referral/promotion-page.js';
import { promotionText } from '../public/referral/promotion-copy.js';
import { fixture, Element, read, referral, tick, artworkData } from './promotion-page-fixture.js';
import { PROMOTION_BRAND_ASSETS, getPromotionBrandAsset } from '../public/referral/promotion-brand.js';
import { generateMarketingKitSvg } from '../public/referral/marketing-kit-runtime.js';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

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

test('failed selected artwork blocks export and its Retry attempts the same image again', async t => {
  let attempts = 0;
  const f = fixture({ page: 'kit', query: '?artwork=community', loadBrandAsset: async asset => {
    attempts += 1;
    if (attempts === 1) throw new Error('Artwork timed out');
    return { dataUrl: artworkData(asset.id) };
  } });
  t.after(() => f.ui.destroy()); await tick();
  assert.equal(attempts, 1);
  assert.equal(f.el('export').disabled, true);
  assert.equal(f.el('share').disabled, true);
  assert.equal(f.el('print').disabled, true);
  assert.equal(f.el('preview').children[0].tagName, 'DIV');
  assert.equal(f.el('artworkStatus').textContent, promotionText('en-PH', 'artworkUnavailable'));
  assert.equal(f.el('artworkRetry').hidden, false);
  await f.el('artworkRetry').fire('click'); await tick();
  assert.equal(attempts, 2);
  assert.equal(f.el('export').disabled, false);
  assert.equal(f.el('artworkRetry').hidden, true);
  assert.equal(f.ui.getPrepared().artwork, 'community');
  assert.deepEqual(f.artworkLoads.map(item => item.asset.id), ['community', 'community']);
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

test('both pages present all three approved thumbnails as native labeled radio choices', async t => {
  for (const page of ['center', 'kit']) {
    const f = fixture({ page }); t.after(() => f.ui.destroy()); await tick();
    assert.equal(f.el('artworkOptions').children.length, 3);
    for (const asset of PROMOTION_BRAND_ASSETS) {
      const input = f.el('artwork-' + asset.id);
      assert.equal(input.type, 'radio');
      assert.equal(input.name, 'artwork');
      assert.equal(input.value, asset.id);
      assert.equal(input.getAttribute('aria-labelledby'), 'artworkName-' + asset.id);
      assert.equal(f.el('artworkName-' + asset.id).textContent, asset.name['en-PH']);
      const card = f.el('artworkOptions').children.find(node => node.children[0] === input);
      assert.equal(card.getAttribute('for'), input.id);
      assert.equal(card.children[1].src, asset.thumbnail);
      assert.equal(card.children[1].alt, asset.alt['en-PH']);
      assert.equal(card.children[3].hidden, asset.id !== 'local-business');
    }
    assert.equal(f.el('artwork-local-business').checked, true);
    assert.equal(f.el('artworkStatus').textContent, promotionText('en-PH', 'artworkReady'));
  }
});

test('radio selection and language changes preserve the focused native control', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  const focused = f.el('artwork-community'); focused.focus();
  await f.selectArtwork('community'); await tick();
  f.el('locale').value = 'fil-PH'; await f.el('locale').fire('change'); await tick();
  assert.equal(f.el('artwork-community'), focused);
  assert.equal(focused.focused, true);
  assert.equal(focused.checked, true);
  assert.equal(f.el('artwork-local-business').checked, false);
  assert.equal(f.el('artworkName-community').textContent, 'Komunidad');
  assert.equal(f.el('brandArtwork').alt, getPromotionBrandAsset('community').alt['fil-PH']);
  assert.equal(f.artworkLoads.filter(item => item.asset.id === 'community').length, 1, 'cached pixels must not cache the old locale description');
});

test('each center artwork updates the hero and keeps only its approved ID in links and preferences', async t => {
  const f = fixture(); t.after(() => f.ui.destroy()); await tick();
  for (const asset of PROMOTION_BRAND_ASSETS) {
    await f.selectArtwork(asset.id); await tick();
    assert.equal(f.el('brandArtwork').src, artworkData(asset.id));
    assert.equal(f.el('brandArtwork').getAttribute('data-artwork'), asset.id);
    assert.equal(f.el('brandArtwork').hidden, false);
    assert.equal(new URL(f.el('marketingKit').href, 'https://caliof.com').searchParams.get('artwork'), asset.id);
    assert.equal(f.runtime.location.searchParams.get('artwork'), asset.id);
    assert.equal(JSON.parse(f.values.get('abl_referral_presentation_v1:21')).artwork, asset.id);
    assert.doesNotMatch(f.values.get('abl_referral_presentation_v1:21'), /data:image|assets\/|https:/);
  }
});

test('each Marketing Kit choice renders the matching artwork and a newly guarded export', async t => {
  const rendered = [];
  const f = fixture({ page: 'kit', generateSvg: options => { rendered.push(options); return generateMarketingKitSvg(options); } });
  t.after(() => f.ui.destroy()); await tick();
  for (const asset of PROMOTION_BRAND_ASSETS) {
    await f.selectArtwork(asset.id); await tick();
    assert.equal(rendered.at(-1).brandAsset.dataUrl, artworkData(asset.id));
    assert.equal(f.el('preview').children[0].getAttribute('data-artwork'), asset.id);
    assert.equal(f.ui.getPrepared().artwork, asset.id);
    assert.equal(f.el('export').disabled, false);
  }
  f.el('locale').value = 'fil-PH'; await f.el('locale').fire('change'); await tick();
  assert.equal(rendered.at(-1).brandAsset.alt, getPromotionBrandAsset('miniature').alt['fil-PH']);
  assert.equal(f.artworkLoads.filter(item => item.asset.id === 'miniature').length, 1);
});

test('artwork persists across page round-trip and reload without crossing account preference keys', async t => {
  const center = fixture(); t.after(() => center.ui.destroy()); await tick();
  await center.selectArtwork('community'); await tick();
  const kitQuery = new URL(center.el('marketingKit').href, 'https://caliof.com').search;
  const kit = fixture({ page: 'kit', query: kitQuery, preferences: center.values }); t.after(() => kit.ui.destroy()); await tick();
  assert.equal(kit.ui.getChoices().artwork, 'community');
  assert.equal(new URL(kit.el('back').href, 'https://caliof.com').searchParams.get('artwork'), 'community');
  const reload = fixture({ preferences: center.values }); t.after(() => reload.ui.destroy()); await tick();
  assert.equal(reload.ui.getChoices().artwork, 'community');
  const other = fixture({ preferences: center.values, accountId: 22 }); t.after(() => other.ui.destroy()); await tick();
  assert.equal(other.ui.getChoices().artwork, 'local-business');
  await other.selectArtwork('miniature'); await tick();
  assert.equal(JSON.parse(center.values.get('abl_referral_presentation_v1:21')).artwork, 'community');
  assert.equal(JSON.parse(center.values.get('abl_referral_presentation_v1:22')).artwork, 'miniature');
});

test('an older center artwork response cannot overwrite a newer chosen hero', async t => {
  const loads = [];
  const f = fixture({ loadBrandAsset: asset => { const pending = deferred(); loads.push({ asset, ...pending }); return pending.promise; } });
  t.after(() => f.ui.destroy()); await tick();
  await f.selectArtwork('community'); await tick();
  assert.equal(f.el('brandArtwork').src, undefined);
  assert.equal(f.el('artworkOptions').getAttribute('aria-busy'), 'true');
  loads[1].resolve({ dataUrl: artworkData('community') }); await tick();
  loads[0].resolve({ dataUrl: artworkData('local-business') }); await tick();
  assert.equal(f.el('brandArtwork').getAttribute('data-artwork'), 'community');
  assert.equal(f.el('brandArtwork').src, artworkData('community'));
});

test('late success and failure from an old kit artwork cannot replace the current preview', async t => {
  for (const lateFailure of [false, true]) {
    const loads = [];
    const f = fixture({ page: 'kit', loadBrandAsset: asset => { const pending = deferred(); loads.push({ asset, ...pending }); return pending.promise; } });
    t.after(() => f.ui.destroy()); await tick();
    await f.selectArtwork('miniature'); await tick();
    assert.equal(f.el('export').disabled, true);
    assert.equal(f.el('preview').children[0].tagName, 'DIV');
    loads[1].resolve({ dataUrl: artworkData('miniature') }); await tick();
    if (lateFailure) loads[0].reject(new Error('Old artwork failed'));
    else loads[0].resolve({ dataUrl: artworkData('local-business') });
    await tick();
    assert.equal(f.ui.getPrepared().artwork, 'miniature');
    assert.equal(f.el('artworkRetry').hidden, true);
    assert.equal(f.el('export').disabled, false);
  }
});

test('failure of a new selected artwork clears an old ready design and does not export the old artwork', async t => {
  const f = fixture({ page: 'kit', loadBrandAsset: async asset => {
    if (asset.id === 'community') throw new Error('Missing selected artwork');
    return { dataUrl: artworkData(asset.id) };
  } });
  t.after(() => f.ui.destroy()); await tick();
  assert.equal(f.el('export').disabled, false);
  await f.selectArtwork('community'); await tick();
  assert.equal(f.ui.getPrepared(), null);
  assert.equal(f.el('preview').children[0].tagName, 'DIV');
  assert.equal(f.el('export').disabled, true);
  assert.equal(f.el('print').disabled, true);
  assert.equal(f.el('artworkRetry').hidden, false);
});

test('artwork completed after sign-out cannot restore a hero or a prepared design', async t => {
  for (const page of ['center', 'kit']) {
    const pending = deferred();
    const f = fixture({ page, loadBrandAsset: () => pending.promise }); t.after(() => f.ui.destroy()); await tick();
    f.signOut(); await f.document.fire('abl:auth-expired');
    pending.resolve({ dataUrl: artworkData('local-business') }); await tick();
    assert.equal(f.el('signin').hidden, false);
    assert.equal(f.el('artworkStatus').textContent, promotionText('en-PH', 'artworkWaiting'));
    if (page === 'center') assert.equal(f.el('brandArtwork').src, undefined);
    else { assert.equal(f.ui.getPrepared(), null); assert.equal(f.el('export').disabled, true); }
  }
});

test('pending artwork and old presentation choices do not overwrite a newly verified account', async t => {
  const loads = [];
  const f = fixture({ query: '?artwork=community', loadBrandAsset: asset => { const pending = deferred(); loads.push({ asset, ...pending }); return pending.promise; } });
  t.after(() => f.ui.destroy()); await tick();
  f.changeAccount(22); const fresh = f.ui.controller.load(); await tick();
  assert.equal(f.ui.getChoices().artwork, 'local-business');
  loads[1].resolve({ dataUrl: artworkData('local-business') }); await fresh;
  loads[0].resolve({ dataUrl: artworkData('community') }); await tick();
  assert.equal(f.el('brandArtwork').src, artworkData('local-business'));
  assert.equal(f.ui.controller.getCurrent().account.id, 22);
  assert.equal(JSON.parse(f.values.get('abl_referral_presentation_v1:22')).artwork, 'local-business');
});

test('changing artwork during export preparation ignores the older completed file', async t => {
  const exports = [];
  const f = fixture({ page: 'kit', createExport: options => { const pending = deferred(); exports.push({ options, ...pending }); return pending.promise; } });
  t.after(() => f.ui.destroy()); await tick();
  await f.selectArtwork('community'); await tick();
  exports[0].resolve({ blob: new Blob(['old']), filename: 'old.png', mimeType: 'image/png' }); await tick();
  assert.equal(f.ui.getPrepared(), null);
  assert.equal(f.el('export').disabled, true);
  exports[1].resolve({ blob: new Blob(['new']), filename: 'new.png', mimeType: 'image/png' }); await tick();
  assert.equal(f.ui.getPrepared().filename, 'new.png');
  assert.equal(f.ui.getPrepared().artwork, 'community');
});
