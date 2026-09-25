import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const supplierUi=read('public/suppliers-ui.js');
const supplierServer=read('server-supplier-daily-v5.js');
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

test('Supplier Today cold render now pays for one critical endpoint only',()=>{
  const start=supplierUi.indexOf('async function renderSupplierWorkspace');
  const end=supplierUi.indexOf('function poCardSupplier',start);
  const block=supplierUi.slice(start,end);
  const todayStart=block.indexOf("if(normalized==='Today')");
  const moneyStart=block.indexOf("}else if(normalized==='Money')",todayStart);
  const todayBlock=block.slice(todayStart,moneyStart);
  assert.match(todayBlock,/papi\('\/api\/supplier\/v5\/today'\)/);
  for(const path of ['/api/supplier/me','/api/procurement/relationships','/api/procurement/orders']){
    assert.ok(!todayBlock.includes(path),path+' must stay deferred from Supplier Today');
  }
});

test('Supplier Money pays for receivable detail only after explicit Money intent',()=>{
  const start=supplierUi.indexOf("}else if(normalized==='Money')");
  const end=supplierUi.indexOf("}else if(normalized==='Catalog')",start);
  const moneyBlock=supplierUi.slice(start,end);
  assert.match(moneyBlock,/\/api\/supplier\/v5\/today\?view=money/);
  assert.match(supplierUi,/today\?\.money_orders/);
  assert.match(supplierUi,/p\.receivable_overdue/);
});

test('Supplier Today endpoint returns projected active queues instead of full PO history and full catalog',()=>{
  assert.doesNotMatch(supplierServer,/SELECT\s+p\.\*/);
  assert.match(supplierServer,/p\.status NOT IN \('cancelled','rejected','received'\)/);
  assert.match(supplierServer,/LIMIT 60/);
  assert.match(supplierServer,/availability_status IN \('limited','unavailable'\)/);
  assert.match(supplierServer,/LIMIT 40/);
  assert.match(supplierServer,/COUNT\(\*\) OVER\(\)::int queue_total/);
  assert.match(supplierServer,/detail_mode:moneyView\?'money':'today'/);
  assert.match(supplierServer,/money_orders:moneyView\?moneyOrders:undefined/);
});

test('Supplier Today keeps finance headline aggregate while detailed receivable rows are deferred',()=>{
  assert.match(supplierServer,/receivable_total/);
  assert.match(supplierServer,/overdue_receivable_total/);
  assert.match(supplierServer,/merchant_balances/);
  assert.match(supplierServer,/money_received_recorded/);
  assert.match(supplierServer,/async function supplierMoneyOrders/);
  assert.match(supplierServer,/WHERE commercial_outstanding>0/);
});

test('canonical Supplier performance baseline remains recorded for before/after comparison',()=>{
  assert.match(qa,/SUPPLIER_PERFORMANCE_BASELINE_WAVE='supplier_performance_baseline_v1'/);
  assert.match(qa,/profile_switch_request_count:2/);
  assert.match(qa,/today_request_count:4/);
  assert.match(qa,/supplier_me_ms/);
  assert.match(qa,/relationships_ms/);
  assert.match(qa,/procurement_orders_ms/);
  assert.match(qa,/supplier_today_ms/);
  assert.match(qa,/detailed_supplier_data_loaded_on_today:true/);
});

test('Supplier performance runtime acceptance enforces deferred deep data',()=>{
  assert.match(qa,/SUPPLIER_PERFORMANCE_RUNTIME_WAVE='supplier_performance_runtime_v1'/);
  assert.match(qa,/today_request_count:1/);
  assert.match(qa,/detailed_supplier_data_loaded_on_today:false/);
  assert.match(qa,/full_po_history_deferred:true/);
  assert.match(qa,/catalog_detail_deferred:true/);
  assert.match(qa,/deep_finance_deferred:true/);
});
