import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/orders-ui.js',import.meta.url);
const serverUrl=new URL('../server-orders.js',import.meta.url);
const cssUrl=new URL('../public/orders.css',import.meta.url);
const accountingUrl=new URL('../public/business-accounting-ui.js',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');
const server=readFileSync(serverUrl,'utf8');
const css=readFileSync(cssUrl,'utf8');
const accounting=readFileSync(accountingUrl,'utf8');

for(const [label,url] of [['Orders UI',uiUrl],['Orders server',serverUrl]]){
  test(label+' has valid JavaScript syntax',()=>{
    const r=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr||r.stdout);
  });
}

test('Merchant Orders resolves the canonical active business instead of hardcoding business 1',()=>{
  assert.match(accounting,/window\.BusinessLifeAccounting=Object\.freeze/);
  assert.match(accounting,/activeBusinessId:accountingState\.activeBusinessId/);
  assert.match(ui,/BusinessLifeAccounting\?\.getState/);
  assert.match(ui,/\/api\/accounting\/workspaces/);
  assert.match(ui,/active_business_id/);
  assert.match(ui,/merchantBusinessId=id/);
  assert.match(ui,/business_id=\$\{encodeURIComponent\(businessId\)\}/);
  assert.match(ui,/business_id:merchantBusinessId/);
  assert.doesNotMatch(ui,/business_id=1/);
  assert.doesNotMatch(ui,/business_id:1/);
});

test('Orders server snapshots only products from the requested business',()=>{
  assert.match(server,/FROM products WHERE business_id=\$1 AND id=ANY\(\$2::bigint\[\]\)/);
  assert.match(server,/One or more products are unavailable for this business/);
  assert.match(server,/i\.business_id=\$2/);
});

test('counter-order product list is private to the selected Merchant business',()=>{
  assert.match(server,/\/api\/orders\/products'[\s\S]*requireMerchant\(req,businessId\)/);
  assert.match(server,/WHERE p\.business_id=\$1 AND p\.active=TRUE/);
  assert.match(server,/A valid business_id is required/);
  assert.doesNotMatch(server,/Customer or Merchant profile required/);
  assert.doesNotMatch(server,/if\(businessId!==1\) return res\.json\(\[\]\)/);
});

test('Orders boards do not use timer polling',()=>{
  assert.doesNotMatch(ui,/setInterval\(/);
  assert.match(ui,/data-orders-refresh/);
  assert.match(ui,/visibilitychange/);
  assert.match(ui,/refreshVisibleOrders/);
});

test('business switching refreshes an already-open Merchant Orders workspace',()=>{
  assert.match(ui,/abl:business-workspace-changed/);
  assert.match(ui,/merchantBusinessId=id;productsCache=\[\]/);
  assert.match(ui,/ordersMode==='merchant'&&ordersVisible\(\)/);
});

test('Merchant Orders has a retryable full-workspace load error',()=>{
  assert.match(ui,/function merchantOrdersError/);
  assert.match(ui,/role="alert"/);
  assert.match(ui,/data-orders-retry/);
  assert.match(ui,/Try again/);
});

test('Orders module exposes stable open actions for the Merchant Today shell',()=>{
  assert.match(ui,/window\.BusinessLifeOrders=Object\.freeze\(\{openMerchantOrders,openCustomerOrders,closeOrders\}\)/);
});


test('Merchant Orders mobile UI keeps readable type and comfortable touch targets',()=>{
  assert.match(css,/\.ordersBack\{[^}]*width:44px;[^}]*height:44px/);
  assert.match(css,/\.ordersHeader \.ordersRefresh\{[^}]*min-height:44px;[^}]*font-size:13px/);
  assert.match(css,/\.orderCreateCard input,\.orderCreateCard select,\.orderCreateCard textarea\{[^}]*font-size:16px;[^}]*min-height:44px/);
  assert.match(css,/\.orderActions button\{[^}]*min-height:44px;[^}]*font-size:12px/);
  assert.match(css,/\.customerOrderFooter button\{[^}]*min-height:44px;[^}]*font-size:12px/);
});

test('Merchant Orders protects narrow mobile layouts from accidental overflow',()=>{
  assert.match(css,/\.ordersWorkspace\{[^}]*overflow-x:hidden/);
  assert.match(css,/\.orderCardMain,\.ordersHeaderCopy,\.counterProduct>div\{min-width:0\}/);
  assert.match(css,/overflow-wrap:anywhere/);
});


test('Merchant Orders reuses the cached accounting business before requesting workspace state',()=>{
  const resolverStart=ui.indexOf('async function resolveMerchantBusiness');
  const resolverEnd=ui.indexOf('function merchantOrdersError',resolverStart);
  const resolver=ui.slice(resolverStart,resolverEnd);
  assert.ok(resolverStart>=0&&resolverEnd>resolverStart);
  assert.ok(resolver.indexOf('BusinessLifeAccounting?.getState')<resolver.indexOf("oapi('/api/accounting/workspaces')"));
});
