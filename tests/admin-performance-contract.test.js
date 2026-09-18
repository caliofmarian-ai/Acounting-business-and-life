import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing contract block '+start);
  return source.slice(a,b);
}

test('Admin overview resolves assignments and territory tree once per request',()=>{
  assert.match(server,/async function buildAdminScopeContext/);
  assert.match(server,/function scopeFromContext/);
  assert.match(server,/function unionScopeFromContext/);
  const overview=between(server,'async function adminOverview','async function forwardAdmin');
  assert.match(overview,/buildAdminScopeContext/);
  assert.doesNotMatch(overview,/visibleTerritoryIds/);
  assert.doesNotMatch(overview,/isCountryWide/);
  assert.doesNotMatch(overview,/scopeClause\(/);
});

test('independent Admin queue families run in parallel',()=>{
  const overview=between(server,'async function adminOverview','async function forwardAdmin');
  assert.match(overview,/Promise\.all\(applicationTasks\)/);
  assert.match(overview,/Promise\.all\(invitationTasks\)/);
  assert.match(overview,/Promise\.all\(authorizationTasks\)/);
  assert.match(overview,/adminSummaryFromContext/);
});

test('Admin metrics uses the scoped summary path instead of rebuilding full overview',()=>{
  const metrics=between(server,"app.get('/api/admin/metrics'","app.post('/api/admin/metrics/snapshot'");
  assert.match(metrics,/adminSummaryFromContext/);
  assert.doesNotMatch(metrics,/adminOverview\(/);
});

test('Admin console boot uses one composite request while legacy endpoints remain available',()=>{
  assert.match(server,/app\.get\('\/api\/admin\/bootstrap'/);
  assert.match(server,/app\.get\('\/api\/admin\/me'/);
  assert.match(server,/app\.get\('\/api\/admin\/catalog'/);
  assert.match(server,/app\.get\('\/api\/admin\/overview'/);
  assert.match(ui,/api\('\/api\/admin\/bootstrap'\)/);
  const loadBase=between(ui,'async function loadBase','async function boot');
  assert.doesNotMatch(loadBase,/Promise\.all\(\[api\('\/api\/admin\/me'/);
});
