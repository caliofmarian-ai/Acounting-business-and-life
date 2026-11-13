// Native Chrome acceptance of the real Merchant CSV page and script.
// Entirely synthetic fetch responses. Does NOT log into Railway or post stock/money.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const playwrightModule = process.env.MERCHANT_CSV_BROWSER_MODULE;
assert.ok(playwrightModule, 'Provide the isolated Playwright module path');
const { chromium } = await import(playwrightModule);

const root = new URL('../public/', import.meta.url);
const assets = new Map([
  ['/merchant-stock-csv-intake.html', ['merchant-stock-csv-intake.html', 'text/html; charset=utf-8']],
  ['/merchant-stock-csv-intake.js', ['merchant-stock-csv-intake.js', 'text/javascript; charset=utf-8']]
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/session-security.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end("window.ABLSession={authenticated:()=>true,csrfToken:()=> 'synthetic-csrf'};");
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const bytes = await readFile(new URL(asset[0], root));
    response.writeHead(200, { 'Content-Type': asset[1] });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500);
    response.end('Synthetic asset server error');
  }
});

async function waitUntil(predicate, label, timeoutMs = 7000) {
  const started = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - started < timeoutMs, label);
    await delay(25);
  }
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const url = 'http://127.0.0.1:' + server.address().port + '/merchant-stock-csv-intake.html';
let browser;
let releaseInventoryRead;
try {
  browser = await chromium.launch({
    channel: process.env.MERCHANT_CSV_BROWSER_CHANNEL || 'chrome',
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  let activeRole = 'merchant';
  let inventoryReads = 0;
  let purchasePosts = 0;
  let transactionPatches = 0;

  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/me') {
      return json({ account: { id: 11, active_role: activeRole },
        profiles: [{ role: 'merchant', enabled: activeRole === 'merchant' }] });
    }
    if (path === '/api/accounting/workspaces') {
      return json({ role: activeRole,
        businesses: [{ id: 22, name: 'Synthetic QA Merchant', country_code: 'PH' }],
        active_business_id: 22 });
    }
    if (path === '/api/inventory') {
      assert.equal(route.request().headers()['x-abl-inventory-origin-business'], '22');
      inventoryReads++;
      if (inventoryReads === 2) {
        await new Promise(resolve => { releaseInventoryRead = resolve; });
      }
      return json([]);
    }
    if (path === '/api/transactions' && route.request().method() === 'GET') return json([]);
    if (path === '/api/inventory/purchase') {
      purchasePosts++;
      return json({ error: 'Synthetic test forbids posting physical stock' }, 409);
    }
    if (path.startsWith('/api/transactions/') && route.request().method() === 'PATCH') {
      transactionPatches++;
      return json({ error: 'Synthetic test forbids expense mutation' }, 409);
    }
    return json({ error: 'Unexpected synthetic route' }, 500);
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#authStatus')?.textContent?.includes('Signed in as Merchant'));
  assert.equal(inventoryReads, 1, 'Initial Merchant verification reads one Inventory snapshot');
  assert.equal(await page.locator('#post').isDisabled(), true);

  await page.locator('#csv').setInputFiles({
    name: 'synthetic-stock.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'item,proposed_quantity,proposed_unit,screenshot_line_php,actual_total_paid_php\n' +
      'Synthetic Rice,2,kg,120.00,120.00\n'
    )
  });
  await page.waitForFunction(() => document.querySelector('#rowsCounter')?.textContent?.includes('1 lines'));
  await page.locator('#rows .item select').last().selectOption('food_ingredient');
  await page.locator('#rows .item label.check input[type=checkbox]').last().check();
  await page.locator('#businessName').fill('Synthetic QA Merchant');
  await page.locator('#purchaseAccount').selectOption('cash');
  const localPhilippineToday = await page.locator('#purchaseDate').getAttribute('max');
  assert.match(localPhilippineToday, /^\d{4}-\d\d-\d\d$/);
  await page.locator('#purchaseDate').fill(localPhilippineToday);
  await page.locator('#actualTotalPaid').fill('120.00');
  await page.locator('#physicalConfirm').check();
  await page.locator('#moneyConfirm').check();
  assert.equal(await page.locator('#post').isEnabled(), true,
    'Reviewed, reconciled and explicitly confirmed paid batch enables Save');

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, 'Actual Merchant page must not overflow 390px native Chrome viewport: ' + width);

  await page.locator('#post').click();
  await waitUntil(() => inventoryReads === 2 && typeof releaseInventoryRead === 'function',
    'Save must enter a second, origin-pinned Stock preflight');
  assert.equal(await page.locator('#stop').isEnabled(), true);
  await page.locator('#stop').click();
  releaseInventoryRead();
  releaseInventoryRead = null;
  await page.waitForFunction(() => document.querySelector('#stop')?.disabled === true);
  assert.equal(await page.locator('#physicalConfirm').isChecked(), false,
    'Explicit Stop must revoke the former physical receiving approval');
  assert.equal(await page.locator('#moneyConfirm').isChecked(), false,
    'Explicit Stop must revoke the former paid expense approval');
  assert.equal(await page.locator('#post').isDisabled(), true,
    'Completed preflight after Stop must never silently re-enable a paid Stock + Money POST');
  assert.equal(purchasePosts, 0, 'Stop during pending Stock preflight must prevent ALL purchase POSTs');
  assert.equal(transactionPatches, 0, 'No historical Money patch may occur without a posted purchase');
  assert.match(await page.locator('#results').innerText(), /Stop requested/i);
  assert.match(await page.locator('#rowsCounter').innerText(), /0 saved this session/);

  // An inactive replacement role cannot inherit the prior Merchant's private CSV review.
  activeRole = 'customer';
  await page.locator('#refreshContext').click();
  await page.waitForFunction(() =>
    document.querySelector('#authStatus')?.textContent?.includes('Switch to an active Merchant'));
  assert.equal(await page.locator('#reviewPanel').isVisible(), false);
  assert.equal(await page.locator('#post').isDisabled(), true);
  assert.equal(await page.locator('#rows .item').count(), 0);
  assert.equal(purchasePosts, 0);
  assert.deepEqual(errors, [], 'No unexpected page JavaScript errors');

  console.log('MERCHANT_CSV_NATIVE_CHROME_PASS viewport=390x844 initial_inventory_reads=1 ' +
    'stopped_preflight=1 purchase_posts=0 money_patches=0 revoked_role_cleared=1 ' +
    'evidence=SYNTHETIC_BROWSER_ONLY');
} finally {
  if (typeof releaseInventoryRead === 'function') releaseInventoryRead();
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
