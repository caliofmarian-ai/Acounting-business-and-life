// Real full-gateway/browser acceptance on a disposable loopback CI database.
// No deployed credentials, authentication/API interception, auth bypass or sends.
// One cold-context artwork-only network fault checks honest failure and retry.
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
import { PROMOTION_BRAND_ASSETS, DEFAULT_PROMOTION_ARTWORK_ID } from '../public/referral/promotion-brand.js';

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
const checks = [], errors = [], externalRequests = [], imageEvidence = [];
let browser;
const centerPath = '/referral/promotion-center.html';
const kitPath = '/referral/marketing-kit.html';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const artworks = PROMOTION_BRAND_ASSETS.map(asset => {
  const bytes = readFileSync(new URL('../public' + asset.src, import.meta.url));
  return { ...asset, sha256: hash(bytes), dataUrl: 'data:image/jpeg;base64,' + bytes.toString('base64') };
});
const artworkById = id => artworks.find(asset => asset.id === id);
function embeddedArtwork(source, id) {
  assert.match(source || '', /^data:image\/jpeg;base64,/, 'Approved artwork is embedded in the output');
  assert.equal(hash(Buffer.from(source.split(',')[1], 'base64')), artworkById(id).sha256, 'Embedded bytes match selected artwork ' + id);
}
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
  async function signIn(targetContext = ctx) {
    const login = await targetContext.request.post(origin + '/api/auth/login', { data: { email, password } });
    assert.equal(login.status(), 200, 'Normal password login for synthetic ' + label);
    assert.equal((await login.json()).token, undefined, 'Browser login must not return a bearer token');
    const cookies = await targetContext.cookies(origin);
    const session = cookies.find(item => item.name === '__Host-abl_session');
    assert.ok(session?.secure && session?.httpOnly && session.sameSite === 'Lax');
    assert.ok(cookies.some(item => item.name === '__Host-abl_csrf' && item.secure));
  }
  await signIn();
  return { id, context: ctx, signIn };
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
async function chooseArtwork(page, id, kit = false) {
  await page.bringToFront();
  await page.locator('#artworkOptions input[name="artwork"][value="' + id + '"]').check();
  await ready(page, kit);
  await page.waitForFunction(({ selected, kitPage }) => {
    const image = document.querySelector(kitPage ? '#preview img' : '#brandArtwork');
    return image && !image.hidden && image.dataset.artwork === selected && image.complete && image.naturalWidth > 0;
  }, { selected: id, kitPage: kit });
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), id);
  assert.equal(new URL(page.url()).searchParams.get('artwork'), id);
  assert.equal(await page.locator('#artworkRetry').isVisible(), false);
  if (!kit) {
    embeddedArtwork(await page.locator('#brandArtwork').getAttribute('src'), id);
    assert.equal(await page.locator('#brandArtwork').getAttribute('alt'), artworkById(id).alt[await page.locator('#locale').inputValue()]);
  }
}
async function previewSvg(page) {
  const source = await page.locator('#preview img').getAttribute('src');
  return page.evaluate(async url => (await fetch(url)).text(), source);
}
async function checkArtworkPixels(page, source, geometry, id, format, template) {
  assert.ok(geometry.brand, 'Design contains selected artwork');
  embeddedArtwork(geometry.brand.source, id);
  assert.equal(geometry.brand.preserveAspectRatio, 'xMidYMid meet', 'Whole approved image remains visible');
  const scores = await page.evaluate(async ({ source, box, references }) => {
    const load = async url => { const image = new Image(); image.src = url; await image.decode(); return image; };
    const output = await load(source);
    const canvas = document.createElement('canvas'); canvas.width = output.naturalWidth; canvas.height = output.naturalHeight;
    const drawing = canvas.getContext('2d'); drawing.drawImage(output, 0, 0);
    const sample = (image, x, y, width, height) => {
      const target = document.createElement('canvas'); target.width = 48; target.height = 48;
      const context = target.getContext('2d'); context.drawImage(image, x, y, width, height, 0, 0, 48, 48);
      return context.getImageData(0, 0, 48, 48).data;
    };
    const scaleX = output.naturalWidth / box.canvasWidth, scaleY = output.naturalHeight / box.canvasHeight;
    const scale = Math.min(box.width / 1536, box.height / 1024);
    const fitted = { x: box.x + (box.width - 1536 * scale) / 2, y: box.y + (box.height - 1024 * scale) / 2,
      width: 1536 * scale, height: 1024 * scale };
    // Compare central image pixels, excluding contain letterboxes and rounded clipping.
    const actual = sample(canvas, (fitted.x + fitted.width * .2) * scaleX, (fitted.y + fitted.height * .2) * scaleY,
      fitted.width * .6 * scaleX, fitted.height * .6 * scaleY);
    const scores = [];
    for (const reference of references) {
      const image = await load(reference.dataUrl);
      if (image.naturalWidth !== 1536 || image.naturalHeight !== 1024) throw new Error('Unexpected source artwork dimensions');
      const expected = sample(image, 1536 * .2, 1024 * .2, 1536 * .6, 1024 * .6);
      let difference = 0;
      for (let i = 0; i < actual.length; i += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual[i + channel] - expected[i + channel]);
      scores.push({ id: reference.id, mean_absolute_error: Number((difference / (48 * 48 * 3)).toFixed(3)) });
    }
    return scores.sort((a, b) => a.mean_absolute_error - b.mean_absolute_error);
  }, { source, box: { ...geometry.brand, source: undefined, canvasWidth: geometry.width, canvasHeight: geometry.height },
    references: artworks.map(asset => ({ id: asset.id, dataUrl: asset.dataUrl })) });
  assert.equal(scores[0].id, id, 'Rendered pixels match selected artwork: ' + JSON.stringify(scores));
  assert.ok(scores[0].mean_absolute_error < 20, 'Selected artwork remains recognizable in downloaded pixels: ' + JSON.stringify(scores));
  const entry = { template, artwork: id, format, source_sha256: artworkById(id).sha256, scores };
  imageEvidence.push(entry);
  return entry;
}
async function checkBrandedInvitation(page, source, geometry, id) {
  const bounds = node => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, node?.[key]]));
  assert.deepEqual(bounds(geometry.brand), { x: 0, y: 0, width: 1536, height: 1024 }, 'Branded invitation preserves the complete original 3:2 artwork');
  assert.deepEqual(geometry.brand.clip, { x: 0, y: 0, width: 1536, height: 1024, rx: 0, ry: 0 }, 'Original artwork has no cropped or rounded corners');
  assert.deepEqual(bounds(geometry.footer), { x: 0, y: 1024, width: 1536, height: 512 });
  assert.equal(geometry.footer.fill.toLowerCase(), '#ffffff', 'Personal invitation has its own white footer');
  assert.deepEqual(bounds(geometry.qr), { x: 1160, y: 1080, width: 320, height: 320 });
  assert.deepEqual(bounds(geometry.qrPanel), { x: 1136, y: 1056, width: 368, height: 368 }, 'QR has an independent 24px white safety margin');
  assert.equal(geometry.qrPanel.fill.toLowerCase(), '#ffffff');
  assert.ok(geometry.textBounds.length > 0, 'Footer contains personal invitation text');
  for (const text of geometry.textBounds) {
    assert.ok(text.y >= 1024 && text.y + text.height <= 1536, 'Personal text stays entirely below the original artwork: ' + text.role);
    const qr = geometry.qr;
    assert.ok(text.x + text.width <= qr.x || text.x >= qr.x + qr.width
      || text.y + text.height <= qr.y || text.y >= qr.y + qr.height, 'Footer text does not cover the QR: ' + text.role);
  }
  const pixels = await page.evaluate(async ({ source, reference }) => {
    const load = async url => { const image = new Image(); image.src = url; await image.decode(); return image; };
    const output = await load(source), original = await load(reference);
    if (output.naturalWidth !== 1536 || output.naturalHeight !== 1536
      || original.naturalWidth !== 1536 || original.naturalHeight !== 1024) throw new Error('Unexpected branded invitation dimensions');
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1536;
    const drawing = canvas.getContext('2d'); drawing.drawImage(output, 0, 0);
    const expected = document.createElement('canvas'); expected.width = 1536; expected.height = 1024;
    const expectedDrawing = expected.getContext('2d'); expectedDrawing.drawImage(original, 0, 0);
    const actualPixels = drawing.getImageData(0, 0, 1536, 1024).data;
    const expectedPixels = expectedDrawing.getImageData(0, 0, 1536, 1024).data;
    const totals = { full: [0, 0], top: [0, 0], bottom: [0, 0], left: [0, 0], right: [0, 0] };
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1536; x++) {
      const offset = (y * 1536 + x) * 4;
      let difference = 0;
      for (let channel = 0; channel < 3; channel++) difference += Math.abs(actualPixels[offset + channel] - expectedPixels[offset + channel]);
      if (actualPixels[offset + 3] !== 255) throw new Error('Original artwork must remain opaque');
      totals.full[0] += difference; totals.full[1] += 3;
      for (const edge of [y < 16 && 'top', y >= 1008 && 'bottom', x < 16 && 'left', x >= 1520 && 'right'].filter(Boolean)) {
        totals[edge][0] += difference; totals[edge][1] += 3;
      }
    }
    const errors = Object.fromEntries(Object.entries(totals).map(([name, [sum, count]]) => [name, Number((sum / count).toFixed(6))]));
    // Sample blank margins away from the QR panel's antialiased stroke at x=1504.
    for (const [x, y, width, height] of [[16, 1032, 1504, 16], [16, 1056, 16, 448], [1512, 1056, 8, 448], [16, 1520, 1504, 8]]) {
      const pixels = drawing.getImageData(x, y, width, height).data;
      if (pixels.some(value => value !== 255)) throw new Error('Artwork or content intrudes into the protected white footer margin');
    }
    const footer = document.createElement('canvas'); footer.width = 1536; footer.height = 512;
    footer.getContext('2d').drawImage(canvas, 0, 1024, 1536, 512, 0, 0, 1536, 512);
    return { errors, footer: footer.toDataURL('image/png') };
  }, { source, reference: artworkById(id).dataUrl });
  for (const [region, difference] of Object.entries(pixels.errors)) {
    assert.ok(difference < 4, 'Complete original artwork including its ' + region + ' region is preserved in the native PNG: ' + difference);
  }
  return { original_pixel_mae: pixels.errors, footer_sha256: hash(Buffer.from(pixels.footer.split(',')[1], 'base64')) };
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
    const brand = svg.querySelector('[data-image-role="brand"]');
    const footer = svg.querySelector('[data-marketing-role="personal-footer"]');
    const qrPanel = svg.querySelector('[data-marketing-role="qr-panel"]');
    const clipId = brand?.getAttribute('clip-path')?.match(/^url\(#([^)]*)\)$/)?.[1];
    const brandClip = clipId ? document.getElementById(clipId)?.querySelector('rect') : null;
    const rectangle = node => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(node.getAttribute(key))]));
    return { width, height, clipped,
      footer: footer ? { ...rectangle(footer), fill: footer.getAttribute('fill') } : null,
      qrPanel: qrPanel ? { ...rectangle(qrPanel), fill: qrPanel.getAttribute('fill') } : null,
      textBounds: [...svg.querySelectorAll('text')].map(node => {
        const box = node.getBBox();
        return { role: node.getAttribute('data-text-role'), x: box.x, y: box.y, width: box.width, height: box.height };
      }), qr: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(qr.getAttribute(key))])),
      brand: brand ? { ...Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(brand.getAttribute(key))])),
        source: brand.getAttribute('href'), preserveAspectRatio: brand.getAttribute('preserveAspectRatio'),
        clip: brandClip ? { ...rectangle(brandClip), rx: Number(brandClip.getAttribute('rx')), ry: Number(brandClip.getAttribute('ry')) } : null } : null,
      externalImages: [...svg.querySelectorAll('image')].filter(node => !/^data:image\/(?:png|jpeg|webp);base64,/.test(node.getAttribute('href') || '')).length,
      links: [...svg.querySelectorAll('a')].map(node => node.getAttribute('href')) };
  });
  assert.equal(metrics.width, width); assert.equal(metrics.height, height);
  assert.deepEqual(metrics.clipped, [], 'Actual browser SVG text geometry remains inside the design');
  assert.equal(metrics.externalImages, 0, 'Downloaded SVG contains its images without external dependencies');
  assert.ok(metrics.qr.x >= 0 && metrics.qr.y >= 0 && metrics.qr.x + metrics.qr.width <= width && metrics.qr.y + metrics.qr.height <= height);
  await page.screenshot({ path: join(evidence, filename), fullPage: true });
  return { ...metrics, qr: { ...metrics.qr, canvasWidth: width, canvasHeight: height } };
}
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const guest = await context();
  const health = await api(guest, '/health');
  assert.equal(health.deployment?.revision, revision.slice(0, 12), 'Gateway serves the exact tested revision');
  assert.deepEqual(artworks.map(asset => asset.id), ['app-platform', 'connected-profiles', 'everyday-life']);
  assert.equal(DEFAULT_PROMOTION_ARTWORK_ID, 'connected-profiles');
  for (const asset of [centerPath, kitPath, '/referral/promotion-page.js', '/referral/promotion-ui-core.js', '/referral/promotion-export.js', '/referral/marketing-kit-runtime.js', '/referral/promotion-copy.js', '/referral/promotion.css', '/referral/promotion-brand.js',
    ...artworks.flatMap(asset => [asset.src, asset.thumbnail])]) {
    const response = await guest.request.get(origin + asset);
    assert.equal(response.status(), 200);
    assert.equal(hash(await response.body()), hash(readFileSync(new URL('../public' + asset, import.meta.url))), 'Exact served asset: ' + asset);
  }
  checks.push('Exact source revision and served page/catalog/full-artwork/thumbnail byte parity');
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
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), DEFAULT_PROMOTION_ARTWORK_ID);
  assert.deepEqual(await page.locator('#artworkOptions input[name="artwork"]').evaluateAll(nodes => nodes.map(node => node.value)), artworks.map(asset => asset.id));
  await page.waitForFunction(() => [...document.querySelectorAll('#artworkOptions img')].length === 3
    && [...document.querySelectorAll('#artworkOptions img')].every(image => image.complete && image.naturalWidth === 360 && image.naturalHeight === 240));
  assert.deepEqual(await page.locator('#artworkOptions img').evaluateAll(nodes => nodes.map(node => new URL(node.src).pathname)), artworks.map(asset => asset.thumbnail));
  for (const asset of artworks) {
    await chooseArtwork(page, asset.id);
    assert.equal(await page.locator('#referralUrl').inputValue(), referral.referralUrl, 'Artwork choice preserves the account invitation');
    await page.screenshot({ path: join(evidence, 'center-' + asset.id + '.png'), fullPage: true });
  }
  await page.locator('#artworkOptions input[value="app-platform"]').focus();
  await page.locator('#artworkOptions input[value="app-platform"]').press('ArrowRight');
  assert.ok(await page.locator('#artworkOptions input[value="connected-profiles"]').isChecked());
  await chooseArtwork(page, 'connected-profiles');
  await page.locator('#artworkOptions input[value="everyday-life"]').focus();
  await page.locator('#artworkOptions input[value="everyday-life"]').press('Space');
  assert.ok(await page.locator('#artworkOptions input[value="everyday-life"]').isChecked());
  await chooseArtwork(page, 'everyday-life');
  checks.push('All three visual artwork choices load the correct original image, with working native ArrowRight/Space radio controls');
  await fits(page, '390px Promotion Center has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'center-mobile.png'), fullPage: true });
  checks.push('Signed-out recovery, real secure-cookie login, account binding, enabled roles, role negatives and stable personal QR');

  await page.locator('#marketingKit').click(); await ready(page, true);
  assert.equal(await page.locator('#role').inputValue(), 'merchant');
  assert.equal(await page.locator('#template').inputValue(), 'BRANDED_INVITATION_V1', 'Fresh Marketing Kit defaults to the complete branded invitation');
  assert.equal(await page.locator('#format').inputValue(), 'png');
  assert.equal(await page.locator('#template option').count(), 11, 'All ten existing formats remain available alongside the new branded invitation');
  assert.match(await page.locator('#artworkHelp').innerText(), /English/);
  const artifact = await guest.newPage();
  let protectedFooterHash;
  for (const asset of artworks) {
    await chooseArtwork(page, asset.id, true);
    const brandedSvg = await previewSvg(page);
    const brandedGeometry = await downloadedSvg(artifact, brandedSvg, 1536, 1536, 'branded-' + asset.id + '-native.png');
    assert.deepEqual(brandedGeometry.links, [referral.referralUrl, referral.referralUrl]);
    await ready(page, true);
    const pending = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await pending, file = join(evidence, 'branded-' + asset.id + '-en.png');
    assert.ok(download.suggestedFilename().endsWith('-en-ph-' + originalCode + '.png'));
    await download.saveAs(file); assert.equal(await download.failure(), null);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const source = 'data:image/png;base64,' + bytes.toString('base64');
    assert.equal((await decodeQr(artifact, source, { width: 1536, height: 1536 }, brandedGeometry.qr)).payload, expectedQr);
    const image = await checkArtworkPixels(artifact, source, brandedGeometry, asset.id, 'png', 'BRANDED_INVITATION_V1');
    const protection = await checkBrandedInvitation(artifact, source, brandedGeometry, asset.id);
    Object.assign(image, protection);
    if (protectedFooterHash) assert.equal(protection.footer_sha256, protectedFooterHash, 'Personal footer pixels are independent of the selected original artwork');
    protectedFooterHash = protection.footer_sha256;
  }
  checks.push('Fresh default branded invitation downloads all three complete original images as native 1536×1536 PNGs, with full-image/edge pixel checks, an independent white personal footer and decoded personal QR');
  await ready(page, true);
  await fits(page, '390px branded invitation has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'branded-kit-mobile.png'), fullPage: true });
  await page.locator('#template').selectOption('A4_REFERRAL_POSTER_V1'); await ready(page, true);
  for (const asset of artworks) {
    await chooseArtwork(page, asset.id, true);
    let a4Geometry;
    for (const format of ['svg', 'png', 'jpg']) {
      await page.bringToFront();
      await page.locator('#format').selectOption(format); await ready(page, true);
      const pending = page.waitForEvent('download'); await page.locator('#export').click();
      const download = await pending;
      assert.ok(download.suggestedFilename().endsWith('-en-ph-' + originalCode + '.' + format));
      const file = join(evidence, 'a4-' + asset.id + '-en.' + format); await download.saveAs(file);
      assert.equal(await download.failure(), null);
      const bytes = readFileSync(file);
      if (format === 'svg') {
        assert.ok(bytes.toString('utf8').startsWith('<svg'));
        a4Geometry = await downloadedSvg(artifact, bytes.toString('utf8'), 794, 1123, 'a4-' + asset.id + '-native.png');
        assert.deepEqual(a4Geometry.links, [referral.referralUrl, referral.referralUrl]);
      } else if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      else assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
      const mime = format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = 'data:' + mime + ';base64,' + bytes.toString('base64');
      const decoded = await decodeQr(artifact, dataUrl, format === 'svg' ? { width: 794, height: 1123 } : { width: 2480, height: 3508 }, a4Geometry.qr);
      assert.equal(decoded.payload, expectedQr, format + ' downloaded pixels preserve the exact QR referral URL and scan marker');
      await checkArtworkPixels(artifact, dataUrl, a4Geometry, asset.id, format, 'A4_REFERRAL_POSTER_V1');
    }
  }
  checks.push('Each approved image appears in real self-contained A4 SVG/PNG/JPEG downloads, with native dimensions, matching image pixels and exact personal QR');
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
  assert.match(await page.locator('#artworkHelp').innerText(), /Mananatiling English/, 'Filipino helper discloses English text embedded in the original artwork');
  await page.locator('#template').selectOption('STORY_REFERRAL_V1'); await ready(page, true);
  await page.locator('#variant').selectOption('money_visibility_v1'); await ready(page, true);
  await page.locator('#format').selectOption('png'); await ready(page, true);
  for (const asset of artworks) {
    await chooseArtwork(page, asset.id, true);
    const storySvg = await previewSvg(page);
    const storyGeometry = await downloadedSvg(artifact, storySvg, 1080, 1920, 'story-' + asset.id + '-filipino-native.png');
    assert.deepEqual(storyGeometry.links, [referral.referralUrl, referral.referralUrl]);
    await ready(page, true);
    const pending = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await pending, file = join(evidence, 'story-' + asset.id + '-filipino.png');
    assert.ok(download.suggestedFilename().endsWith('-fil-ph-' + originalCode + '.png'));
    await download.saveAs(file); assert.equal(await download.failure(), null);
    const source = 'data:image/png;base64,' + readFileSync(file).toString('base64');
    assert.equal((await decodeQr(artifact, source, { width: 1080, height: 1920 }, storyGeometry.qr)).payload, expectedQr);
    await checkArtworkPixels(artifact, source, storyGeometry, asset.id, 'png', 'STORY_REFERRAL_V1');
  }
  await ready(page, true);
  await page.reload(); await ready(page, true);
  for (const [id, expected] of [['locale', 'fil-PH'], ['template', 'STORY_REFERRAL_V1'], ['variant', 'money_visibility_v1'], ['format', 'png'], ['role', 'merchant']]) assert.equal(await page.locator('#' + id).inputValue(), expected);
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), 'everyday-life');
  assert.equal(await page.locator('html').getAttribute('lang'), 'fil-PH');
  await page.locator('#back').click(); await ready(page);
  assert.equal(new URL(page.url()).searchParams.get('template'), 'STORY_REFERRAL_V1');
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), 'everyday-life');
  await chooseArtwork(page, 'everyday-life');
  await page.locator('#marketingKit').click(); await ready(page, true);
  assert.equal(await page.locator('#variant').inputValue(), 'money_visibility_v1');
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), 'everyday-life');
  await fits(page, '390px Filipino Story has no horizontal overflow');
  await page.setViewportSize({ width: 1280, height: 900 }); await fits(page, 'Desktop Marketing Kit has no horizontal overflow');
  await page.screenshot({ path: join(evidence, 'kit-desktop-filipino.png'), fullPage: true });
  checks.push('All three Filipino Story images render and download with correct pixels/QR; selected artwork, language and design survive reload and center/kit navigation');
  await artifact.close();

  // Fresh browser context has no successful artwork cache. Intercept only the
  // selected image; authentication, account/referral APIs and recovery stay real.
  const failureContext = await context();
  await merchant.signIn(failureContext);
  const failingAsset = origin + artworkById('app-platform').src;
  let failedImageRequests = 0;
  const failImage = async route => { failedImageRequests += 1; await route.abort('failed'); };
  await failureContext.route(failingAsset, failImage);
  const failurePage = await failureContext.newPage();
  await failurePage.goto(origin + centerPath + '?profile=merchant&locale=en-PH&artwork=app-platform');
  await ready(failurePage);
  await failurePage.locator('#artworkRetry').waitFor({ state: 'visible' });
  assert.equal(await failurePage.locator('#brandArtwork').isVisible(), false);
  assert.equal(await failurePage.locator('#brandArtwork').getAttribute('src'), null);
  assert.ok((await failurePage.locator('#artworkStatus').innerText()).trim().length > 0);
  assert.equal(await failurePage.locator('#referralUrl').inputValue(), referral.referralUrl, 'Artwork failure leaves the verified invitation usable');
  await failurePage.locator('#marketingKit').click();
  await failurePage.locator('#artworkRetry').waitFor({ state: 'visible' });
  for (const id of ['export', 'share', 'print']) assert.ok(await failurePage.locator('#' + id).isDisabled(), 'Failed selected artwork blocks ' + id);
  assert.equal(await failurePage.locator('#preview img').count(), 0, 'Failure cannot leave an old design as the chosen preview');
  assert.ok(failedImageRequests >= 2, 'Both cold page loaders actually encountered the simulated image failure');
  await failurePage.screenshot({ path: join(evidence, 'artwork-unavailable.png'), fullPage: true });
  await failureContext.unroute(failingAsset, failImage);
  await failurePage.locator('#artworkRetry').click();
  await chooseArtwork(failurePage, 'app-platform', true);
  const recoveredSvg = await previewSvg(failurePage);
  const recoveredImage = await failurePage.evaluate(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('[data-image-role="brand"]')?.getAttribute('href'), recoveredSvg);
  embeddedArtwork(recoveredImage, 'app-platform');
  await failureContext.close();
  checks.push('Cold-context image-only failure is explicit: center keeps its verified link, kit clears preview/blocks exports, and real retry recovers the selected artwork');

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

  // Normal logins in the same context retain localStorage, exposing accidental
  // account-global artwork preferences rather than masking them with new storage.
  await api(guest, '/api/auth/logout', 200, { method: 'POST', data: {} });
  await customer.signIn(guest);
  await page.goto(origin + centerPath); await ready(page);
  assert.equal(Number((await api(guest, '/api/me')).account.id), customer.id);
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), DEFAULT_PROMOTION_ARTWORK_ID, 'Other account must not inherit Merchant artwork');
  await chooseArtwork(page, 'app-platform');
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), 'app-platform');
  await api(guest, '/api/auth/logout', 200, { method: 'POST', data: {} });
  await merchant.signIn(guest);
  await page.goto(origin + centerPath); await ready(page);
  assert.equal(Number((await api(guest, '/api/me')).account.id), merchant.id);
  assert.equal(await page.locator('#artworkOptions input:checked').inputValue(), 'everyday-life', 'Merchant keeps its own browser-local artwork preference');
  await chooseArtwork(page, 'everyday-life');
  assert.equal(await page.locator('#referralUrl').inputValue(), referral.referralUrl);
  checks.push('Artwork preferences remain separate across two normal-login accounts sharing the same browser storage');

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
  const result = { status: 'PASS', revision, served_revision: health.deployment.revision, browser_version: browser.version(), checks, image_evidence: imageEvidence,
    scope: 'Real canonical gateway/PostgreSQL and normal password/cookie/CSRF flows on disposable loopback CI. Three branded artwork choices; fifteen real downloads across branded invitation, A4 and Filipino Story; exact served/embedded bytes, complete original/edge pixels and independent white footer, QR payloads, browser-local per-account preferences and browser PDF verified. Failure recovery uses image-only network fault injection; auth/APIs remain real. Not cross-device preference sync, Railway Preview, Production, physical Android or physical print acceptance.' };
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', revision, checks, image_evidence: imageEvidence, error: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close(); edge.closeAllConnections(); await new Promise(resolve => edge.close(resolve));
  await pool.end(); rmSync(temporary, { recursive: true, force: true });
}
