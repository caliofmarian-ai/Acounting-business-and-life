import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RUNTIME_MARKETING_TEMPLATES,
  generateMarketingKitSvg
} from '../public/referral/marketing-kit-runtime.js';

const manifest = JSON.parse(readFileSync(new URL('../marketing-kit/template-manifest.json', import.meta.url), 'utf8'));
const qrRenderer = readFileSync(new URL('../growth/referral-qr.js', import.meta.url), 'utf8');

const code = 'r1_abcdefghijklmnop';
const referralUrl = 'https://example.test/referral/?ref='+code+'&utm_campaign=merchant_referral_v1&utm_source=profile&utm_medium=referral&profile=merchant';
const qrDataUrl = 'data:image/png;base64,QUJDRA==';
const fields = {
  referrerName: 'Maria Santos',
  referralCode: code,
  referralUrl,
  qrDataUrl
};

const printSpecs = [
  { templateId: 'A4_REFERRAL_POSTER_V1', widthMm: 210, heightMm: 297 },
  { templateId: 'A5_REFERRAL_FLYER_V1', widthMm: 148, heightMm: 210 }
];

function qrWidthFromSvg(svg) {
  const match = svg.match(/<image[^>]*\swidth="([0-9.]+)"[^>]*\sheight="([0-9.]+)"/);
  assert.ok(match, 'embedded QR image must be present in SVG');
  assert.equal(Number(match[1]), Number(match[2]), 'QR image must remain square');
  return Number(match[1]);
}

test('print QR preflight uses the canonical four-module quiet zone', () => {
  assert.equal(manifest.qrRules.quietZoneModules, 4);
  assert.match(qrRenderer, /margin:\s*4/);
});

for (const spec of printSpecs) {
  test(spec.templateId+' keeps the QR above the canonical minimum physical print size', () => {
    const template = RUNTIME_MARKETING_TEMPLATES.find(item => item.id === spec.templateId);
    assert.ok(template, 'runtime template must exist');
    const svg = generateMarketingKitSvg({
      templateId: spec.templateId,
      locale: 'en-PH',
      variantId: 'personal_share_v1',
      fields
    });
    const qrWidthPx = qrWidthFromSvg(svg);
    const qrWidthMm = qrWidthPx / template.width * spec.widthMm;

    assert.ok(
      qrWidthMm >= manifest.qrRules.minimumPrintSizeMm,
      'QR physical width '+qrWidthMm.toFixed(2)+'mm must be >= '+manifest.qrRules.minimumPrintSizeMm+'mm'
    );
  });
}

test('A4 and A5 print canvases keep the intended paper aspect ratio within raster rounding tolerance', () => {
  for (const spec of printSpecs) {
    const template = RUNTIME_MARKETING_TEMPLATES.find(item => item.id === spec.templateId);
    const runtimeRatio = template.width / template.height;
    const physicalRatio = spec.widthMm / spec.heightMm;
    assert.ok(Math.abs(runtimeRatio - physicalRatio) < 0.003, spec.templateId+' aspect ratio drifted');
  }
});

test('automated preflight does not claim a physical scan result', () => {
  const doc = readFileSync(new URL('../docs/growth/PRINT_QR_ACCEPTANCE.md', import.meta.url), 'utf8');
  assert.match(doc, /does not replace a real printed scan test/i);
  assert.match(doc, /physical scan status:\s*HOLD/i);
});
