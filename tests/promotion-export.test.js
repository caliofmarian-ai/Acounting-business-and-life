import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketingKitExport, decodePromotionImage, downloadPromotionFile, promotionPrintDocument } from '../public/referral/promotion-export.js';
import { loadApprovedBrandAsset } from '../public/referral/promotion-page.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><title>Business &amp; Life</title></svg>';
const options = { svg, templateId: 'A4_REFERRAL_POSTER_V1', referralCode: 'r1_abcdefghijklmnop', locale: 'fil-PH' };
class LoadedImage {
  naturalWidth = 794;
  naturalHeight = 1123;
  decode() { return Promise.resolve(); }
}
function runtimeFixture({ toBlob, Image = LoadedImage } = {}) {
  const created = [], revoked = [], calls = [], anchors = [], timers = [];
  const context = { fillStyle: '', fillRect: (...args) => calls.push(['fill', context.fillStyle, ...args]), drawImage: (...args) => calls.push(['draw', ...args]) };
  const canvas = {
    width: 0, height: 0, getContext: () => context,
    toBlob: toBlob || ((callback, type) => callback(new Blob(['raster'], { type })))
  };
  const runtime = {
    Blob, Image, location: { origin: 'https://caliof.com' },
    URL: { createObjectURL: blob => { created.push(blob); return 'blob:export-' + created.length; }, revokeObjectURL: url => revoked.push(url) },
    document: { body: { append: anchor => anchors.push(anchor) }, createElement: tag => tag === 'canvas' ? canvas : {
      click() { this.clicked = true; }, remove() { this.removed = true; }
    } },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
  };
  return { runtime, canvas, context, created, revoked, calls, anchors, timers };
}

test('SVG export keeps a standalone XML blob with a truthful localized filename', async () => {
  const f = runtimeFixture();
  const output = await createMarketingKitExport({ ...options, format: 'svg' }, f.runtime);
  assert.equal(output.mimeType, 'image/svg+xml');
  assert.equal(await output.blob.text(), svg);
  assert.match(output.filename, /fil-ph-r1_abcdefghijklmnop\.svg$/);
  assert.equal(f.created.length, 0);
});

test('PNG export uses A4 dimensions at 300 pixels per inch and releases temporary resources', async () => {
  const f = runtimeFixture();
  const output = await createMarketingKitExport(options, f.runtime);
  assert.equal(output.mimeType, 'image/png');
  assert.deepEqual([output.width, output.height], [2480, 3508]);
  assert.deepEqual(f.calls[0], ['fill', '#ffffff', 0, 0, 2480, 3508]);
  assert.deepEqual(f.revoked, ['blob:export-1']);
  assert.deepEqual([f.canvas.width, f.canvas.height], [0, 0]);
});

test('JPEG export uses the requested MIME and a white background', async () => {
  const f = runtimeFixture();
  const output = await createMarketingKitExport({ ...options, templateId: 'SOCIAL_SQUARE_REFERRAL_V1', format: 'jpg' }, f.runtime);
  assert.equal(output.blob.type, 'image/jpeg');
  assert.match(output.filename, /\.jpg$/);
  assert.deepEqual([output.width, output.height], [1080, 1080]);
  assert.equal(f.calls[0][1], '#ffffff');
});

test('failed raster encoding does not return a fake successful file', async () => {
  for (const value of [null, new Blob(['wrong'], { type: 'image/webp' })]) {
    const f = runtimeFixture({ toBlob: callback => callback(value) });
    await assert.rejects(createMarketingKitExport(options, f.runtime), /Image export failed/);
    assert.equal(f.revoked.length, 1);
    assert.equal(f.canvas.width, 0);
  }
});

test('stalled canvas encoding expires and releases its object URL', async () => {
  const f = runtimeFixture({ toBlob: () => {} });
  await assert.rejects(createMarketingKitExport({ ...options, timeoutMs: 5 }, f.runtime), /timed out/);
  assert.deepEqual(f.revoked, ['blob:export-1']);
  assert.equal(f.canvas.width, 0);
});

