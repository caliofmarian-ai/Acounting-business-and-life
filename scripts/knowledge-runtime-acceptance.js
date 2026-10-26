// Full-gateway acceptance against a disposable local CI database only. Uses
// canonical password login, HttpOnly cookies, CSRF and actual MFA enrollment.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import { loadControlledDocuments } from '../documentation-catalog.js';
import { base32Decode, decryptMfaSecret } from '../super-admin-mfa-core.js';

if (process.env.NODE_ENV !== 'test' || process.env.APP_ENV !== 'test'
    || process.env.PGDATABASE !== 'abl_knowledge_ci' || process.env.PGHOST !== '127.0.0.1'
    || process.env.RAILWAY_SERVICE_NAME !== 'accounting-knowledge-ci' || process.env.DATABASE_URL
    || process.env.PAYMONGO_LIVE_ENABLED !== 'false') {
  throw new Error('Knowledge gateway acceptance requires its disposable local CI environment.');
}
const pool = new pg.Pool();
const check = await pool.query('SELECT current_database() name,inet_server_addr() host');
assert.equal(check.rows[0].name, 'abl_knowledge_ci'); assert.equal(check.rows[0].host, '127.0.0.1');
const { chromium } = await import(process.env.KNOWLEDGE_BROWSER_MODULE || 'playwright');
const evidence = process.env.KNOWLEDGE_BROWSER_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'knowledge-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'key.pem'),
  '-out', join(temp, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
// Same HTTPS termination pattern as the deployment edge, confined to loopback.
const edge = https.createServer({ key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) }, (req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3000, path: req.url, method: req.method,
    headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
});
await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
const origin = 'https://127.0.0.1:' + edge.address().port;
const source = loadControlledDocuments(), checks = [], pages = [];
const businessDoc = source.find(d => d.access_class === 'BUSINESS_PRIVATE' && !(d.applicable_profiles || []).length);
const executive = source.find(d => d.access_class === 'EXECUTIVE_CONFIDENTIAL');
const countryDoc = source.find(d => d.access_class === 'COUNTRY_ADMIN');
const territoryDoc = source.find(d => d.access_class === 'TERRITORY_ADMIN');
const supportDoc = source.find(d => d.access_class === 'OPERATIONS_PRIVATE' && (d.applicable_functions || []).includes('Support Agent'));
assert.ok(businessDoc && executive && countryDoc && territoryDoc && supportDoc);
let browser;
const password = crypto.randomBytes(24).toString('base64url');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
async function actor(label, role = null, owner = false) {
  const email = 'knowledge-ci-' + label + '@example.test';
  let id;
  if (owner) {
    await pool.query("UPDATE accounts SET display_name='CI Knowledge Owner',email=$1,password_salt=$2,password_hash=$3,auth_status='active',email_verified_at=NOW() WHERE id=1", [email, salt, hash]); id = 1;
  } else {
    const q = await pool.query("INSERT INTO accounts(display_name,email,password_salt,password_hash,auth_status,email_verified_at,active_role) VALUES($1,$2,$3,$4,'active',NOW(),$5) RETURNING id", ['CI Knowledge ' + label, email, salt, hash, role]);
    id = Number(q.rows[0].id);
  }
  if (role) await pool.query("INSERT INTO profiles(account_id,role,enabled,status,visibility) VALUES($1,$2,TRUE,'active','private') ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active'", [id, role]);
  if (['merchant', 'supplier'].includes(role)) {
    const b = await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id", ['CI Knowledge ' + role]);
    await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)", [b.rows[0].id, id]);
  }
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const login = await context.request.post(origin + '/api/auth/login', { data: { email, password } });
  assert.equal(login.status(), 200, 'Canonical password login for ' + label);
  const payload = await login.json(); assert.equal(payload.token, undefined, 'Browser login must not return a bearer token');
  const cookies = await context.cookies(origin), session = cookies.find(c => c.name === '__Host-abl_session');
  assert.ok(session?.secure && session?.httpOnly, 'Canonical HttpOnly secure session cookie');
  return { id, context, role, label };
}
async function request(actor, path, { status = 200, data, method = 'GET' } = {}) {
  const cookies = await actor.context.cookies(origin);
  const csrf = cookies.find(c => c.name === '__Host-abl_csrf')?.value;
  const response = await actor.context.request.fetch(origin + path, { method, data,
    headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
  assert.equal(response.status(), status, path + ' expected status for ' + actor.label);
  if (path.startsWith('/api/knowledge')) assert.match(response.headers()['cache-control'], /no-store/);
  return response.json();
}
const document = (actor, doc, status = 200) => request(actor, '/api/knowledge/documents/' + doc.id, { status });
async function rank(actor, value, permission = null) {
  const q = await pool.query("INSERT INTO platform_admin_assignments(account_id,admin_role,authority_rank,country_code,status,assigned_by_account_id,reason) VALUES($1,$2,$3,'PH','active',1,'Disposable Knowledge CI fixture') RETURNING id",
    [actor.id, value === 'specialist' ? 'territory_admin' : value, value]);
  if (permission) await pool.query("INSERT INTO admin_permission_grants(assignment_id,permission_code,status,granted_by_account_id) VALUES($1,$2,'active',1)", [q.rows[0].id, permission]);
  return q.rows[0].id;
}
function totp(secret) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function enroll(actor) {
  await request(actor, '/api/auth/mfa/enroll/start', { method: 'POST', data: {} });
  // Read this disposable CI factor to emulate the authenticator. No factor,
  // OTP, password, cookie or recovery code is printed or saved as evidence.
  const q = await pool.query("SELECT secret_ciphertext FROM super_admin_mfa_factors WHERE account_id=$1 AND status='pending'", [actor.id]);
  const secret = decryptMfaSecret(q.rows[0].secret_ciphertext, process.env.SUPER_ADMIN_MFA_ENCRYPTION_KEY);
  const confirmed = await request(actor, '/api/auth/mfa/enroll/confirm', { method: 'POST', data: { code: totp(secret) } });
  assert.equal(confirmed.session_verified, true);
}
async function browserRead(actor, doc) {
  const page = await actor.context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/knowledge?document=' + doc.id);
  await page.waitForSelector('.document-body');
  assert.equal(await page.locator('.document-head h2').textContent(), doc.title);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  if (evidence) await page.screenshot({ path: join(evidence, actor.label + '.png') });
  pages.push(page);
}
try {
  browser = await chromium.launch({ headless: true });
  const guest = await browser.newContext({ ignoreHTTPSErrors: true });
  const anon = await guest.request.get(origin + '/api/knowledge/catalog'); assert.equal(anon.status(), 401);
  assert.doesNotMatch(await anon.text(), /document_count|EXECUTIVE_CONFIDENTIAL/); await guest.close();
  checks.push('Anonymous private catalog denied through the full HTTPS gateway');
  for (const role of ['customer', 'merchant', 'supplier', 'courier', 'service_provider']) {
    const a = await actor(role, role), own = source.find(d => d.document_type === 'profile_playbook' && d.applicable_profiles.includes(role));
    assert.ok(own); const catalog = await request(a, '/api/knowledge/catalog');
    assert.ok(catalog.documents.some(d => d.id === own.id));
    assert.equal(catalog.documents.some(d => d.access_class === 'EXECUTIVE_CONFIDENTIAL'), false);
    assert.equal(catalog.access.business_guidance, ['merchant', 'supplier'].includes(role));
    const content = await document(a, own); assert.equal(typeof content.markdown, 'string');
    assert.equal(content.relative_path, undefined); await document(a, executive, 404);
    await browserRead(a, own);
    const audits = await pool.query("SELECT after_json FROM admin_audit_events WHERE actor_account_id=$1 AND target_id=$2 AND event_code='knowledge_document_read'", [a.id, own.id]);
    assert.ok(audits.rowCount >= 2); assert.equal(audits.rows[0].after_json.version, own.version);
    await pool.query('UPDATE profiles SET enabled=FALSE,status=\'disabled\' WHERE account_id=$1 AND role=$2', [a.id, role]);
    await document(a, own, 404);
    await pool.query("UPDATE profiles SET enabled=TRUE,status='active' WHERE account_id=$1 AND role=$2", [a.id, role]);
    if (['merchant', 'supplier'].includes(role)) {
      await document(a, businessDoc);
      await pool.query('UPDATE business_memberships SET active=FALSE WHERE account_id=$1', [a.id]); await document(a, businessDoc, 404);
      await pool.query('UPDATE business_memberships SET active=TRUE WHERE account_id=$1', [a.id]);
    }
    checks.push(role + ': real login/cookies, correct catalog/read/browser/audit and immediate revocation');
    await a.context.close();
  }
  const country = await actor('country-admin'); await rank(country, 'country_admin');
  await document(country, countryDoc); await document(country, executive, 404); await country.context.close();
  const territory = await actor('territory-admin'); const tid = await rank(territory, 'territory_admin');
  await document(territory, territoryDoc); await document(territory, countryDoc, 404);
  await pool.query("UPDATE platform_admin_assignments SET status='revoked' WHERE id=$1", [tid]); await document(territory, territoryDoc, 404); await territory.context.close();
  const specialist = await actor('support-specialist'); await rank(specialist, 'specialist', 'support.manage');
  await document(specialist, supportDoc); await document(specialist, territoryDoc, 404); await specialist.context.close();
  checks.push('Real Country/Territory/Specialist assignments, permission and revocation boundaries');
  const owner = await actor('owner', null, true);
  const before = await request(owner, '/api/knowledge/catalog'); assert.equal(before.access.admin_locked, true); await document(owner, executive, 404);
  await enroll(owner);
  const after = await request(owner, '/api/knowledge/catalog'); assert.equal(after.access.admin_locked, false);
  assert.ok(after.documents.some(d => d.id === executive.id)); await browserRead(owner, executive);
  await request(owner, '/api/auth/logout', { method: 'POST', data: {} }); await request(owner, '/api/knowledge/catalog', { status: 401 }); await owner.context.close();
  checks.push('Owner password alone cannot read executive content; real TOTP enrollment unlocks it; logout revokes access');
  const peer = await actor('other-super-admin'); await rank(peer, 'super_admin'); await enroll(peer);
  const peerCatalog = await request(peer, '/api/knowledge/catalog'); assert.equal(peerCatalog.access.admin_locked, false);
  assert.equal(peerCatalog.documents.some(d => d.id === executive.id), false); await document(peer, executive, 404); await peer.context.close();
  checks.push('Another MFA-verified Super Admin still cannot read Owner-only executive content');
  const result = { status: 'PASS', revision: process.env.KNOWLEDGE_BROWSER_REVISION || null, checks,
    scope: 'Full canonical gateway and PostgreSQL; disposable local CI actors, real password/cookie/CSRF/MFA flows. No physical-device or Production acceptance claim.' };
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close(); edge.closeAllConnections(); await new Promise(resolve => edge.close(resolve));
  await pool.end(); rmSync(temp, { recursive: true, force: true });
}
