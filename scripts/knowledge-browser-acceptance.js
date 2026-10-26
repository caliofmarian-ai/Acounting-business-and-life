// Isolated module/browser acceptance using synthetic account and audit adapters.
// Full gateway/DB and shared Preview acceptance remain separate release gates.
import express from 'express';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerKnowledgeRoutes } from '../server-knowledge.js';
import { loadControlledDocuments } from '../documentation-catalog.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const evidence = process.env.KNOWLEDGE_BROWSER_EVIDENCE_DIR;
const { chromium } = await import(process.env.KNOWLEDGE_BROWSER_MODULE || 'playwright');
if (evidence) mkdirSync(evidence, { recursive: true });
const docs = loadControlledDocuments();
const merchantId = 'BL-30-PH-PLAY-002', formatId = 'BL-00-PH-QA-001';
docs.push({ ...docs.find(d => d.id === merchantId), id: formatId, title: 'Safe formatting check',
  markdown: '# Safe formatting\n\n<script>window.__unsafe=true</script>\n\n<img src=x onerror="window.__unsafe=true">\n\n[Unsafe](javascript:alert(1)) [Official](https://example.com/guide)\n\n| One | Two |\n| --- | --- |\n| Short | ' + 'x'.repeat(400) + ' |\n\n```\n' + 'x'.repeat(600) + '\n```' });
let loggedIn = true, failedCatalog = false, failedRead = false, delayedId = '';
const me = { account: { id: 2, auth_status: 'active' }, profiles: [{ role: 'merchant', enabled: true, status: 'active' }],
  businesses: [{ id: 10, active: true, country_code: 'PH' }] };
const pool = { async query(sql) {
  if (sql.includes('platform_admin_assignments')) return { rows: [] };
  if (sql.includes('INSERT INTO admin_audit_events')) return { rowCount: 1 };
  throw new Error('Unexpected browser-fixture query');
} };
const app = express();
app.use((req, res, next) => {
  if (failedCatalog && req.path === '/api/knowledge/catalog') return res.status(503).json({ error: 'Test connection unavailable' });
  if (req.path.startsWith('/api/knowledge/documents/')) {
    if (failedRead) return res.status(503).json({ error: 'Test read unavailable' });
    if (delayedId && req.path.endsWith(delayedId)) return setTimeout(next, 400);
  }
  next();
});
registerKnowledgeRoutes(app, { pool, identity: async () => {
  if (!loggedIn) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  return me;
}, loadDocuments: () => docs });
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));
app.get('/entry-fixture', (_req, res) => res.type('html').send('<!doctype html><html><body><div id="profileDrawerPanel"><button id="accountSettingsButton">Settings</button></div><div id="hub"><button id="accountHomeSettings">Settings</button></div><script type="module" src="/knowledge-entry.js"></script></body></html>'));
app.use(express.static(join(ROOT, 'public'), { index: false }));
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
const checks = [], errors = [];
const snapshot = async (page, name, fullPage = false) => {
  if (evidence) await page.screenshot({ path: join(evidence, name + '.png'), fullPage });
};
const fits = async (page, label) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
  checks.push(label);
};
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/knowledge'); await page.waitForSelector('.doc-card');
  await fits(page, '390x844 catalog has no page overflow');
  assert.equal(await page.locator('.doc-card').filter({ hasText: 'Executive' }).count(), 0);
  await snapshot(page, 'mobile-catalog');
  await page.locator('#search').fill('Merchant'); assert.ok(await page.locator('.doc-card').count() > 0);
  await page.locator('#category').selectOption('My role');
  await page.locator('[data-document-id="' + merchantId + '"]').click(); await page.waitForSelector('.document-body');
  assert.match(await page.locator('.document-notice').textContent(), /Draft guidance/);
  await fits(page, '390x844 Merchant reader has no page overflow'); await snapshot(page, 'mobile-reader');
  await page.locator('#backToList').click(); assert.equal(await page.locator('#search').inputValue(), 'Merchant');
  checks.push('Search/topic and Back navigation preserve context');
  await page.locator('#search').fill(''); await page.locator('#category').selectOption('');
  await page.locator('[data-document-id="' + formatId + '"]').click(); await page.waitForSelector('.document-body');
  assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false);
  assert.equal(await page.locator('.document-body script,.document-body img,.document-body [onerror]').count(), 0);
  assert.equal(await page.locator('.document-body a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator('.document-body a[rel="noopener noreferrer"]').count(), 1);
  await fits(page, 'Long tables/code stay inside 390x844 reader');
  checks.push('HTML/images/scripts remain text and unsafe links cannot execute');
  await page.setViewportSize({ width: 1280, height: 900 });
  await fits(page, '1280px desktop list/reader have no page overflow'); await snapshot(page, 'desktop');
  failedRead = true; await page.locator('[data-document-id="' + merchantId + '"]').click();
  await page.getByText('Test read unavailable', { exact: true }).waitFor(); failedRead = false;
  await page.locator('#document').getByRole('button', { name: 'Try again' }).click(); await page.waitForSelector('.document-body');
  checks.push('Document failure and retry recover');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('abl:auth-expired')));
  assert.equal(await page.locator('.document-body').count(), 0); assert.equal(await page.locator('.doc-card').count(), 0);
  assert.match(await page.locator('#document').textContent(), /Session ended/);
  checks.push('Session expiry clears catalog and open private content');
  failedCatalog = true; await page.reload(); await page.getByText('Test connection unavailable', { exact: true }).waitFor(); failedCatalog = false;
  await page.locator('#catalog').getByRole('button', { name: 'Try again' }).click(); await page.waitForSelector('.doc-card');
  checks.push('Catalog failure and retry recover');
  delayedId = merchantId; await page.locator('[data-document-id="' + delayedId + '"]').click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('abl:auth-expired'))); await page.waitForTimeout(500);
  assert.equal(await page.locator('.document-body').count(), 0);
  checks.push('Late document response after expiry cannot restore private content'); delayedId = '';
  await page.goto(base + '/entry-fixture'); await page.waitForSelector('#drawerKnowledgeButton');
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('abl:drawer-rendered'));
    document.dispatchEvent(new CustomEvent('abl:profile-state'));
  });
  assert.equal(await page.locator('#drawerKnowledgeButton').count(), 1);
  assert.equal(await page.locator('#accountHomeKnowledge').count(), 1);
  await page.locator('#drawerKnowledgeButton').click(); await page.waitForSelector('.doc-card');
  checks.push('Shell entry points deduplicate and open the canonical portal');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/knowledge?document=BL-NOT-AUTHORIZED');
  await page.getByText('This document is not available for your current account access.', { exact: true }).waitFor();
  assert.equal(await page.locator('#backToList').isVisible(), true);
  checks.push('Unavailable bookmarked document remains clear and recoverable on mobile');
  loggedIn = false; await page.reload(); await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
  assert.equal(await page.locator('.doc-card').count(), 0);
  checks.push('Signed-out browser shows sign-in direction without private metadata');
  assert.deepEqual(errors, []);
  const result = { revision: process.env.KNOWLEDGE_BROWSER_REVISION || null, status: 'PASS', checks, page_errors: errors,
    scope: 'Synthetic module/browser fixtures; full-gateway Preview and Production acceptance remain required.' };
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
