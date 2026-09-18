import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RUNTIME_MARKETING_TEMPLATES,
  deriveReferrerName,
  generateMarketingKitSvg,
  marketingKitFileName
} from '../public/referral/marketing-kit-runtime.js';

const manifest = JSON.parse(readFileSync(new URL('../marketing-kit/template-manifest.json', import.meta.url), 'utf8'));
const page = readFileSync(new URL('../public/referral/marketing-kit.html', import.meta.url), 'utf8');
const code = 'r1_abcdefghijklmnop';
const url = 'https://example.test/referral/?ref='+code+'&utm_campaign=merchant_referral_v1&utm_source=profile&utm_medium=referral&profile=merchant';
const qr = 'data:image/png;base64,QUJDRA==';

test('runtime Marketing Kit templates match the canonical manifest ids and dimensions', () => {
  const canonical = manifest.templates.map(({id,width,height}) => ({id,width,height}));
  const runtime = RUNTIME_MARKETING_TEMPLATES.map(({id,width,height}) => ({id,width,height}));
  assert.deepEqual(runtime, canonical);
  assert.deepEqual(manifest.dynamicFields, ['REFERRER_NAME','REFERRAL_CODE','REFERRAL_URL','QR_ASSET']);
});

test('referrer name derives only from the canonical invitation sentence', () => {
  assert.equal(deriveReferrerName('Maria Santos invited you to try Business & Life.'), 'Maria Santos');
  assert.equal(deriveReferrerName('You are invited to try Business & Life.'), 'Business & Life member');
});

test('SVG export binds canonical referral fields and escapes user-controlled text', () => {
  const svg = generateMarketingKitSvg({
    templateId:'SOCIAL_SQUARE_REFERRAL_V1',
    fields:{referrerName:'A <script>alert(1)</script>',referralCode:code,referralUrl:url,qrDataUrl:qr}
  });
  assert.match(svg, /width="1080" height="1080"/);
  assert.match(svg, /r1_abcdefghijklmnop/);
  assert.match(svg, /data:image\/png;base64,QUJDRA==/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('runtime rejects mismatched referral identity and non-local QR asset shapes', () => {
  assert.throws(() => generateMarketingKitSvg({
    templateId:'A4_REFERRAL_POSTER_V1',
    fields:{referrerName:'A',referralCode:code,referralUrl:url.replace(code,'r1_ponmlkjihgfedcba'),qrDataUrl:qr}
  }), /must match/);
  assert.throws(() => generateMarketingKitSvg({
    templateId:'A4_REFERRAL_POSTER_V1',
    fields:{referrerName:'A',referralCode:code,referralUrl:url,qrDataUrl:'https://third-party.test/qr.png'}
  }), /local PNG QR asset/);
});

test('runtime creates safe deterministic SVG filenames', () => {
  assert.equal(marketingKitFileName('A5_REFERRAL_FLYER_V1',code),'business-life-a5-referral-flyer-v1-'+code+'.svg');
  assert.throws(() => marketingKitFileName('UNKNOWN',code), /unknown marketing template/);
});

test('Marketing Kit page uses authenticated live referral data and user-initiated export/share', () => {
  assert.match(page, /\/api\/growth\/referral\?profile=/);
  assert.match(page, /Authorization:'Bearer '\+auth/);
  assert.match(page, /Export SVG/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /navigator\.canShare/);
  assert.match(page, /typeof File==='function'/);
  assert.match(page, /downloadBlob\(blob,fileName\)/);
  assert.match(page, /promotion-center\.html\?profile=/);
  assert.match(page, /new Blob/);
  assert.doesNotMatch(page, /api\.qrserver|quickchart|chart\.google/);
});
