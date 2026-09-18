import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

const shell=read('public/shell.js');
const app=read('public/app.js');
const help=read('public/help-linking.js');
const adminCss=read('public/admin-console.css');
const adminUi=read('public/admin-console.js');
const adminServer=read('server-admin-operations.js');
const loader=read('public/mobile-feature-loader.js');
const legacyAdmin=read('public/admin-operations-ui.js');

const roleModules={
  services:read('public/services-ui.js'),
  delivery:read('public/delivery-ui.js'),
  suppliers:read('public/suppliers-ui.js'),
  marketplace:read('public/marketplace-ui.js'),
  orders:read('public/orders-ui.js')
};

test('Slice A remains reconciled: one canonical profile-state owner and no identity polling loops',()=>{
  assert.match(shell,/BusinessLifeProfileState/);
  assert.match(shell,/publishProfileState/);
  assert.match(shell,/abl:profile-state/);
  for(const [name,source] of Object.entries(roleModules)){
    assert.match(source,/BusinessLifeProfileState/,name+' must consume shell profile state');
    assert.match(source,/abl:profile-state/,name+' must subscribe to profile state');
    assert.doesNotMatch(source,/setInterval\(\(\)=>decorate|setInterval\(\(\)=>decorate[A-Za-z]*/,name+' must not poll identity decorators');
  }
});

test('Slice B remains reconciled: Merchant data is isolated and normal Back never hard reloads',()=>{
  assert.match(app,/isMerchantBaseActive/);
  assert.match(app,/if\(!isMerchantBaseActive\(\)\)return/);
  assert.match(help,/accountingPath/);
  assert.match(help,/activeRole\(\)==='merchant'/);
  assert.match(shell,/BusinessLifeShell/);
  assert.match(shell,/showActiveWorkspace/);
  for(const [name,source] of Object.entries(roleModules)){
    assert.doesNotMatch(source,/location\.reload\(\)/,name+' normal navigation must stay inside the app');
    assert.match(source,/BusinessLifeShell/,name+' must restore the canonical active workspace');
  }
});

test('Slice C remains reconciled: Super Admin is switcher-only and mobile Admin nav stays compact',()=>{
  assert.match(shell,/adminProfileRow/);
  assert.match(shell,/data-admin-profile/);
  assert.doesNotMatch(loader,/lazyAdminBtn/);
  assert.doesNotMatch(loader,/fetchAdminAccess/);
  assert.doesNotMatch(legacyAdmin,/adminOpsBtn/);
  assert.match(adminCss,/grid-template-rows:auto minmax\(0,1fr\)/);
  assert.match(adminCss,/\.adminNav\{[^}]*align-items:center;[^}]*align-self:start/);
  assert.match(adminCss,/\.adminNav button\{[^}]*flex:0 0 auto;[^}]*min-height:38px/);
  assert.match(adminUi,/defaultRank=allowedRanks\.some\(r=>r\.code==='specialist'\)\?'specialist'/);
});

test('Slice D remains reconciled: Admin bootstrap and request-local scope optimization survive later Finance work',()=>{
  assert.match(adminServer,/async function buildAdminScopeContext/);
  assert.match(adminServer,/function scopeFromContext/);
  assert.match(adminServer,/async function adminSummaryFromContext/);
  assert.match(adminServer,/app\.get\('\/api\/admin\/bootstrap'/);
  assert.match(adminUi,/api\('\/api\/admin\/bootstrap'\)/);
  const metricsStart=adminServer.indexOf("app.get('/api/admin/metrics'");
  const metricsEnd=adminServer.indexOf("app.post('/api/admin/metrics/snapshot'",metricsStart);
  const metrics=adminServer.slice(metricsStart,metricsEnd);
  assert.match(metrics,/adminSummaryFromContext/);
  assert.doesNotMatch(metrics,/adminOverview\(/);
});

test('later Finance Admin additions coexist with reconciliation invariants',()=>{
  assert.match(adminUi,/Finance/);
  assert.match(adminUi,/Pricing|economics|cost/i);
  assert.match(adminServer,/finance|payment/i);
});
