import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/referral/promotion-center.html', import.meta.url), 'utf8');

test('Promotion Center preview exposes all five public profile sources', () => {
  for (const role of ['customer','merchant','supplier','courier','service_provider']) {
    assert.match(html, new RegExp('value="'+role+'"'));
  }
});

test('Promotion Center preview contains the scan-validated demo QR and account-level code', () => {
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /r1_DemoReferral2026/);
});

test('Promotion Center preview supports explicit user-initiated sharing channels', () => {
  for (const marker of ['navigator.share','wa.me','t.me\/share\/url','sms:','mailto:']) {
    assert.match(html, new RegExp(marker));
  }
});

test('direct server email/phone sending remains disabled in preview', () => {
  assert.match(html, /Direct server sending.*remains disabled/i);
  assert.match(html, /<input disabled/);
  assert.match(html, /<button disabled>Send invitation<\/button>/);
});

test('Promotion Center repeats the operational authority boundary', () => {
  assert.match(html, /referral credit never approves Merchant, Supplier, Courier, Service Provider or Admin authority/i);
});
