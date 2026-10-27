// Real full-gateway/browser acceptance on a disposable loopback CI database.
// No deployed credentials, request interception, authentication bypass or sends.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const env = process.env;
const hostname = 'promotion.example.test';
const revision = env.PROMOTION_EXPECTED_SHA;
if (env.NODE_ENV !== 'test' || env.APP_ENV !== 'test'
    || env.PGHOST !== '127.0.0.1' || env.PGDATABASE !== 'abl_promotion_ci'
    || env.RAILWAY_SERVICE_NAME !== 'accounting-promotion-ci' || env.DATABASE_URL
    || env.PORT !== '3000' || env.QA_ACCEPTANCE_WAVE || env.CONTROLLED_ROLE_FIXTURE_WAVE
    || env.PAYMONGO_LIVE_ENABLED !== 'false' || env.PAYMONGO_MODE !== 'test'
    || env.OWNER_MIGRATION_ENABLED === 'true' || env.QA_REMOTE_TEST_EMAIL || env.QA_PH_TEST_CONTEXT
    || env.REFERRAL_PUBLIC_ORIGIN || env.PUBLIC_APP_ORIGIN || env.RAILWAY_PUBLIC_DOMAIN
    || !/^[a-f0-9]{40}$/.test(revision || '') || env.RAILWAY_GIT_COMMIT_SHA !== revision
    || String(env.TOKEN_SECRET || '').length < 32
    || ['REFERRAL_ANALYTICS_ENABLED', 'REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED', 'REFERRAL_ATTRIBUTION_CONVERTED_ENABLED'].some(key => env[key] !== 'false')
    || ['POSTHOG_PROJECT_TOKEN', 'RESEND_API_KEY', 'PAYMONGO_SECRET_KEY', 'OPENAI_API_KEY'].some(key => env[key])) {
  throw new Error('Promotion acceptance requires its exact-head disposable loopback CI environment with provider and QA gates off.');
}
const addresses = await lookup(hostname, { all: true });
assert.ok(addresses.length && addresses.every(item => item.address === '127.0.0.1'), 'Reserved test hostname must resolve only to loopback');
const pool = new pg.Pool();
const connection = await pool.connect();
try {
  assert.equal(connection.connection.stream.remoteAddress, '127.0.0.1');
  assert.equal((await connection.query('SELECT current_database() AS name')).rows[0].name, 'abl_promotion_ci');
} finally { connection.release(); }
const { chromium } = await import(env.PROMOTION_PLAYWRIGHT_MODULE || 'playwright');
assert.ok(env.PROMOTION_QR_SCRIPT && env.PROMOTION_EVIDENCE_DIR, 'Temporary CI decoder and evidence paths are required');
const evidence = env.PROMOTION_EVIDENCE_DIR;
mkdirSync(evidence, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'promotion-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temporary, 'key.pem'),
  '-out', join(temporary, 'cert.pem'), '-days', '1', '-subj', '/CN=' + hostname], { stdio: 'ignore' });
