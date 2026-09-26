import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');

test('Admin bootstrap uses a slim home overview instead of deep governance overview',()=>{
  const start=server.indexOf("app.get('/api/admin/bootstrap'");
  const end=server.indexOf("app.get('/api/admin/overview'",start);
  const block=server.slice(start,end);
  assert.match(block,/adminHomeOverview\(me\.account\.id,ctx\)/);
  assert.doesNotMatch(block,/adminOverview\(me\.account\.id,ctx\)/);
});

test('Admin home summary keeps urgent operational counts and defers business metrics',()=>{
  const start=server.indexOf('async function adminHomeSummaryFromContext');
  const end=server.indexOf('async function adminHomeOverview',start);
  const block=server.slice(start,end);
  assert.match(block,/priority='urgent'/);
  assert.match(block,/status IN \('submitted','under_review'\)/);
  assert.match(block,/pending_applications/);
  assert.match(block,/incident_reports/);
  assert.doesNotMatch(block,/FROM orders|FROM deliveries|FROM service_jobs/);
  assert.match(block,/orders:null,deliveries:null,service_jobs:null/);
});

test('Admin home overview preserves scoped territories and avoids full governance rows',()=>{
  const start=server.indexOf('async function adminHomeOverview');
  const end=server.indexOf('async function adminSummaryFromContext',start);
  const block=server.slice(start,end);
  assert.match(block,/scopeFromContext\(ctx,'admin.console','territory_id'\)/);
  assert.match(block,/detail_mode:'home'/);
  assert.doesNotMatch(block,/LIMIT 150|LIMIT 100|profile_invitations|profile_authorizations/);
});

test('Full Admin governance overview remains available for explicit Profiles intent',()=>{
  const start=server.indexOf('async function adminOverview');
  const end=server.indexOf('function dispatchBusinessAccounting',start);
  const block=server.slice(start,end);
  assert.match(block,/LIMIT 150/);
  assert.match(block,/LIMIT 100/);
  assert.match(server,/app\.get\('\/api\/admin\/overview'/);
  assert.match(ui,/async function ensureAdminOverviewDetail/);
  assert.match(ui,/api\('\/api\/admin\/overview'\)/);
  assert.match(ui,/active==='profiles'\)\{await ensureAdminOverviewDetail\(\)/);
});

test('Admin first open remains a single bootstrap request and deep finance audit queues stay intent-driven',()=>{
  const start=ui.indexOf('async function loadBase');
  const end=ui.indexOf('async function boot',start);
  const block=ui.slice(start,end);
  assert.match(block,/api\('\/api\/admin\/bootstrap'\)/);
  assert.doesNotMatch(block,/\/api\/admin\/overview|\/api\/admin\/audit|\/api\/admin\/finance|\/api\/admin\/support|\/api\/admin\/incidents/);
});
