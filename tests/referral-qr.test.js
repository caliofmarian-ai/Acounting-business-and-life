import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalReferralQr } from '../growth/referral-qr.js';
import { readFileSync } from 'node:fs';

const one = 'https://example.test/referral/?ref=r1_abcdefghijklmnop&utm_campaign=customer_referral_v1&utm_source=profile&utm_medium=referral&profile=customer';
const two = 'https://example.test/referral/?ref=r1_abcdefghijklmnop&utm_campaign=merchant_referral_v1&utm_source=profile&utm_medium=referral&profile=merchant';

test('local QR keeps the canonical referral identity and adds only a one-shot qr fragment', async () => {
  const qr = await buildLocalReferralQr(one);
  assert.equal(qr.encoder, 'local');
  assert.equal(qr.format, 'png');
  assert.equal(qr.marker, 'qr');
  assert.equal(qr.referralUrl, one);
  assert.equal(qr.payload, one + '#qr');
  assert.match(qr.dataUrl, /^data:image\/png;base64,/);
});

test('local QR changes when profile/campaign referral URL changes', async () => {
  const customer = await buildLocalReferralQr(one);
  const merchant = await buildLocalReferralQr(two);
  assert.notEqual(customer.payload, merchant.payload);
  assert.notEqual(customer.dataUrl, merchant.dataUrl);
});

test('local QR refuses non-referral or pre-fragmented payloads', async () => {
  await assert.rejects(() => buildLocalReferralQr('https://example.test/other?ref=r1_abcdefghijklmnop'), /canonical referral URL/);
  await assert.rejects(() => buildLocalReferralQr('javascript:alert(1)'), /http or https/);
  await assert.rejects(() => buildLocalReferralQr(one + '#other'), /must not contain a fragment/);
});

test('QR renderer enforces the four-module quiet-zone contract', () => {
  const source = readFileSync(new URL('../growth/referral-qr.js', import.meta.url), 'utf8');
  assert.match(source, /margin:\s*4/);
});