// Local TLS termination preserves the normal public-origin and secure-cookie contracts.
const edge = https.createServer({ key: readFileSync(join(temporary, 'key.pem')), cert: readFileSync(join(temporary, 'cert.pem')) }, (req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 3000, path: req.url, method: req.method,
    headers: { ...req.headers, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'https' } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
const origin = 'https://' + hostname + ':' + edge.address().port;
const checks = [], errors = [], externalRequests = [];
let browser;
const centerPath = '/referral/promotion-center.html';
const kitPath = '/referral/marketing-kit.html';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function context() {
  const result = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  result.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  result.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  return result;
}
async function actor(label, role, roles, browserContext = null) {
  const password = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const email = 'promotion-ci-' + label + '-' + crypto.randomBytes(8).toString('hex') + '@example.test';
  // Fresh INSERTs only. Never reset an existing account or use the Owner seed.
  const inserted = await pool.query("INSERT INTO accounts(display_name,email,password_salt,password_hash,auth_status,email_verified_at,active_role,preferred_locale,identity_country_code) VALUES($1,$2,$3,$4,'active',NOW(),$5,$6,'PH') RETURNING id",
    ['Promotion CI ' + label, email, salt, passwordHash, role, label === 'merchant' ? 'fil-PH' : 'en-PH']);
  const id = Number(inserted.rows[0].id);
  assert.ok(id > 1, 'Disposable actor must not replace the seeded Owner');
  for (const [profile, enabled] of roles) {
    await pool.query('INSERT INTO profiles(account_id,role,enabled,status,visibility) VALUES($1,$2,$3,$4,\'private\')', [id, profile, enabled, enabled ? 'active' : 'disabled']);
  }
  const ctx = browserContext || await context();
  const login = await ctx.request.post(origin + '/api/auth/login', { data: { email, password } });
  assert.equal(login.status(), 200, 'Normal password login for synthetic ' + label);
  assert.equal((await login.json()).token, undefined, 'Browser login must not return a bearer token');
  const cookies = await ctx.cookies(origin);
  const session = cookies.find(item => item.name === '__Host-abl_session');
  assert.ok(session?.secure && session?.httpOnly && session.sameSite === 'Lax');
  assert.ok(cookies.some(item => item.name === '__Host-abl_csrf' && item.secure));
  return { id, context: ctx };
}
async function api(ctx, path, status = 200, options = {}) {
  const csrf = (await ctx.cookies(origin)).find(item => item.name === '__Host-abl_csrf')?.value;
  const response = await ctx.request.fetch(origin + path, { ...options, headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
  assert.equal(response.status(), status, path + ' response');
  return response.json();
}
async function fits(page, label) {
  const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(geometry.width <= geometry.viewport + 1, label + ' must fit its viewport');
  checks.push(label);
}
async function ready(page, kit = false) {
  await page.bringToFront();
  await page.locator(kit ? '#export:not([disabled])' : '#copy:not([disabled])').waitFor();
  if (kit) await page.locator('#preview img').waitFor();
}
async function decodeQr(page, dataUrl, expectedSize, qrBox = null) {
  await page.addScriptTag({ path: env.PROMOTION_QR_SCRIPT });
  const decoded = await page.evaluate(async ({ source, box }) => {
    const image = new Image(); image.src = source; await image.decode();
    const scaleX = image.naturalWidth / (box?.canvasWidth || image.naturalWidth);
    const scaleY = image.naturalHeight / (box?.canvasHeight || image.naturalHeight);
    const area = box ? { x: box.x * scaleX, y: box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY }
      : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = 'white'; drawing.fillRect(0, 0, canvas.width, canvas.height);
    // Rasterize the complete downloaded image once at its native dimensions.
    // Cropping fractional SVG bounds into a rounded-size canvas would resample
    // the QR a second time and test altered pixels instead of the actual file.
    drawing.drawImage(image, 0, 0);
    const left = Math.floor(area.x), top = Math.floor(area.y);
    const width = Math.ceil(area.x + area.width) - left, height = Math.ceil(area.y + area.height) - top;
    if (left < 0 || top < 0 || left + width > canvas.width || top + height > canvas.height) throw new Error('QR sample is outside the downloaded image');
    const pixels = drawing.getImageData(left, top, width, height);
    const code = globalThis.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
    return { width: image.naturalWidth, height: image.naturalHeight, payload: code?.data || null };
  }, { source: dataUrl, box: qrBox });
  if (expectedSize) assert.deepEqual({ width: decoded.width, height: decoded.height }, expectedSize, 'Downloaded image has its native export dimensions');
  return decoded;
}
async function downloadedSvg(page, svg, width, height, filename) {
  await page.bringToFront();
  await page.setViewportSize({ width, height });
  await page.setContent('<!doctype html><style>html,body{margin:0}svg{display:block}</style>' + svg);
  await page.locator('svg image[data-image-role="qr"]').waitFor();
  const metrics = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    const width = Number(svg.getAttribute('width')), height = Number(svg.getAttribute('height'));
    const clipped = [...svg.querySelectorAll('text')].filter(node => {
      const box = node.getBBox();
      return box.x < -1 || box.y < -1 || box.x + box.width > width + 1 || box.y + box.height > height + 1;
    }).map(node => node.getAttribute('data-text-role'));
    const qr = svg.querySelector('[data-image-role="qr"]');
    return { width, height, clipped, qr: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(qr.getAttribute(key))])),
      links: [...svg.querySelectorAll('a')].map(node => node.getAttribute('href')) };
  });
  assert.equal(metrics.width, width); assert.equal(metrics.height, height);
  assert.deepEqual(metrics.clipped, [], 'Actual browser SVG text geometry remains inside the design');
  assert.ok(metrics.qr.x >= 0 && metrics.qr.y >= 0 && metrics.qr.x + metrics.qr.width <= width && metrics.qr.y + metrics.qr.height <= height);
  await page.screenshot({ path: join(evidence, filename), fullPage: true });
  return { ...metrics, qr: { ...metrics.qr, canvasWidth: width, canvasHeight: height } };
}
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const guest = await context();
  const health = await api(guest, '/health');
  assert.equal(health.deployment?.revision, revision.slice(0, 12), 'Gateway serves the exact tested revision');
  for (const asset of [centerPath, kitPath, '/referral/promotion-page.js', '/referral/promotion-ui-core.js', '/referral/promotion-export.js', '/referral/marketing-kit-runtime.js', '/referral/promotion-copy.js', '/referral/promotion.css', '/referral/promotion-brand.js']) {
    const response = await guest.request.get(origin + asset);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), hash(readFileSync(new URL('../public' + asset, import.meta.url))), 'Exact served asset: ' + asset);
  }
  checks.push('Exact source revision and actual served Promotion Center/Marketing Kit modules');
  await api(guest, '/api/growth/referral?profile=merchant', 401);
  const page = await guest.newPage();
  await page.goto(origin + centerPath);
  await page.locator('#signin').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#copy').isDisabled());
  assert.equal(await page.locator('#referralUrl').inputValue(), '');
  const merchant = await actor('merchant', 'merchant', [['customer', true], ['merchant', true], ['supplier', false]], guest);
  const customer = await actor('customer', 'customer', [['customer', true]]);
  await page.locator('#signinRetry').click();
  await ready(page);
  await page.locator('#qrImage').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#locale').inputValue(), 'fil-PH', 'Account language supplies the initial preference');
  assert.deepEqual(await page.locator('#role option').evaluateAll(nodes => nodes.map(node => node.value)), ['customer', 'merchant']);
  const me = await api(guest, '/api/me');
  const referral = await api(guest, '/api/growth/referral?profile=merchant&account_id=' + customer.id);
  assert.equal(Number(me.account.id), merchant.id); assert.equal(Number(referral.account_id), merchant.id);
  assert.equal(await page.locator('#referralUrl').inputValue(), referral.referralUrl);
  assert.equal(new URL(referral.referralUrl).origin, origin); assert.equal(new URL(referral.referralUrl).searchParams.get('profile'), 'merchant');
  const qrUrl = new URL(referral.referralUrl); qrUrl.hash = 'qr';
  const expectedQr = qrUrl.toString();
  assert.equal(referral.qr.payload, expectedQr, 'QR payload retains the intentional scan-origin marker');
  assert.equal((await api(customer.context, '/api/growth/referral?profile=customer')).account_id, customer.id);
  await api(guest, '/api/growth/referral?profile=supplier', 403);
  await api(customer.context, '/api/growth/referral?profile=merchant', 403);
  const decoding = await guest.newPage();
  assert.equal((await decodeQr(decoding, await page.locator('#qrImage').getAttribute('src'))).payload, expectedQr);
  await decoding.close();
  await ready(page);
  const originalCode = await page.locator('#referralCode').innerText();
  await page.locator('#role').selectOption('customer');
  await page.waitForFunction(() => document.querySelector('#referralUrl').value.includes('profile=customer'));
  await ready(page);
  assert.equal(await page.locator('#referralCode').innerText(), originalCode);
  assert.equal((await api(guest, '/api/me')).account.active_role, 'merchant', 'Sharing role does not change active account profile');
  await page.locator('#role').selectOption('merchant'); await ready(page);
  await page.locator('#locale').selectOption('en-PH');
  await fits(page, '390px Promotion Center has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'center-mobile.png'), fullPage: true });
  checks.push('Signed-out recovery, real secure-cookie login, account binding, enabled roles, role negatives and stable personal QR');

  await page.locator('#marketingKit').click(); await ready(page, true);
  assert.equal(await page.locator('#role').inputValue(), 'merchant');
  await page.locator('#template').selectOption('A4_REFERRAL_POSTER_V1'); await ready(page, true);
  const artifact = await guest.newPage();
  let a4Geometry;
  for (const format of ['svg', 'png', 'jpg']) {
    await page.bringToFront();
    await page.locator('#format').selectOption(format); await ready(page, true);
    const pending = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await pending;
    assert.ok(download.suggestedFilename().endsWith('-en-ph-' + originalCode + '.' + format));
    const file = join(evidence, 'a4-en.' + format); await download.saveAs(file);
    assert.equal(await download.failure(), null);
    const bytes = readFileSync(file);
    if (format === 'svg') {
      assert.ok(bytes.toString('utf8').startsWith('<svg'));
      a4Geometry = await downloadedSvg(artifact, bytes.toString('utf8'), 794, 1123, 'a4-native.png');
      assert.deepEqual(a4Geometry.links, [referral.referralUrl, referral.referralUrl]);
    } else if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    else assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
    const mime = format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'image/jpeg';
    const decoded = await decodeQr(artifact, 'data:' + mime + ';base64,' + bytes.toString('base64'), format === 'svg' ? { width: 794, height: 1123 } : { width: 2480, height: 3508 }, a4Geometry.qr);
    assert.equal(decoded.payload, expectedQr, format + ' downloaded pixels preserve the exact QR referral URL and scan marker');
  }
  checks.push('Real SVG/PNG/JPEG downloads decode at native A4 dimensions, preserve complete links and scan to the actual personal invitation');
  await ready(page, true);
  await fits(page, '390px A4 Marketing Kit has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'kit-mobile.png'), fullPage: true });
  const popupPending = page.waitForEvent('popup'); await page.locator('#print').click();
  const popup = await popupPending; await popup.locator('.sheet svg').waitFor();
  const printState = await popup.evaluate(() => ({
    wired: typeof document.querySelector('#print').onclick === 'function',
    pageRule: [...document.styleSheets[0].cssRules].find(rule => rule.cssText.startsWith('@page'))?.cssText || '',
    openerCleared: window.opener === null
  }));
  assert.ok(printState.wired && printState.openerCleared); assert.match(printState.pageRule, /210mm 297mm/);
  // Observe the real click handler's print intent without claiming an OS dialog or physical print.
  await popup.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
  await popup.locator('#print').click(); assert.equal(await popup.evaluate(() => window.__printCalls), 1);
  const pdf = await popup.pdf({ path: join(evidence, 'a4-print.pdf'), preferCSSPageSize: true, printBackground: true });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
  assert.ok(mediaBox && Math.abs(Number(mediaBox[1]) - 595.28) < 2 && Math.abs(Number(mediaBox[2]) - 841.89) < 2, 'Browser PDF uses A4 dimensions');
  await popup.close(); checks.push('Print window button wiring, isolated opener and real A4 browser PDF');

  await page.locator('#locale').selectOption('fil-PH'); await ready(page, true);
  await page.locator('#template').selectOption('STORY_REFERRAL_V1'); await ready(page, true);
  await page.locator('#variant').selectOption('money_visibility_v1'); await ready(page, true);
  await page.locator('#format').selectOption('png'); await ready(page, true);
  await page.reload(); await ready(page, true);
  for (const [id, expected] of [['locale', 'fil-PH'], ['template', 'STORY_REFERRAL_V1'], ['variant', 'money_visibility_v1'], ['format', 'png'], ['role', 'merchant']]) assert.equal(await page.locator('#' + id).inputValue(), expected);
  assert.equal(await page.locator('html').getAttribute('lang'), 'fil-PH');
  const storySource = await page.locator('#preview img').getAttribute('src');
  const storySvg = await page.evaluate(async source => (await fetch(source)).text(), storySource);
  const storyGeometry = await downloadedSvg(artifact, storySvg, 1080, 1920, 'story-filipino-native.png');
  assert.deepEqual(storyGeometry.links, [referral.referralUrl, referral.referralUrl]);
  await ready(page, true);
  await page.locator('#back').click(); await ready(page);
  assert.equal(new URL(page.url()).searchParams.get('template'), 'STORY_REFERRAL_V1');
  await page.locator('#marketingKit').click(); await ready(page, true);
  assert.equal(await page.locator('#variant').inputValue(), 'money_visibility_v1');
  await fits(page, '390px Filipino Story has no horizontal overflow');
  await page.setViewportSize({ width: 1280, height: 900 }); await fits(page, 'Desktop Marketing Kit has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'kit-desktop-filipino.png'), fullPage: true });
  checks.push('Filipino Story native text bounds, account-scoped language/design persistence, reload and round-trip navigation');
  await artifact.close();

  const landing = await guest.newPage();
  const landingEvent = landing.waitForResponse(response => new URL(response.url()).pathname === '/api/growth/referral-analytics/public'
    && response.request().postDataJSON()?.event === 'referral_landing_viewed')
    .then(response => ({ response }), error => ({ error }));
  const landingResponse = await landing.goto(referral.referralUrl);
  assert.equal(landingResponse?.status(), 200, 'Canonical invitation URL must serve its public landing');
  await landing.locator('#referralCode').waitFor({ state: 'visible' });
  assert.equal(await landing.locator('#referralCode').innerText(), originalCode, 'Public landing displays the actual invitation code');
  const event = await landingEvent;
  if (event.error) throw event.error;
  const accepted = event.response;
  assert.equal(accepted.status(), 202, 'Signed-in public landing includes the real CSRF header');
  const acceptance = await accepted.json();
  assert.equal(acceptance.accepted, true); assert.equal(acceptance.delivered, false); assert.equal(acceptance.reason, 'disabled');
  await landing.close();
  checks.push('Signed-in public referral landing passes CSRF while telemetry delivery remains disabled');

  const customerPage = await customer.context.newPage(); await customerPage.goto(origin + centerPath); await ready(customerPage);
  assert.deepEqual(await customerPage.locator('#role option').evaluateAll(nodes => nodes.map(node => node.value)), ['customer']);
  assert.notEqual(await customerPage.locator('#referralCode').innerText(), originalCode);
  await api(customer.context, '/api/auth/logout', 200, { method: 'POST', data: {} });
  await customerPage.reload(); await customerPage.locator('#signin').waitFor({ state: 'visible' });
  assert.ok(await customerPage.locator('#copy').isDisabled()); assert.equal(await customerPage.locator('#referralUrl').inputValue(), '');
  await api(customer.context, '/api/growth/referral?profile=customer', 401);
  checks.push('Second account has its own referral and enabled role; logout removes private invitation and revokes API access');
  assert.deepEqual(errors, [], 'No browser application exceptions');
  assert.deepEqual(externalRequests, [], 'No outbound browser asset, provider or sharing request');
  const result = { status: 'PASS', revision, served_revision: health.deployment.revision, browser_version: browser.version(), checks,
    scope: 'Real canonical gateway/PostgreSQL and normal password/cookie/CSRF flows on disposable loopback CI. Download pixels and browser-generated PDF verified. Not Railway Preview, Production, physical Android or physical print acceptance.' };
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', revision, checks, error: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close(); edge.closeAllConnections(); await new Promise(resolve => edge.close(resolve));
  await pool.end(); rmSync(temporary, { recursive: true, force: true });
}
