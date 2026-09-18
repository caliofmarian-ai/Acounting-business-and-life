import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../marketing-kit/template-manifest.json', import.meta.url), 'utf8'));
const copy = JSON.parse(readFileSync(new URL('../marketing-kit/copy.en-PH.json', import.meta.url), 'utf8'));

test('marketing kit has stable unique template ids and positive dimensions', () => {
  const ids = manifest.templates.map(template => template.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const template of manifest.templates) {
    assert.ok(template.width > 0);
    assert.ok(template.height > 0);
    assert.match(template.figmaNodeId, /^\d+:\d+$/);
  }
});

test('all current masters require QR and referral fallback code', () => {
  for (const template of manifest.templates) {
    assert.ok(template.requiredFields.includes('QR_ASSET'));
    assert.ok(template.requiredFields.includes('REFERRAL_CODE'));
  }
});

test('marketing assets cannot grant operational or admin authority', () => {
  assert.equal(manifest.governance.referralGrantsOperationalProfiles, false);
  assert.equal(manifest.governance.referralGrantsAdminPermissions, false);
});

test('qr contract explicitly prohibits PII', () => {
  assert.equal(manifest.qrRules.noEmbeddedPii, true);
  assert.equal(manifest.qrRules.payload, 'Canonical referral URL only');
});

test('public copy includes claim guardrails', () => {
  assert.ok(copy.prohibitedClaims.includes('Automatic business approval'));
  assert.ok(copy.prohibitedClaims.includes('Guaranteed tax compliance'));
  assert.match(copy.reusable.governanceNote, /never bypasses operational profile approval/i);
});
