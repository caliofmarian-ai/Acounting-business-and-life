import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalReferralQr } from '../growth/referral-qr.js';

const one = 'https://example.test/referral/?ref=r1_abcdefghijklmnop&utm_campaign=customer_referral_v1&utm_source=profile&utm_medium=referral&profile=customer';
const two = 'https://example.test/referral/?ref=r1_abcdefghijklmnop&utm_campaign=merchant_referral_v1&utm_source=profile&utm_medium=referral&profile=merchant';

test('local QR encodes the canonical referral URL without a third-party service', async () => {
  const qr = await buildLocalReferralQr(one);
  assert.equal(qr.encoder, 'local');
  assert.equal(qr.format, 'png');
  assert.equal(qr.payload, one);
  assert.match(qr.dataUrl, /^data:image\/png;base64,/);
});

test('local QR changes when profile/campaign referral URL changes', async () => {
  const customer = await buildLocalReferralQr(one);
  const merchant = await buildLocalReferralQr(two);
  assert.notEqual(customer.payload, merchant.payload);
  assert.notEqual(customer.dataUrl, merchant.dataUrl);
});

test('local QR refuses non-referral payloads', async () => {
  await assert.rejects(() => buildLocalReferralQr('https://example.test/other?ref=r1_abcdefghijklmnop'), /canonical referral URL/);
  await assert.rejects(() => buildLocalReferralQr('javascript:alert(1)'), /http or https/);
});
