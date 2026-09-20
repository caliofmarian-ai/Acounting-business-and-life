import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync(new URL('../legal-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-legal.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/legal-ui.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin-authorization.js',import.meta.url),'utf8');
const notifications=readFileSync(new URL('../notification-core.js',import.meta.url),'utf8');

test('legal documents use versioned content hashes and event history instead of blanket booleans',()=>{
  for(const table of ['legal_documents','legal_document_versions','legal_requirements','legal_acceptances','legal_document_events']){
    assert.ok(core.includes('CREATE TABLE IF NOT EXISTS '+table),table+' must exist');
  }
  assert.match(core,/content_sha256/);
  assert.match(core,/version_label/);
  assert.doesNotMatch(core,/terms_accepted\s+BOOLEAN/i);
});

test('repository agreements are seeded only as controlled drafts pending legal review',()=>{
  assert.match(core,/repo-draft-/);
  assert.match(core,/'draft',TRUE,'not_applicable','pending'/);
  for(const file of ['PLATFORM_TERMS_FRAMEWORK.md','PRIVACY_NOTICE_FRAMEWORK.md','MERCHANT_AGREEMENT.md','SUPPLIER_AGREEMENT.md','COURIER_AGREEMENT.md','SERVICE_PROVIDER_AGREEMENT.md']){
    assert.ok(core.includes(file),file+' must be a controlled source draft');
  }
});

test('activation cannot bypass real legal and translation review metadata',()=>{
  assert.match(core,/Legal review approval is required before activation/);
  assert.match(core,/Reviewed translation is required before translated legal copy can be activated/);
  assert.match(core,/legal_review_reference/);
  assert.match(core,/legal_review_status!=='reviewed'/);
  assert.match(ui,/Do not record/);
  assert.match(ui,/real legal review reference/i);
});

test('active legal copy is selected only from reviewed versions with authoritative fallback',()=>{
  assert.match(core,/v\.status='active'/);
  assert.match(core,/v\.legal_review_status='reviewed'/);
  assert.match(core,/v\.authoritative=TRUE OR v\.translation_review_status='reviewed'/);
  assert.match(core,/fallback_locale/);
});

test('acceptance records exact version hash and minimized request metadata',()=>{
  assert.match(core,/content_sha256 TEXT NOT NULL/);
  assert.match(core,/ip_hash TEXT NOT NULL DEFAULT/);
  assert.match(core,/device_hash TEXT NOT NULL DEFAULT/);
  assert.match(core,/createHmac\('sha256'/);
  assert.match(core,/Document changed\. Reload the current version before accepting/);
  assert.doesNotMatch(core,/ip_address TEXT/i);
});

test('role and action requirements are separated rather than using one blanket consent',()=>{
  for(const marker of [
    "action:'order.create',role:'customer'",
    "action:'profile.submit',role:'merchant'",
    "action:'profile.submit',role:'supplier'",
    "action:'profile.submit',role:'courier'",
    "action:'profile.submit',role:'service_provider'",
    "action:'admin.access',role:'admin'",
    "action:'location.share',role:'customer'",
    "action:'marketing.opt_in',role:'*'"
  ]) assert.ok(core.includes(marker),marker+' requirement is missing');
});

test('no reviewed active document means review pending instead of fabricated acceptance',()=>{
  assert.match(core,/reviewPending\.push/);
  assert.match(core,/No legally reviewed active version is published/);
  assert.match(server,/review_pending/);
  assert.match(server,/No active legally-reviewed version/);
});

test('protected commerce location profile and Admin actions use the dedicated legal gate',()=>{
  assert.match(server,/LEGAL_ACCEPTANCE_REQUIRED/);
  assert.ok(server.includes("app.post('/api/orders'"));
  assert.ok(server.includes("app.post('/api/marketplace/checkout'"));
  assert.ok(server.includes("app.post('/api/governance/applications/:id/submit'"));
  assert.ok(server.includes("app.post('/api/delivery/quote'"));
  assert.ok(server.includes("app.post('/api/courier/deliveries/:id/location'"));
  assert.ok(server.includes("app.use('/api/admin'"));
});

test('optional consent withdrawal is distinct from historical acknowledgements',()=>{
  assert.match(core,/withdrawable BOOLEAN/);
  assert.match(core,/state IN \('accepted','declined','withdrawn'\)/);
  assert.match(core,/cannot be withdrawn through optional-consent settings/);
});

test('legal governance is scoped through explicit Admin permissions and activation is audited',()=>{
  assert.match(admin,/'legal\.view'/);
  assert.match(admin,/'legal\.manage'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'legal\.manage'/);
  assert.match(server,/appendAdminAudit/);
  assert.match(core,/legal_version_activated/);
});

test('activating reviewed versions queues re-consent without auto-accepting users',()=>{
  assert.match(server,/legal\.reconsent_required/);
  assert.match(notifications,/legal\.reconsent_required/);
  assert.match(server,/mandatory:true/);
});

test('Legal Center exposes exact hash history and controlled Admin review workflow',()=>{
  assert.match(ui,/Legal & Privacy Center/);
  assert.match(ui,/SHA-256/);
  assert.match(ui,/api\/legal\/history/);
  assert.match(ui,/Record completed legal review/);
  assert.match(ui,/Activate reviewed version/);
});
