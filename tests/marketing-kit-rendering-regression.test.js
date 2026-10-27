import test from 'node:test';
import assert from 'node:assert/strict';
import { SaxesParser } from 'saxes';
import { buildLocalReferralQr } from '../growth/referral-qr.js';
import {
  RUNTIME_MARKETING_TEMPLATES,
  RUNTIME_MARKETING_COPY,
  generateMarketingKitSvg,
  getMarketingKitTemplate,
  getMarketingKitExportSize,
  marketingKitFileName
} from '../public/referral/marketing-kit-runtime.js';

const referralCode = 'r1_abcdefghijklmnop';
const referralUrl = `https://caliof.com/referral/?ref=${referralCode}&utm_campaign=merchant_referral_v1&utm_source=profile&utm_medium=referral&profile=merchant`;
const qr = await buildLocalReferralQr(referralUrl);
const fields = { referrerName: 'Maria Santos', referralCode, referralUrl, qrDataUrl: qr.dataUrl };
const brandAsset = { dataUrl: qr.dataUrl, alt: 'Approved artwork & identity' };

// Parse the complete exported file as XML, not as tolerant HTML or source regex.
// saxes is already installed by the repository's locked ExcelJS dependency.
function parseSvg(svg) {
  const parser = new SaxesParser({ xmlns: true }), stack = [], nodes = [];
  parser.on('opentag', tag => {
    const node = { name: tag.local, attrs: Object.fromEntries(Object.entries(tag.attributes).map(([key, attr]) => [key, attr.value])), children: [], text: '', parent: stack.at(-1) };
    if (node.parent) node.parent.children.push(node);
    stack.push(node); nodes.push(node);
  });
  parser.on('text', text => { if (stack.length) stack.at(-1).text += text; });
  parser.on('closetag', () => stack.pop());
  parser.write(svg).close();
  assert.equal(nodes[0]?.name, 'svg');
  return nodes;
}
const content = node => node.text + node.children.map(content).join('');
const withoutWhitespace = value => value.replace(/\s/gu, '');
const intersection = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .4 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .4;
function rect(node) { return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(node.attrs[key])])); }
function checkBounds(box, width, height, label) {
  assert.ok(['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])), `${label}: finite coordinates`);
  assert.ok(box.width > 0 && box.height > 0, `${label}: positive size`);
  assert.ok(box.x >= -.2 && box.y >= -.2 && box.x + box.width <= width + .2 && box.y + box.height <= height + .2, `${label}: inside ${width}×${height} (${JSON.stringify(box)})`);
}
function checkGeometry(nodes) {
  const { width, height } = nodes[0].attrs, textBoxes = [];
  for (const line of nodes.filter(node => node.name === 'tspan')) {
    const size = Number(line.parent.attrs['font-size']);
    assert.equal(line.attrs.lengthAdjust, 'spacingAndGlyphs', 'standalone fonts cannot enlarge a line beyond its explicit width');
    const box = { x: Number(line.attrs.x), y: Number(line.attrs.y) - size, width: Number(line.attrs.textLength), height: size * 1.28, role: line.parent.attrs['data-text-role'] };
    checkBounds(box, Number(width), Number(height), box.role);
    for (const previous of textBoxes) assert.equal(intersection(box, previous), false, `${box.role} overlaps ${previous.role}`);
    textBoxes.push(box);
  }
  const images = nodes.filter(node => node.name === 'image');
  const qrNode = images.find(node => node.attrs['data-image-role'] === 'qr');
  assert.ok(qrNode, 'real local QR is embedded');
  assert.equal(qrNode.attrs.width, qrNode.attrs.height, 'QR stays square');
  for (const image of images) {
    const box = rect(image);
    checkBounds(box, Number(width), Number(height), image.attrs['data-image-role']);
    for (const text of textBoxes) assert.equal(intersection(box, text), false, `${text.role} overlaps ${image.attrs['data-image-role']}`);
  }
  if (images.length === 2) assert.equal(intersection(rect(images[0]), rect(images[1])), false, 'brand image never covers QR');
}

test('strict XML parsing catches the original standalone SVG ampersand defect', () => {
  assert.throws(() => parseSvg('<svg xmlns="http://www.w3.org/2000/svg" aria-label="Business & Life"></svg>'), /entity|character|name|unexpected end/i);
});

for (const template of RUNTIME_MARKETING_TEMPLATES) {
  for (const [locale, pack] of Object.entries(RUNTIME_MARKETING_COPY)) {
    for (const variant of pack.variants) {
      test(`${template.id} / ${locale} / ${variant.id}: complete XML, content and bounded layout`, () => {
        const nodes = parseSvg(generateMarketingKitSvg({ templateId: template.id, fields, locale, variantId: variant.id, brandAsset }));
        assert.equal(nodes[0].attrs.width, String(template.width));
        assert.equal(nodes[0].attrs.height, String(template.height));
        checkGeometry(nodes);
        const texts = new Map(nodes.filter(node => node.name === 'text').map(node => [node.attrs['data-text-role'], node]));
        for (const [role, expected] of [['headline', variant.headline], ['body', variant.body], ['url', referralUrl], ['code', pack.reusable.referralCodeLabel.replace('{REFERRAL_CODE}', referralCode)], ['referrer', pack.reusable.recommendedBy.replace('{REFERRER_NAME}', fields.referrerName)]]) {
          assert.equal(withoutWhitespace(content(texts.get(role))), withoutWhitespace(expected), `${role} has no missing or truncated characters`);
        }
        const anchors = nodes.filter(node => node.name === 'a');
        assert.equal(anchors.length, 2, 'visible complete URL and QR are clickable');
        for (const anchor of anchors) assert.equal(anchor.attrs.href, referralUrl, 'full ref/profile/campaign attribution stays in link');
        assert.equal(nodes.find(node => node.attrs['data-image-role'] === 'qr').attrs.href, qr.dataUrl);
      });
    }
  }
}

test('maximum supported names and XML-sensitive characters remain complete and within artwork bounds', () => {
  for (const referrerName of ['W'.repeat(120), 'Maria & José <shop> "test"', 'Maria Santos Dela Cruz '.repeat(3).trim(), 'Maria 👩🏽‍🍳 Santos']) {
    for (const template of RUNTIME_MARKETING_TEMPLATES) {
      const nodes = parseSvg(generateMarketingKitSvg({ templateId: template.id, fields: { ...fields, referrerName }, locale: 'fil-PH', brandAsset }));
      checkGeometry(nodes);
      const name = nodes.find(node => node.attrs['data-text-role'] === 'referrer');
      assert.equal(withoutWhitespace(content(name)), withoutWhitespace('Inirerekomenda ni ' + referrerName));
      assert.equal(nodes.some(node => node.name === 'script'), false);
    }
  }
});

test('invalid XML controls and unpaired Unicode surrogates cannot corrupt an exported file', () => {
  const nodes = parseSvg(generateMarketingKitSvg({ templateId: 'A4_REFERRAL_POSTER_V1', fields: { ...fields, referrerName: 'Maria\u0000 \uD800 Santos' } }));
  const name = nodes.find(node => node.attrs['data-text-role'] === 'referrer');
  assert.equal(name.attrs['aria-label'], 'Recommended by Maria \uFFFD Santos');
});

test('oversized inputs fail explicitly instead of silently truncating text', () => {
  assert.throws(() => generateMarketingKitSvg({ templateId: 'A4_REFERRAL_POSTER_V1', fields: { ...fields, referrerName: 'W'.repeat(121) } }), /no more than 120/);
  assert.throws(() => generateMarketingKitSvg({ templateId: 'EMAIL_WEB_BANNER_V1', fields: { ...fields, referralUrl: referralUrl + '&extra=' + 'x'.repeat(1200) } }), /too long/);
});

test('brand assets are optional, embedded raster only, and require an accessible description', () => {
  const options = { templateId: 'A4_REFERRAL_POSTER_V1', fields };
  assert.equal(parseSvg(generateMarketingKitSvg(options)).filter(node => node.name === 'image').length, 1);
  for (const dataUrl of ['https://external.test/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AAA" onload="alert(1)']) {
    assert.throws(() => generateMarketingKitSvg({ ...options, brandAsset: { dataUrl, alt: 'Artwork' } }), /embedded PNG/);
  }
  assert.throws(() => generateMarketingKitSvg({ ...options, brandAsset: { dataUrl: qr.dataUrl, alt: '' } }), /description/);
});

test('scan-first templates have distinct artwork and larger clear QR targets', () => {
  const render = templateId => parseSvg(generateMarketingKitSvg({ templateId, fields }));
  const qrWidth = nodes => Number(nodes.find(node => node.attrs['data-image-role'] === 'qr').attrs.width);
  assert.ok(qrWidth(render('WINDOW_STICKER_V1')) > qrWidth(render('SOCIAL_SQUARE_REFERRAL_V1')) * 1.5);
  assert.ok(qrWidth(render('QR_PHONE_CARD_V1')) > qrWidth(render('STORY_REFERRAL_V1')) * 2);
});

test('print and digital export dimensions use physical page sizes and safe format filenames', () => {
  assert.deepEqual(getMarketingKitTemplate('A4_REFERRAL_POSTER_V1').print, { widthMm: 210, heightMm: 297 });
  assert.deepEqual(getMarketingKitTemplate('A5_REFERRAL_FLYER_V1').print, { widthMm: 148, heightMm: 210 });
  assert.deepEqual(getMarketingKitExportSize('A4_REFERRAL_POSTER_V1'), { width: 2480, height: 3508 });
  assert.deepEqual(getMarketingKitExportSize('A5_REFERRAL_FLYER_V1'), { width: 1748, height: 2480 });
  assert.deepEqual(getMarketingKitExportSize('SOCIAL_SQUARE_REFERRAL_V1'), { width: 1080, height: 1080 });
  assert.throws(() => getMarketingKitExportSize('A4_REFERRAL_POSTER_V1', { dpi: Infinity }), /resolution/);
  for (const format of ['svg', 'png', 'jpg', 'pdf']) assert.ok(marketingKitFileName('A4_REFERRAL_POSTER_V1', referralCode, 'fil-PH', format).endsWith(`-fil-ph-${referralCode}.${format}`));
  assert.throws(() => marketingKitFileName('A4_REFERRAL_POSTER_V1', referralCode, 'en-PH', 'html'), /unsupported/);
});
