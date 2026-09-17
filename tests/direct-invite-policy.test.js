import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const p = JSON.parse(readFileSync(new URL('../growth/direct-invite-policy.json', import.meta.url), 'utf8'));

test('email and SMS direct invites are single-recipient and do not import address books', () => {
  for (const key of ['email','sms']) {
    assert.equal(p.modes[key].recipientEntry, 'single_recipient_manual_entry');
    assert.equal(p.modes[key].bulkUpload, false);
    assert.equal(p.modes[key].addressBookImport, false);
  }
});

test('WhatsApp Telegram and groups remain user initiated', () => {
  assert.match(p.modes.whatsapp.mechanism, /user_initiated/);
  assert.match(p.modes.telegram.mechanism, /share/);
  assert.equal(p.modes.group.automaticPosting, false);
});

test('direct server sending is blocked until providers policy and abuse controls exist', () => {
  assert.equal(p.productionGates.emailProviderConfigured, false);
  assert.equal(p.productionGates.smsProviderConfigured, false);
  assert.equal(p.productionGates.rateLimitConfigured, false);
  assert.equal(p.productionGates.abuseMonitoringConfigured, false);
});

test('direct invitation cannot become privileged profile authorization', () => {
  assert.ok(p.requiredServerControls.includes('no privileged profile activation side effect'));
  assert.match(p.uiRules.authorityNotice, /does not approve restricted operational profiles/i);
});