test('image decode failure and abort reject instead of displaying a broken preview', async () => {
  class FailedImage extends LoadedImage { decode() { return Promise.reject(new Error('Malformed image')); } }
  await assert.rejects(decodePromotionImage('broken', { ImageCtor: FailedImage }), /Malformed/);
  class HangingImage { naturalWidth = 0; naturalHeight = 0; decode() { return new Promise(() => {}); } }
  await assert.rejects(decodePromotionImage('pending', { ImageCtor: HangingImage, timeoutMs: 5 }), /timed out/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(decodePromotionImage('cancelled', { ImageCtor: LoadedImage, signal: abort.signal }), { name: 'AbortError' });
});

test('print document preserves exact A4/A5 paper size, escaped labels and a working close script', () => {
  for (const [templateId, size] of [['A4_REFERRAL_POSTER_V1', '210mm 297mm'], ['A5_REFERRAL_FLYER_V1', '148mm 210mm']]) {
    const html = promotionPrintDocument({ svg, templateId, locale: 'fil-PH', title: '<Print & share>', help: 'Use "Save as PDF"', action: 'Print', close: 'Close' });
    assert.ok(html.includes('@page{size:' + size + ';margin:0}'));
    assert.ok(html.includes('<title>&lt;Print &amp; share&gt;</title>'));
    assert.ok(html.includes('</script></body></html>'));
    assert.ok(html.includes('window.print()'));
    assert.ok(html.includes(svg));
  }
});

test('download initiates the exact file and delays URL retirement for mobile handoff', () => {
  const f = runtimeFixture();
  downloadPromotionFile({ blob: new Blob(['png'], { type: 'image/png' }), filename: 'invitation.png' }, f.runtime);
  assert.equal(f.anchors[0].download, 'invitation.png');
  assert.equal(f.anchors[0].clicked, true);
  assert.equal(f.anchors[0].removed, true);
  assert.equal(f.revoked.length, 0);
  assert.equal(f.timers[0].delay, 30000);
  f.timers[0].callback();
  assert.deepEqual(f.revoked, ['blob:export-1']);
});

test('optional artwork fetch has a deadline even when the network ignores abort', async () => {
  const f = runtimeFixture(); let signal;
  f.runtime.fetch = (_url, init) => { signal = init.signal; return new Promise(() => {}); };
  await assert.rejects(loadApprovedBrandAsset(f.runtime, 'en-PH', { src: '/referral/assets/approved.webp' }, { timeoutMs: 5 }), { name: 'AbortError' });
  assert.equal(signal.aborted, true);
});

test('stalled artwork FileReader is stopped when its deadline expires', async () => {
  const f = runtimeFixture(); let reader;
  f.runtime.fetch = async () => ({ ok: true, blob: async () => new Blob(['small'], { type: 'image/png' }) });
  f.runtime.FileReader = class {
    constructor() { reader = this; this.readyState = 1; }
    readAsDataURL() {}
    abort() { this.aborted = true; this.readyState = 2; }
  };
  await assert.rejects(loadApprovedBrandAsset(f.runtime, 'en-PH', { src: '/referral/assets/approved.png' }, { timeoutMs: 5 }), { name: 'AbortError' });
  assert.equal(reader.aborted, true);
});

test('artwork size gate allows room for base64 expansion and external image URLs are refused', async () => {
  const f = runtimeFixture();
  f.runtime.fetch = async () => ({ ok: true, blob: async () => ({ type: 'image/png', size: 6 * 1024 * 1024 }) });
  await assert.rejects(loadApprovedBrandAsset(f.runtime, 'en-PH', { src: '/referral/assets/oversize.png' }), /supported image/);
  await assert.rejects(loadApprovedBrandAsset(f.runtime, 'en-PH', { src: 'https://external.test/art.png' }), /Unapproved/);
});
