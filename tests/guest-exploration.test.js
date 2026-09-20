import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server-marketplace.js', import.meta.url), 'utf8');
const guest = readFileSync(new URL('../public/guest-explore.js', import.meta.url), 'utf8');
const help = readFileSync(new URL('../public/help-linking.js', import.meta.url), 'utf8');
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


test('mobile guest entry is independent from hidden legacy auth choices', () => {
  assert.match(guest, /guestExploreEntrySlot/);
  assert.doesNotMatch(guest, /const choices = document\.getElementById\('accountAuthChoices'\)/);
  assert.match(guest, /modernAuthRoot/);
});

test('guest mode clears stale sign-in errors and isolates the underlying entry screen',()=>{
  assert.match(guest,/abl:clear-context-help/);
  assert.match(help,/addEventListener\('abl:clear-context-help'/);
  assert.match(guest,/login\.setAttribute\('inert',''\)/);
  assert.match(guest,/login\.setAttribute\('aria-hidden','true'\)/);
  assert.match(guest,/login\.removeAttribute\('inert'\)/);
  assert.match(guest,/guestRoot\.querySelector\('#guestClose'\)\?\.focus\(\)/);
});

test('modern authentication renders before hardening status network request completes', () => {
  const authUi = readFileSync(new URL('../public/auth-hardening-ui.js', import.meta.url), 'utf8');
  const panelAt = authUi.indexOf('if(root)panel()');
  const fetchAt = authUi.indexOf("fetch('/api/auth/hardening/status')");
  assert.ok(panelAt >= 0 && fetchAt > panelAt, 'auth panel must render before network hardening status fetch');
  assert.match(authUi, /must never leave the entry screen blank/i);
});

test('mobile auth CSS keeps entry controls above the fold', () => {
  const css = readFileSync(new URL('../public/auth-hardening.css', import.meta.url), 'utf8');
  assert.match(css, /#login\.centered\{align-content:start/);
});


test('public login never exposes owner bootstrap upgrade controls or lifecycle state', () => {
  const authUi = readFileSync(new URL('../public/auth-hardening-ui.js', import.meta.url), 'utf8');
  const authServer = readFileSync(new URL('../server-auth-hardening.js', import.meta.url), 'utf8');
  assert.doesNotMatch(authUi, /One-time owner security upgrade/i);
  assert.doesNotMatch(authUi, /ownerSetupBtn|renderOwnerUpgrade|owner_migration_required/);
  const statusStart = authServer.indexOf("app.get('/api/auth/hardening/status'");
  const statusEnd = authServer.indexOf("app.post('/api/auth/forgot-password'", statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.doesNotMatch(authServer.slice(statusStart, statusEnd), /owner_migration_required|ownerMigrationRequired/);
});

test('owner migration endpoint is infrastructure-gated and disabled by default', () => {
  const authServer = readFileSync(new URL('../server-auth-hardening.js', import.meta.url), 'utf8');
  assert.match(authServer, /OWNER_MIGRATION_ENABLED = process\.env\.OWNER_MIGRATION_ENABLED === 'true'/);
  const routeStart = authServer.indexOf("app.post('/api/auth/owner-migrate'");
  const routeEnd = authServer.indexOf("app.post('/api/auth/sessions/revoke-others'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = authServer.slice(routeStart, routeEnd);
  assert.match(route, /if \(!OWNER_MIGRATION_ENABLED\) return res\.status\(404\)/);
});
