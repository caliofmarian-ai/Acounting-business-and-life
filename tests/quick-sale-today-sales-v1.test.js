import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {merchantTodayFinanceSnapshot,merchantTodayViewModel} from '../merchant-today-core.js';

const core=readFileSync(new URL('../merchant-today-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

const account={role:'merchant',business:{id:42,name:'Synthetic Food Merchant',currency_code:'PHP'}};
function syntheticFinance(row){
  let queries=0;
  return {pool:{async query(sql,args){
    queries+=1;
    assert.deepEqual(args,[42]);
    assert.match(sql,/FROM product_sales ps/);
    assert.match(sql,/JOIN transactions t/);
    assert.match(sql,/t\.id=ps\.transaction_id/);
    assert.match(sql,/t\.business_id=ps\.business_id/);
    assert.match(sql,/t\.source='product_sale'/);
    assert.match(sql,/t\.type='sale'/);
    assert.match(sql,/t\.source_id=ps\.id/);
    assert.match(sql,/WHERE ps\.business_id=\$1/);
    assert.match(sql,/FROM order_finance CROSS JOIN quick_sale_finance CROSS JOIN ledger/);
    assert.doesNotMatch(sql,/prepared_product_removals|INSERT INTO|UPDATE transactions/);
    return{rows:[{merchant_domain:'food',publication_status:'published',business_expenses:0,...row}]};
  }},getQueries:()=>queries};
}
test('Merchant Today counts completed orders and exactly linked Quick Sales, never two cash copies',async()=>{
  const fixture=syntheticFinance({
    completed_merchandise_value:'250.00',confirmed_merchandise_received:'200.00',
    completed_receivables:'50.00',completed_quick_sale_value:'720.00',
    confirmed_quick_sale_received:'720.00',quick_sale_portions:'9'
  });
  const finance=await merchantTodayFinanceSnapshot(fixture.pool,account);
  assert.equal(fixture.getQueries(),1);
  assert.deepEqual(finance.commercial,{completed_merchandise_value:970});
  assert.deepEqual(finance.cash_evidence,{confirmed_merchandise_received:920});
  assert.deepEqual(finance.receivables,{completed_customer_receivables:50});
  assert.deepEqual(finance.sources,{
    completed_order_value:250,quick_sale_value:720,quick_sale_portions:9,
    confirmed_order_received:200,confirmed_quick_sale_received:720
  });
  const model=merchantTodayViewModel({business:account.business,presentation:finance.presentation,finance});
  assert.equal(model.money.completed_sales,970);
  assert.equal(model.money.confirmed_received,920);
  assert.equal(model.money.awaiting_payment,50);
  assert.equal(model.money.sources.quick_sale_portions,9);
  assert.match(model.authority.money,/order value is never treated as cash/);
});
test('Rejected 409 attempts and two owner meals cannot inflate sale count or cash receipts',async()=>{
  // The aggregate only selects accepted persisted and linked sale rows;
  // rejected attempts and non-sale prepared removals have no product_sales row.
  const fixture=syntheticFinance({
    completed_merchandise_value:0,confirmed_merchandise_received:0,completed_receivables:0,
    completed_quick_sale_value:240,confirmed_quick_sale_received:240,quick_sale_portions:3
  });
  const finance=await merchantTodayFinanceSnapshot(fixture.pool,account);
  assert.equal(finance.sources.quick_sale_portions,3);
  assert.equal(finance.commercial.completed_merchandise_value,240);
  assert.equal(finance.cash_evidence.confirmed_merchandise_received,240);
  assert.doesNotMatch(core,/quick_sale_portions[^\n]*prepared_product_removals/);
});
test('Quick Sale and zero-orders Merchant view preserve separate sources and unchanged receivables',async()=>{
  const finance=await merchantTodayFinanceSnapshot(syntheticFinance({
    completed_merchandise_value:0,confirmed_merchandise_received:0,completed_receivables:0,
    completed_quick_sale_value:0,confirmed_quick_sale_received:0,quick_sale_portions:0
  }).pool,account);
  const model=merchantTodayViewModel({business:account.business,finance});
  assert.equal(model.money.completed_sales,0);
  assert.equal(model.money.confirmed_received,0);
  assert.equal(model.money.awaiting_payment,0);
});
test('Today shows actual Quick Sale contribution and history has explicit loading/Retry accessibility',()=>{
  assert.match(html,/id="todaySalesSources"/);
  assert.match(html,/id="productSaleList"[^>]*aria-live="polite"/);
  assert.match(ui,/Quick Sale .*portion\(s\)/);
  assert.match(ui,/Loading recent Quick Sales/);
  assert.match(ui,/No Quick Sale records for this business yet/);
  assert.match(ui,/Retry sales history/);
  assert.match(ui,/cache:'no-store'/);
  assert.match(ui,/if\(name==='Sell'\)return Promise\.all\(\[loadStock\(\),loadProducts\(\),loadProductSales\(\)/);
});

function browserHarness(resolver){
  const first=ui.indexOf('async function loadProductSales(){');
  const end=ui.indexOf('function profitRows(',first);
  assert.ok(first>0&&end>first,'Real Quick Sale loader must be available');
  const history={children:[],replaceChildren(...nodes){this.children=nodes}};
  let current=true;
  const calls=[];
  const context={
    document:{createElement(tag){return{tagName:tag.toUpperCase(),listeners:{},addEventListener(name,fn){this.listeners[name]=fn}}}},
    $:id=>id==='productSaleList'?history:null,
    merchantReadGuard:()=>()=>current,
    api:(path,options,guard)=>{calls.push({path,options,guard});return resolver(calls.length)},
    emptyRow:text=>({textContent:text}),
    esc:val=>String(val),
    num:val=>String(val),
    money:val=>'₱'+Number(val||0).toFixed(2),
    accountLabel:String,
    console
  };
  vm.createContext(context);
  vm.runInContext('let productSalesHistoryGeneration=0;\n'+ui.slice(first,end)+'\nthis.loadSales=loadProductSales;',context);
  return {history,calls,loadSales:()=>context.loadSales(),switchBusiness:()=>{current=false}};
}

const row=name=>[{
  quantity:1,product_name_snapshot:name,revenue:80,
  gross_profit:11.58,estimated_cogs:68.42,account:'cash'
}];
test('Sales list ignores stale in-flight requests and does not cache old Merchant results',async()=>{
  let resolveFirst;
  const held=new Promise(resolve=>resolveFirst=resolve);
  const h=browserHarness(index=>index===1?held:Promise.resolve(row('Current business')));
  const first=h.loadSales(),second=h.loadSales();
  await second;
  resolveFirst(row('Older response'));
  await first;
  assert.equal(h.calls[0].path,'/api/product-sales');
  assert.equal(h.calls[0].options.cache,'no-store');
  assert.match(h.history.children[0].innerHTML,/Current business/);
  assert.doesNotMatch(h.history.children[0].innerHTML,/Older response/);
});
test('History failure is visible with a Retry control and keeps business context',async()=>{
  const h=browserHarness(()=>Promise.reject(new Error('Synthetic offline error')));
  await h.loadSales();
  assert.match(h.history.children[0].textContent,/could not be loaded/);
  assert.equal(h.history.children[1].textContent,'Retry sales history');
  assert.equal(typeof h.history.children[1].listeners.click,'function');
  const older=browserHarness(()=>new Promise(resolve=>{}));
  older.loadSales();
  older.switchBusiness();
  assert.doesNotMatch(String(older.history.children[0].textContent),/Older merchant sale/);
});
