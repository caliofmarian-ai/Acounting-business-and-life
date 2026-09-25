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

test('Merchant cold profile state loads Today and workspace metadata only',()=>{
  assert.match(merchantUi,/document\.addEventListener\('abl:profile-state',event=>\{/);
  assert.match(merchantUi,/if\(isMerchantBaseActive\(\)\)loadMerchantToday\(\)\.catch/);
  assert.match(merchantUi,/merchantTodayPromise=api\('\/api\/merchant\/today'\)/);

  assert.match(accountingUi,/document\.addEventListener\('abl:profile-state',event=>bootAccountingWorkspace/);
  assert.match(accountingUi,/const workspaceState=await api\('\/api\/accounting\/workspaces'\)/);

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
