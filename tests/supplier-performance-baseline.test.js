import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const supplierUi=read('public/suppliers-ui.js');
const accountingUi=read('public/business-accounting-ui.js');
const loader=read('public/mobile-feature-loader.js');
const qa=read('qa-acceptance.js');

test('Supplier profile switch keeps data-light hub decoration and loads Accounting workspace in background',()=>{
  const decorateStart=supplierUi.indexOf('async function decorateSupplier');
  const decorateEnd=supplierUi.indexOf('function observeSupplier',decorateStart);
  const decorate=supplierUi.slice(decorateStart,decorateEnd);
  assert.doesNotMatch(decorate,/papi\('/);

  assert.match(loader,/loadAccountingForRole\(role,surface='account'\)/);
  assert.match(loader,/\['merchant','supplier'\]/);
  assert.match(accountingUi,/const workspaceState=await api\('\/api\/accounting\/workspaces'\)/);
});

test('Supplier Today currently loads four parallel sources before rendering only Today state',()=>{
  const start=supplierUi.indexOf('async function renderSupplierWorkspace');
  const end=supplierUi.indexOf('function poCardSupplier',start);
  const block=supplierUi.slice(start,end);
  assert.match(block,/Promise\.all\(\[/);
  for(const path of [
    '/api/supplier/me',
    '/api/procurement/relationships',
    '/api/procurement/orders',
    '/api/supplier/v5/today'
  ])assert.ok(block.includes(path),path+' must be present in the current Supplier Today load');
  assert.match(block,/if\(normalized==='Today'\)body=supplierTodayPanel\(todayState\)/);
});

test('Supplier Today endpoint already owns critical business action and Money evidence',()=>{
  assert.match(supplierUi,/function supplierTodayPanel/);
  assert.match(supplierUi,/function supplierMoneyPanel/);
  assert.match(supplierUi,/todayState/);
});

test('canonical Supplier performance baseline records switch and Today phases separately',()=>{
  assert.match(qa,/SUPPLIER_PERFORMANCE_BASELINE_WAVE='supplier_performance_baseline_v1'/);
  assert.match(qa,/profile_switch_request_count:2/);
  assert.match(qa,/today_request_count:4/);
  assert.match(qa,/supplier_me_ms/);
  assert.match(qa,/relationships_ms/);
  assert.match(qa,/procurement_orders_ms/);
  assert.match(qa,/supplier_today_ms/);
  assert.match(qa,/today_parallel_ms/);
  assert.match(qa,/detailed_supplier_data_loaded_on_today:true/);
});
