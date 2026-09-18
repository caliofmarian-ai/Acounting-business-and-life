import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/referral/promotion-center.html', import.meta.url), 'utf8');

test('Promotion Center exposes all five public profile sources', () => {
  for (const role of ['customer','merchant','supplier','courier','service_provider']) {
    assert.match(html, new RegExp('value="'+role+'"'));
  }
});

test('Promotion Center loads authenticated account identity instead of embedding demo identity', () => {
  assert.match(html, /\/api\/growth\/referral\?profile=/);
  assert.match(html, /localStorage\.getItem\('abl_token'\)/);
  assert.match(html, /Sign in required/);
  assert.doesNotMatch(html, /r1_DemoReferral2026/);
});

test('Promotion Center supports explicit user-initiated sharing channels', () => {
  for (const marker of ['navigator.share','wa.me','t.me\/share\/url','sms:','mailto:']) {
    assert.match(html, new RegExp(marker));
  }
});

test('direct server email/phone sending remains disabled pending referral-specific gates', () => {
  assert.match(html, /direct referral sending stays disabled/i);
  assert.match(html, /<input disabled/);
  assert.match(html, /<button disabled>Send invitation<\/button>/);
});

test('Promotion Center repeats the operational authority boundary', () => {
  assert.match(html, /never approves Merchant, Supplier, Courier, Service Provider or Admin authority/i);
});

test('Promotion Center renders the authenticated local QR and keeps code fallback', () => {
  assert.match(html, /id="qrImage"/);
  assert.match(html, /id="qrFallback"/);
  assert.match(html, /data\.qr\.dataUrl/);
  assert.match(html, /data\.qr\.referralUrl!==data\.referralUrl/);
  assert.match(html, /data\.qr\.marker!=='qr'/);
  assert.match(html, /one-shot local <code>#qr<\/code> origin marker/i);
  assert.match(html, /Use your referral code if QR is unavailable/i);
  assert.doesNotMatch(html, /api\.qrserver|quickchart|chart\.google/);
});
