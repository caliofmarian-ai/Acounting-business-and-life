import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server-marketplace.js', import.meta.url), 'utf8');
const guest = readFileSync(new URL('../public/guest-explore.js', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../docs/architecture/GUEST_EXPLORATION_AND_ONBOARDING.md', import.meta.url), 'utf8');

test('guest marketplace uses separate public read-only routes', () => {
  assert.match(server, /app\.get\('\/api\/public\/marketplace\/storefronts'/);
  assert.match(server, /app\.get\('\/api\/public\/marketplace\/storefronts\/:businessId'/);
  assert.doesNotMatch(server, /app\.(?:post|put|patch|delete)\('\/api\/public\//);
});

test('public guest projection is allow-listed and never exposes internal product rows', () => {
  const start = server.indexOf('async function guestPublicProducts');
  const end = server.indexOf('async function importLegacyProducts');
  assert.ok(start >= 0 && end > start, 'guest public product projection must exist');
  const publicProjection = server.slice(start, end);
  assert.doesNotMatch(publicProjection, /SELECT\s+\*/i);
  for (const privateField of ['legacy_product_id','stock_tracked','stock_quantity','price_comparison_override','created_at','updated_at']) {
    assert.ok(!publicProjection.includes(privateField), 'public product projection must omit '+privateField);
  }
  assert.match(publicProjection, /published=TRUE AND active=TRUE/);
});

test('guest client cannot checkout or read private financial/admin APIs', () => {
  assert.match(guest, /\/api\/public\/marketplace\/storefronts/);
  for (const forbidden of ['/api/marketplace/checkout','/api/summary','/api/transactions','/api/admin','/api/payments']) {
    assert.ok(!guest.includes(forbidden), 'guest client must not call '+forbidden);
  }
  assert.match(guest, /Guest mode · public information only/);
  assert.match(guest, /private by default, public by explicit choice/i);
});

test('guest remains an experience layer, not an identity or business entity', () => {
  assert.match(architecture, /Guest is a browser\/session experience state only/);
  assert.match(architecture, /Guest -> Registered User -> Email Verified -> Activated Profile/);
  assert.match(architecture, /Server-side authorization\/privacy always wins/);
});
