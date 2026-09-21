import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {merchantTodayViewModel} from '../merchant-today-core.js';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/v03.css',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../merchant-today-core.js',import.meta.url),'utf8');

test('Merchant Today keeps cash evidence separate from completed sales',()=>{
  const vm=merchantTodayViewModel({
    business:{id:7,name:'Test',currency_code:'PHP'},
    presentation:{merchant_domain:'non_food'},
    finance:{
      business:{currency_code:'PHP'},
      cash_evidence:{confirmed_merchandise_received:120},
      commercial:{completed_merchandise_value:350},
      receivables:{completed_customer_receivables:230},
      ledger:{business_expenses:40}
    }
  });
  assert.equal(vm.money.confirmed_received,120);
  assert.equal(vm.money.completed_sales,350);
  assert.equal(vm.money.awaiting_payment,230);
  assert.notEqual(vm.money.confirmed_received,vm.money.completed_sales);
  assert.match(vm.authority.money,/order value is never treated as cash/i);
});

test('non-food Merchant never receives recipe attention',()=>{
  const vm=merchantTodayViewModel({
    business:{id:9,name:'Shop'},
    presentation:{merchant_domain:'non_food'},
    catalogRow:{recipe_attention:5,unpublished:1}
  });
  assert.equal(vm.presentation.food_modules_enabled,false);
  assert.equal(vm.catalog.recipe_attention,0);
});

test('Today loads independent evidence in parallel and scopes every source to active business',()=>{
  assert.match(core,/await Promise\.all\(\[/);
  assert.match(core,/WHERE business_id=\$1/);
  assert.match(core,/FROM inventory WHERE business_id=\$1/);
  assert.match(core,/FROM purchase_orders WHERE business_id=\$1/);
  assert.match(core,/FROM supplier_rfqs WHERE business_id=\$1/);
  assert.match(core,/WHERE p\.business_id=\$1/);
  assert.match(server,/app\.get\('\/api\/merchant\/today'/);
  assert.match(server,/loadMerchantToday\(pool,ctx/);
});

test('Merchant opens on Today with five primary actions',()=>{
  assert.match(html,/id="viewDashboard" class="view merchantTodayView"/);
  assert.match(html,/merchantPrimaryNav/);
  for(const label of ['Today','Orders','Catalog','Inventory','Money'])assert.match(html,new RegExp('>'+label+'<'));
  assert.doesNotMatch(html,/class="bottomNav navSix"/);
});

test('Today has explicit loading, error, retry and empty evidence states',()=>{
  for(const id of ['todayLoading','todayError','todayRetry','todayContent'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/function merchantTodayLoading\(/);
  assert.match(ui,/function merchantTodayError\(/);
  assert.match(ui,/todayEmpty/);
  assert.match(ui,/loadMerchantToday\(\{force:true\}\)/);
});

test('Today does not call legacy refreshAll or introduce polling',()=>{
  const todayStart=ui.indexOf('let merchantTodayCache');
  const todayEnd=ui.indexOf('async function loadSummary',todayStart);
  const todayBlock=ui.slice(todayStart,todayEnd);
  assert.doesNotMatch(todayBlock,/refreshAll/);
  assert.doesNotMatch(todayBlock,/setInterval\s*\(/);
  assert.doesNotMatch(todayBlock,/setTimeout\s*\([^,]+,\s*(8000|10000)/);
});

test('Today actions reuse canonical Orders, Catalog and Suppliers workspaces',()=>{
  assert.match(ui,/BusinessLifeOrders\?\.openMerchantOrders/);
  assert.match(ui,/BusinessLifeMarketplace\?\.openMerchantStore/);
  assert.match(ui,/BusinessLifeSuppliers\?\.openMerchantProcurement/);
});

test('390px mobile contract protects touch targets and overflow',()=>{
  assert.match(css,/\.merchantTodayView\{[^}]*overflow-x:hidden/);
  assert.match(css,/\.todayPrimaryAction\{[^}]*min-height:44px/);
  assert.match(css,/\.merchantPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test('Money advanced actions preserve manual ledger and History without making them primary tabs',()=>{
  assert.match(html,/Manual ledger/);
  assert.match(html,/History/);
  const nav=html.slice(html.indexOf('<nav class="bottomNav merchantPrimaryNav"'),html.indexOf('</nav>',html.indexOf('<nav class="bottomNav merchantPrimaryNav"')));
  assert.doesNotMatch(nav,/Manual ledger/);
  assert.doesNotMatch(nav,/History/);
});
