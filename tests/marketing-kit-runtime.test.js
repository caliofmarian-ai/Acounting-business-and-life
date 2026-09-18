import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RUNTIME_MARKETING_TEMPLATES,
  RUNTIME_MARKETING_COPY,
  SUPPORTED_MARKETING_LOCALES,
  deriveReferrerName,
  generateMarketingKitSvg,
  marketingKitFileName
} from '../public/referral/marketing-kit-runtime.js';

const manifest = JSON.parse(readFileSync(new URL('../marketing-kit/template-manifest.json', import.meta.url), 'utf8'));
const enCopy = JSON.parse(readFileSync(new URL('../marketing-kit/copy.en-PH.json', import.meta.url), 'utf8'));
const filCopy = JSON.parse(readFileSync(new URL('../marketing-kit/copy.fil-PH.json', import.meta.url), 'utf8'));
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

test('runtime creative copy exactly matches canonical en-PH and fil-PH packs', () => {
  assert.deepEqual(SUPPORTED_MARKETING_LOCALES, ['en-PH','fil-PH']);
  assert.deepEqual(RUNTIME_MARKETING_COPY['en-PH'], enCopy);
  assert.deepEqual(RUNTIME_MARKETING_COPY['fil-PH'], filCopy);
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
  assert.match(svg, /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
  assert.match(svg, /xlink:href="data:image\/png;base64,QUJDRA=="/);
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

test('runtime creates locale-traceable safe SVG filenames', () => {
  assert.equal(marketingKitFileName('A5_REFERRAL_FLYER_V1',code),'business-life-a5-referral-flyer-v1-en-ph-'+code+'.svg');
  assert.equal(marketingKitFileName('A5_REFERRAL_FLYER_V1',code,'fil-PH'),'business-life-a5-referral-flyer-v1-fil-ph-'+code+'.svg');
  assert.throws(() => marketingKitFileName('UNKNOWN',code), /unknown marketing template/);
});

test('Filipino creative uses canonical localized headline and CTA without changing referral identity', () => {
  const svg = generateMarketingKitSvg({
    templateId:'SOCIAL_SQUARE_REFERRAL_V1',
    locale:'fil-PH',
    variantId:'personal_share_v1',
    fields:{referrerName:'Maria Santos',referralCode:code,referralUrl:url,qrDataUrl:qr}
  });
  assert.match(svg, /Inimbitahan kang subukan ang Business &amp; Life/);
  assert.match(svg, /I-SCAN PARA MAGSIMULA/);
  assert.match(svg, /Inirerekomenda ni Maria Santos/);
  assert.match(svg, /r1_abcdefghijklmnop/);
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
  assert.match(page, /CREATIVE LANGUAGE/);
  assert.match(page, /fil-PH/);
  assert.match(page, /syncVariantOptions/);
  assert.match(page, /new Blob/);
  assert.match(page, /preview\.innerHTML=svg/);
  assert.match(page, /preview\.querySelector\('svg'\)/);
  assert.match(page, /previewFailure/);
  assert.doesNotMatch(page, /preview\.src=previewUrl/);
  assert.doesNotMatch(page, /api\.qrserver|quickchart|chart\.google/);
});
