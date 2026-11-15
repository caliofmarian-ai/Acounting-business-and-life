// Refs #815 / #834. Full canonical gateway + real PostgreSQL and password-cookie
// sessions in a disposable CI environment only. No production credentials or
// external provider calls. Late-response cases are explicitly controlled races.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import pg from 'pg';

const revision = process.env.ACCOUNT_ACCESS_BROWSER_REVISION || '';
if (process.env.NODE_ENV !== 'test' || process.env.APP_ENV !== 'test'
  || process.env.PGDATABASE !== 'abl_account_access_browser_ci'
  || process.env.PGHOST !== '127.0.0.1' || process.env.PGPORT !== '5432'
  || process.env.RAILWAY_SERVICE_NAME !== 'accounting-account-access-browser-ci'
  || process.env.DATABASE_URL || process.env.PAYMONGO_LIVE_ENABLED !== 'false'
  || process.env.PAYMONGO_MODE !== 'test' || !/^[a-f0-9]{40}$/i.test(revision)) {
  throw new Error('This acceptance script requires its isolated loopback CI environment and exact revision.');
}
const pool = new pg.Pool();
const connection = await pool.connect();
try {
  assert.equal(connection.connection.stream.remoteAddress, '127.0.0.1');
  assert.equal((await connection.query('SELECT current_database() name')).rows[0].name,
    'abl_account_access_browser_ci');
} finally { connection.release(); }
const { chromium } = await import(process.env.ACCOUNT_ACCESS_BROWSER_MODULE || 'playwright');
const evidence = process.env.ACCOUNT_ACCESS_BROWSER_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'account-access-browser-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'key.pem'),
  '-out', join(temp, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
// Real HTTPS cookies, same-origin requests and CSP, with an edge confined to
// loopback. This is not a policy workaround and is only run in the CI job.
const edge = https.createServer({ key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) }, (req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3000, path: req.url, method: req.method,
    headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
const origin = 'https://127.0.0.1:' + edge.address().port;
const results = [], contexts = [], browserErrors = [];
let browser, actorNumber = 0;
const password = crypto.randomBytes(24).toString('base64url');
const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
const submission = {
  contact_email: 'browser-intake@example.test', name: '<img src=x onerror=window.__intakeXss=1>',
  reason: 'sign_in', message: '<script>window.__intakeXss=1</script> I cannot sign in to the disposable test account.', website: ''
};
const privatePath = '/api/admin/account-access';
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) {
    // Assertion messages contain only synthetic fixture descriptions. Do not
    // print login payloads, cookies, SQL records, passwords or headers.
    results.push({ name, passed: false, error: String(error?.message || 'Check failed').slice(0, 600) });
    console.error('FAIL ' + name + ': ' + String(error?.message || 'Check failed').slice(0, 600));
  }
}
async function context() {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  contexts.push(ctx); return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => browserErrors.push(error.message));
  return page;
}
async function actor(label, role = null) {
  const email = `access-browser-${label}-${++actorNumber}@example.test`;
  const row = await pool.query("INSERT INTO accounts(display_name,email,password_salt,password_hash,auth_status,email_verified_at,active_role) VALUES($1,$2,$3,$4,'active',NOW(),$5) RETURNING id", ['CI access ' + label, email, salt, passwordHash, role]);
  const id = Number(row.rows[0].id);
  if (role) await pool.query("INSERT INTO profiles(account_id,role,enabled,status,visibility) VALUES($1,$2,TRUE,'active','private')", [id, role]);
  const ctx = await context();
  const response = await ctx.request.post(origin + '/api/auth/login', { data: { email, password } });
  assert.equal(response.status(), 200, 'Canonical password login must succeed for the synthetic actor');
  const payload = await response.json(); assert.equal(payload.token, undefined, 'Login must not expose a bearer token');
  const cookies = await ctx.cookies(origin), session = cookies.find(c => c.name === '__Host-abl_session');
  assert.ok(session?.secure && session?.httpOnly, 'Real login must issue the canonical secure HttpOnly session');
  assert.ok(cookies.some(c => c.name === '__Host-abl_csrf' && c.secure), 'Real login must issue CSRF transport');
  return { id, ctx };
}
async function grant(person, country = 'PH') {
  const q = await pool.query("INSERT INTO platform_admin_assignments(account_id,admin_role,authority_rank,country_code,status,assigned_by_account_id,reason) VALUES($1,'territory_admin','specialist',$2,'active',1,'Disposable account-access browser fixture') RETURNING id", [person.id, country]);
  const id = q.rows[0].id;
  await pool.query("INSERT INTO admin_permission_grants(assignment_id,permission_code,status,granted_by_account_id) VALUES($1,'support.manage','active',1)", [id]);
  return id;
}
async function csrf(ctx) { return (await ctx.cookies(origin)).find(c => c.name === '__Host-abl_csrf')?.value || ''; }
async function send(ctx, data = submission, extra = {}) {
  return ctx.request.post(origin + '/api/public/account-access', { data,
    headers: { 'X-Account-Access-Request': '1', Origin: origin }, ...extra });
}
async function fill(page, data = submission) {
  await page.locator('#contact-email').fill(data.contact_email);
  await page.locator('#display-name').fill(data.name);
  await page.locator('#reason').selectOption(data.reason);
  await page.locator('#message').fill(data.message);
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal mobile overflow');
}
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function waitFeedback(page, pattern) {
  await page.waitForFunction(source => new RegExp(source, 'i').test(document.getElementById('feedback')?.textContent || ''), pattern);
}
async function openPrivate(person, id) {
  const page = await newPage(person.ctx);
  const response = await page.goto(origin + '/admin/account-access'); assert.equal(response.status(), 200);
  await page.locator('#queue button').first().waitFor();
  await page.locator('#queue button').filter({ hasText: '#' + id + ' · ' }).click();
  await page.locator('#detail').waitFor({ state: 'visible' }); return page;
}
let requestId, staff;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.ACCOUNT_ACCESS_BROWSER_CHANNEL || 'chrome' });
  console.log('Browser ' + browser.version() + '; exact head ' + revision);
  const guest = await context();
  await check('Exact checkout assets, runtime revision and no-store/CSP headers', async () => {
    const health = await guest.request.get(origin + '/health'); assert.equal(health.status(), 200);
    assert.equal((await health.json()).deployment.revision, revision.slice(0, 12));
    for (const asset of ['public.js', 'staff.js', 'style.css']) {
      const response = await guest.request.get(origin + '/account-access-assets/' + asset);
      assert.equal(response.status(), 200);
      assert.equal(await response.text(), readFileSync(new URL('../public/account-access/' + asset, import.meta.url), 'utf8'), 'Exact served asset: ' + asset);
      assert.match(response.headers()['cache-control'], /no-store/);
      assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
    }
    const page = await newPage(guest); const response = await page.goto(origin + '/help/account-access');
    assert.equal(response.status(), 200); await page.locator('#send:enabled').waitFor(); await noOverflow(page);
    assert.ok((await page.locator('#send').boundingBox()).height >= 44);
    if (evidence) await page.screenshot({ path: join(evidence, 'public-mobile.png'), fullPage: true });
    await page.close();
  });
  await check('Real Help routes expose the account-access form without sign-in', async () => {
    const page = await newPage(guest); await page.goto(origin + '/help');
    const entry = page.locator('a[href*="/help/account-access"]').first(); await entry.waitFor();
    // Only canonical same-origin destinations are followed in this disposable test.
    const href = await entry.getAttribute('href');
    assert.equal(new URL(href, origin).origin, origin, 'Gateway Help must retain its own environment');
    await entry.click(); await page.waitForURL('**/help/account-access**');
    await page.locator('#send:enabled').waitFor(); await page.close();
  });
  await check('Native validation and language switching preserve input without creating a request', async () => {
    const page = await newPage(guest); await page.goto(origin + '/help/account-access');
    await page.locator('#send:enabled').waitFor(); let posts = 0;
    page.on('request', r => { if (r.method() === 'POST') posts++; });
    await page.locator('#send').click(); await settled(page); assert.equal(posts, 0);
    await page.locator('#contact-email').fill('preserved@example.test');
    await page.locator('#language').selectOption('fil-PH');
    assert.equal(await page.locator('html').getAttribute('lang'), 'fil-PH');
    assert.match(await page.locator('h1').textContent(), /Hindi/);
    assert.equal(await page.locator('#contact-email').inputValue(), 'preserved@example.test');
    await noOverflow(page); await page.close();
  });
  await check('Expired-cookie visitor saves through real gateway; browser request omits credentials', async () => {
    const ctx = await context();
    await ctx.addCookies([{ name: '__Host-abl_session', value: 'invalid-expired-test-session', url: origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    const page = await newPage(ctx); await page.goto(origin + '/help/account-access'); await fill(page);
    const responsePromise = page.waitForResponse(r => r.url() === origin + '/api/public/account-access' && r.request().method() === 'POST');
    await page.locator('#send').click(); const response = await responsePromise;
    assert.equal(response.status(), 202); assert.equal((await response.json()).ok, true);
    const headers = await response.request().allHeaders();
    assert.equal(Boolean(headers.cookie || headers.authorization), false, 'Public browser request must not attach credentials');
    await waitFeedback(page, 'saved');
    assert.equal(await page.locator('#message').inputValue(), '');
    assert.equal(await page.locator('#contact-email').inputValue(), '');
    const rows = await pool.query('SELECT id FROM guest_account_access_requests WHERE contact_email=$1', [submission.contact_email]);
    assert.equal(rows.rowCount, 1); requestId = String(rows.rows[0].id);
    assert.equal((await pool.query('SELECT id FROM accounts WHERE email=$1', [submission.contact_email])).rowCount, 0, 'Intake must not create or look up an account authority');
    await page.close();
  });
  await check('Duplicate request has generic response; stored row remains unique', async () => {
    const response = await send(guest); assert.equal(response.status(), 202);
    const body = await response.json(); assert.equal(body.ok, true);
    assert.equal(body.id, undefined); assert.equal(body.account_exists, undefined);
    assert.equal((await pool.query('SELECT id FROM guest_account_access_requests WHERE contact_email=$1', [submission.contact_email])).rowCount, 1);
  });
  await check('Real storage outage returns failure and preserves browser form text', async () => {
    const page = await newPage(guest); await page.goto(origin + '/help/account-access');
    const data = { ...submission, contact_email: 'storage-failure@example.test', message: 'Synthetic storage failure acceptance; no real personal details.' }; await fill(page, data);
    await pool.query('ALTER TABLE guest_account_access_requests RENAME TO guest_account_access_requests_ci_unavailable');
    try {
      const pending = page.waitForResponse(r => r.url() === origin + '/api/public/account-access');
      await page.locator('#send').click(); const response = await pending; assert.equal(response.status(), 503);
      assert.doesNotMatch(await response.text(), /relation|SELECT|INSERT|storage-failure@example/i);
      await waitFeedback(page, 'could not|try again'); assert.equal(await page.locator('#message').inputValue(), data.message);
    } finally { await pool.query('ALTER TABLE guest_account_access_requests_ci_unavailable RENAME TO guest_account_access_requests'); await page.close(); }
  });
  await check('Real per-contact limit displays a failure without losing input', async () => {
    const data = { ...submission, contact_email: 'rate-test@example.test' };
    for (let i = 0; i < 3; i++) assert.equal((await send(guest, data)).status(), 202);
    const page = await newPage(guest); await page.goto(origin + '/help/account-access'); await fill(page, data);
    const pending = page.waitForResponse(r => r.url() === origin + '/api/public/account-access');
    await page.locator('#send').click(); const response = await pending;
    assert.equal(response.status(), 429); assert.ok(Number(response.headers()['retry-after']) > 0);
    await waitFeedback(page, 'too many'); assert.equal(await page.locator('#message').inputValue(), data.message); await page.close();
  });
  await check('Unauthenticated private page/list/detail and ordinary profiles are denied', async () => {
    for (const path of ['/admin/account-access', privatePath, privatePath + '/' + requestId]) {
      assert.equal((await guest.request.get(origin + path)).status(), 401);
    }
    for (const role of ['customer', 'merchant', 'supplier', 'courier', 'service_provider']) {
      const person = await actor(role, role);
      for (const path of [privatePath, privatePath + '/' + requestId]) {
        const response = await person.ctx.request.get(origin + path); assert.equal(response.status(), 403);
        assert.doesNotMatch(await response.text(), /browser-intake|__intakeXss|staff_note/);
      }
    }
  });
  await check('Real delegated support login reads audited private text without executing markup', async () => {
    staff = await actor('support'); staff.assignment = await grant(staff);
    const list = await staff.ctx.request.get(origin + privatePath); assert.equal(list.status(), 200);
    const listBody = await list.json(); assert.ok(listBody.items.length > 0);
    assert.doesNotMatch(JSON.stringify(listBody), /contact_email|staff_note|display_name|browser-intake/);
    const page = await openPrivate(staff, requestId);
    assert.equal(await page.locator('#case-email').textContent(), submission.contact_email);
    assert.equal(await page.locator('#case-message').textContent(), submission.message);
    assert.equal(await page.locator('#case-name').textContent(), submission.name);
    assert.equal(await page.locator('#detail script, #detail img').count(), 0);
    assert.equal(await page.evaluate(() => window.__intakeXss), undefined);
    await noOverflow(page);
    if (evidence) await page.screenshot({ path: join(evidence, 'staff-mobile.png'), fullPage: true });
    const audit = await pool.query("SELECT before_json,after_json FROM admin_audit_events WHERE actor_account_id=$1 AND target_type='guest_account_access' AND event_code='account_access_request_read'", [staff.id]);
    assert.ok(audit.rowCount > 0); assert.doesNotMatch(JSON.stringify(audit.rows), /browser-intake|__intakeXss/);
    await page.close();
  });
  await check('Staff triage uses actual CSRF session and revision; no account/recovery side effects', async () => {
    const page = await openPrivate(staff, requestId);
    const before = (await pool.query('SELECT status,revision FROM guest_account_access_requests WHERE id=$1', [requestId])).rows[0];
    const accountCount = (await pool.query('SELECT COUNT(*)::int n FROM accounts')).rows[0].n;
    await page.locator('#case-status').selectOption('reviewing'); await page.locator('#case-note').fill('Synthetic private review note, not a reply.');
    const pending = page.waitForResponse(r => r.url().endsWith('/' + requestId + '/triage'));
    await page.locator('#save').click(); const response = await pending; assert.equal(response.status(), 200);
    assert.ok((await response.request().allHeaders())['x-csrf-token']);
    await waitFeedback(page, 'saved'); assert.match(await page.locator('#feedback').textContent(), /No email.*no account access/i);
    const row = (await pool.query('SELECT status,revision,staff_note FROM guest_account_access_requests WHERE id=$1', [requestId])).rows[0];
    assert.equal(row.status, 'reviewing'); assert.equal(row.revision, Number(before.revision) + 1);
    assert.equal(row.staff_note, 'Synthetic private review note, not a reply.');
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM accounts')).rows[0].n, accountCount);
    const denied = await staff.ctx.request.post(origin + privatePath + '/' + requestId + '/triage', { data: { status: 'closed', revision: row.revision, note: '' } });
    assert.equal(denied.status(), 403, 'Cookie-authenticated mutation without CSRF must fail');
    const conflict = await staff.ctx.request.post(origin + privatePath + '/' + requestId + '/triage', { headers: { 'X-CSRF-Token': await csrf(staff.ctx) }, data: { status: 'closed', revision: before.revision, note: '' } });
    assert.equal(conflict.status(), 409); await page.close();
  });
  await check('Foreign-country support is denied and revoked current grant clears browser evidence', async () => {
    const foreign = await actor('foreign'); await grant(foreign, 'US');
    assert.equal((await foreign.ctx.request.get(origin + privatePath)).status(), 403);
    const page = await newPage(staff.ctx); await page.goto(origin + '/admin/account-access');
    await page.locator('#filter').selectOption('all');
    await page.locator('#queue button').filter({ hasText: '#' + requestId + ' · ' }).waitFor();
    await page.locator('#queue button').filter({ hasText: '#' + requestId + ' · ' }).click();
    await page.locator('#detail').waitFor({ state: 'visible' });
    await pool.query("UPDATE admin_permission_grants SET status='revoked' WHERE assignment_id=$1 AND permission_code='support.manage'", [staff.assignment]);
    try {
      const pending = page.waitForResponse(r => r.url().includes(privatePath) && r.status() === 403);
      await page.locator('#refresh').click(); await pending; await settled(page);
      assert.equal(await page.locator('#case-message').textContent(), '');
      assert.equal(await page.locator('#case-note').inputValue(), '');
      assert.equal(await page.locator('#detail').isVisible(), false);
    } finally { await pool.query("UPDATE admin_permission_grants SET status='active' WHERE assignment_id=$1 AND permission_code='support.manage'", [staff.assignment]); await page.close(); }
  });
  await check('Controlled delayed private response is discarded after a real session switch', async () => {
    const first = await actor('race-one'); await grant(first);
    const second = await actor('race-two'); await grant(second);
    const page = await newPage(first.ctx); await page.goto(origin + '/admin/account-access');
    await page.locator('#filter').selectOption('all');
    await page.locator('#queue button').filter({ hasText: '#' + requestId + ' · ' }).waitFor();
    let received, release; const ready = new Promise(resolve => { received = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    await page.route(origin + privatePath + '/' + requestId, async route => {
      const response = await route.fetch(); assert.equal(response.status(), 200);
      received(); await held; await route.fulfill({ response });
    });
    try {
      await page.locator('#queue button').filter({ hasText: '#' + requestId + ' · ' }).click();
      await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Controlled private response was not received')), 8000))]);
      await first.ctx.clearCookies(); await first.ctx.addCookies(await second.ctx.cookies(origin));
      const complete = page.waitForResponse(r => r.url() === origin + privatePath + '/' + requestId);
      release(); await complete; await settled(page);
      assert.equal(await page.locator('#case-message').textContent(), '', 'Late data from the previous signed-in account must not enter the new session DOM');
      assert.equal(await page.locator('#detail').isVisible(), false);
    } finally { release(); await page.close(); }
  });
  await check('No uncaught browser JavaScript errors in tested real gateway journeys', async () => { assert.deepEqual(browserErrors, []); });
} finally {
  const output = { revision, scope: 'Disposable real PostgreSQL/full HTTPS gateway/password-cookie browser acceptance; controlled network delay for the session-race check. Not deployed Preview or Production.', browser: browser?.version() || null, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, checks: results };
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(output, null, 2) + '\n');
  for (const ctx of contexts) await ctx.close().catch(() => {});
  if (browser) await browser.close();
  await new Promise(resolve => edge.close(resolve)); await pool.end(); rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ revision, passed: output.passed, failed: output.failed }));
}
assert.equal(results.filter(r => !r.passed).length, 0, 'All independent account-access browser checks must pass; see the bounded synthetic result artifact.');
