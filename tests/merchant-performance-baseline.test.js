import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const merchantUi=read('public/v03.js');
const accountingUi=read('public/business-accounting-ui.js');
const loader=read('public/mobile-feature-loader.js');
const ordersUi=read('public/orders-ui.js');
const marketplaceUi=read('public/marketplace-ui.js');
const suppliersUi=read('public/suppliers-ui.js');
const deliveryUi=read('public/delivery-ui.js');
const qa=read('qa-acceptance.js');
const server=read('server-business-accounting.js');
const core=read('merchant-today-core.js');

test('Merchant cold profile state loads Today and reuses its workspace metadata',()=>{
  assert.match(merchantUi,/document\.addEventListener\('abl:profile-state',event=>\{/);
  assert.match(merchantUi,/if\(isMerchantBaseActive\(\)\)loadMerchantToday\(\)\.catch/);
  assert.match(merchantUi,/merchantTodayPromise=api\('\/api\/merchant\/today'\)/);
  assert.match(merchantUi,/BusinessLifeMerchantToday=Object\.freeze/);
  assert.match(merchantUi,/workspace:data\.workspace\|\|null/);

  assert.match(accountingUi,/document\.addEventListener\('abl:profile-state',event=>bootAccountingWorkspace/);
  assert.match(accountingUi,/if\(role==='merchant'\)\{/);
  assert.match(accountingUi,/BusinessLifeMerchantToday\?\.getState\?\.\(\)\?\.workspace/);
  assert.match(accountingUi,/if\(cached\)applyWorkspaceState\(cached\)/);
  assert.match(accountingUi,/if\(event\.detail\?\.workspace\)applyWorkspaceState/);

  const bootStart=accountingUi.indexOf('async function bootAccountingWorkspace');
  const bootEnd=accountingUi.indexOf("document.addEventListener('abl:profile-state'",bootStart);
  const boot=accountingUi.slice(bootStart,bootEnd);
  const merchantStart=boot.indexOf("if(role==='merchant')");
  const supplierFetch=boot.indexOf("api('/api/accounting/workspaces')");
  assert.ok(merchantStart>=0&&supplierFetch>merchantStart,'Merchant must return before Supplier workspace fetch');

  assert.match(loader,/loadAccountingForRole\(role,surface='account'\)/);
  assert.match(loader,/surface!=='profile'\|\|!\['merchant','supplier'\]\.includes/);
});

test('Merchant Today keeps deep finance stock history and analysis deferred by tab intent',()=>{
  const start=merchantUi.indexOf('async function loadMerchantView');
  const end=merchantUi.indexOf('async function loadSummary',start);
  const block=merchantUi.slice(start,end);
  assert.match(block,/if\(name==='Dashboard'\)return loadMerchantToday\(\)/);
  assert.match(block,/if\(name==='Money'\)/);
  assert.match(block,/loadDay\(\)/);
  assert.match(block,/loadRemittances\(\)/);
  assert.match(block,/loadAnalysis\(7\)/);
  assert.match(block,/loadAnalysis\(30\)/);
  assert.match(block,/if\(name==='Stock'\)return loadStock\(\)/);
  assert.match(block,/if\(name==='History'\)return loadTransactions\(\)/);
});

test('Orders Catalog Suppliers and Delivery do not fetch Merchant domain data on profile-state decoration',()=>{
  const sources=[
    ['orders',ordersUi],
    ['marketplace',marketplaceUi],
    ['suppliers',suppliersUi],
    ['delivery',deliveryUi]
  ];
  for(const [name,source] of sources){
    const eventIndex=source.lastIndexOf("abl:profile-state");
    assert.ok(eventIndex>=0,name+' must observe profile state');
    const tail=source.slice(eventIndex);
    assert.doesNotMatch(tail,/\/api\/orders\/merchant\/list/);
    assert.doesNotMatch(tail,/\/api\/merchant\/storefront/);
    assert.doesNotMatch(tail,/\/api\/procurement\/orders/);
    assert.doesNotMatch(tail,/\/api\/delivery\/merchant/);
  }
});

test('canonical Merchant baseline records switch Today and workspace timing separately',()=>{
  assert.match(qa,/MERCHANT_PERFORMANCE_BASELINE_WAVE='merchant_performance_baseline_v1'/);
  assert.match(qa,/first_open_request_count:3/);
  assert.match(qa,/profile_switch_request_count:1/);
  assert.match(qa,/critical_parallel_request_count:2/);
  assert.match(qa,/merchant_today_ms/);
  assert.match(qa,/merchant_today_payload_bytes/);
  assert.match(qa,/accounting_workspaces_ms/);
  assert.match(qa,/accounting_workspaces_payload_bytes/);
  assert.match(qa,/full_profile_ready_ms/);
  assert.match(qa,/deep_views_deferred:true/);
});


test('Merchant Today critical finance uses one slim query and excludes deep finance authorities',()=>{
  const start=core.indexOf('async function merchantTodayFinanceSnapshot');
  const end=core.indexOf('export async function loadMerchantToday',start);
  const block=core.slice(start,end);
  assert.equal((block.match(/pool\.query\(/g)||[]).length,1);
  assert.match(block,/completed_merchandise_value/);
  assert.match(block,/confirmed_merchandise_received/);
  assert.match(block,/completed_receivables/);
  assert.match(block,/business_expenses/);
  assert.doesNotMatch(block,/profileFinanceContext|allocationStatus|chargedFeeSummary|merchantPayables|profitability/);
});

test('Merchant Today response carries the active workspace list from canonical accounting context',()=>{
  const start=server.indexOf("app.get('/api/merchant/today'");
  const end=server.indexOf("app.get('/api/summary'",start);
  const block=server.slice(start,end);
  assert.match(block,/const today=await loadMerchantToday\(pool,ctx\)/);
  assert.match(block,/workspace:\{/);
  assert.match(block,/active_business_id:Number\(ctx\.business\.id\)/);
  assert.match(block,/businesses:ctx\.businesses\.map/);
  assert.doesNotMatch(block,/businessFinanceOverview/);
});

test('post-optimization Merchant acceptance models two cold-start requests',()=>{
  assert.match(qa,/MERCHANT_PERFORMANCE_RUNTIME_WAVE='merchant_performance_runtime_v1'/);
  assert.match(qa,/first_open_request_count:2/);
  assert.match(qa,/critical_request_count:1/);
  assert.match(qa,/workspace_metadata_reused:true/);
  assert.match(qa,/full_finance_overview_deferred:true/);
});
