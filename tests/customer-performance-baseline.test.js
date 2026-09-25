import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const qa=read('qa-acceptance.js');
const notifications=read('public/notifications-ui.js');
const ordersServer=read('server-orders.js');
const deliveryServer=read('server-delivery.js');
const servicesServer=read('server-services.js');
const paymentsServer=read('server-payments.js');
const moneyCore=read('profile-money-core.js');

test('Customer Home already loads its four domain sources in parallel',()=>{
  const start=shell.indexOf('async function loadCustomerHomeData');
  const end=shell.indexOf('function customerHomeActivities',start);
  const block=shell.slice(start,end);
  assert.match(block,/Promise\.allSettled\(\[/);
  for(const path of [
    '/api/orders/mine',
    '/api/delivery/mine',
    '/api/services/jobs/mine',
    '/api/profile-money/customer'
  ])assert.ok(block.includes(path),path+' must stay inside the parallel Customer Home load');
});

test('Customer Home has bounded cache and in-flight request deduplication',()=>{
  assert.match(shell,/const CUSTOMER_HOME_CACHE_MS=30000/);
  assert.match(shell,/customerHomeCache=\{accountId:null,data:null,loadedAt:0,promise:null\}/);
  assert.match(shell,/if\(customerHomeCache\.promise\)return customerHomeCache\.promise/);
  assert.match(shell,/Date\.now\(\)-customerHomeCache\.loadedAt<CUSTOMER_HOME_CACHE_MS/);
});

test('Customer Home renders stable loading partial-failure retry states',()=>{
  assert.match(shell,/id="customerHomeLoading"/);
  assert.match(shell,/id="customerHomeError"/);
  assert.match(shell,/id="customerHomeDynamic"/);
  assert.match(shell,/Some Home information is unavailable/);
  assert.match(shell,/data-customer-home-retry/);
  assert.match(shell,/if\(failures\.length===4\)throw new Error/);
});

test('Customer profile switch publishes state before Customer Home data settles',()=>{
  const switchStart=shell.indexOf('async function enableOrSwitch');
  const switchEnd=shell.indexOf('function hideMerchantWorkspace',switchStart);
  const switchBlock=shell.slice(switchStart,switchEnd);
  assert.match(switchBlock,/profileApi\('\/api\/me\/active-role'/);
  assert.match(switchBlock,/activeSurface = 'profile'/);
  assert.match(switchBlock,/applyActiveRole\(\)/);
  assert.match(switchBlock,/publishProfileState\(\)/);
  const customerStart=shell.indexOf('function renderCustomerHub');
  const customerEnd=shell.indexOf('const COURIER_HOME_CACHE_MS',customerStart);
  const customerBlock=shell.slice(customerStart,customerEnd);
  assert.match(customerBlock,/customerHomeLoading/);
  assert.match(customerBlock,/loadCustomerHome\(hub\)\.catch/);
});

test('global notification unread refresh is independent from Customer Home domain load',()=>{
  assert.match(notifications,/refreshUnread\(\)/);
  assert.match(notifications,/\/api\/notifications\/unread-count\?threaded=all/);
  const home=shell.slice(shell.indexOf('async function loadCustomerHomeData'),shell.indexOf('function customerHomeActivities'));
  assert.doesNotMatch(home,/\/api\/notifications/);
});

test('canonical Customer performance baseline records switch parallel paths timing and payload',()=>{
  assert.match(qa,/CUSTOMER_PERFORMANCE_BASELINE_WAVE='customer_performance_baseline_v1'/);
  assert.match(qa,/first_open_request_count:5/);
  assert.match(qa,/profile_switch_request_count:1/);
  assert.match(qa,/parallel_home_request_count:4/);
  assert.match(qa,/profile_switch_ms/);
  assert.match(qa,/home_parallel_ms/);
  assert.match(qa,/full_profile_ready_ms/);
  assert.match(qa,/orders_payload_bytes/);
  assert.match(qa,/delivery_payload_bytes/);
  assert.match(qa,/services_payload_bytes/);
  assert.match(qa,/money_payload_bytes/);
});


test('optimized Customer Home requests slim domain views without changing detailed screens',()=>{
  const start=shell.indexOf('async function loadCustomerHomeData');
  const end=shell.indexOf('function customerHomeActivities',start);
  const block=shell.slice(start,end);
  for(const path of [
    '/api/orders/mine?view=home',
    '/api/delivery/mine?view=home',
    '/api/services/jobs/mine?view=home',
    '/api/profile-money/customer?view=home'
  ])assert.ok(block.includes(path),path+' must be the Customer Home read');
  assert.match(block,/Promise\.allSettled\(\[/);
});

test('Orders Home view returns active work plus only three recent completed summaries',()=>{
  const routeStart=ordersServer.indexOf("app.get('/api/orders/mine'");
  const homeStart=ordersServer.indexOf("if(String(req.query.view||'')==='home')",routeStart);
  const homeEnd=ordersServer.indexOf("\n  const{rows}=await pool.query",homeStart);
  const home=ordersServer.slice(homeStart,homeEnd);
  assert.match(home,/String\(req\.query\.view\|\|''\)==='home'/);
  assert.match(home,/order_status NOT IN \('completed','cancelled'\)/);
  assert.match(home,/order_status='completed'/);
  assert.match(home,/LIMIT 12/);
  assert.match(home,/LIMIT 3/);
  assert.doesNotMatch(home,/SELECT o\.\*/);
  const fallback=ordersServer.slice(homeEnd,ordersServer.indexOf("app.get('/api/orders/:id'",routeStart));
  assert.match(fallback,/SELECT o\.\*/);
});

test('Delivery Home view excludes closed history and sensitive live-tracking fields',()=>{
  const start=deliveryServer.indexOf("app.get('/api/delivery/mine'");
  const end=deliveryServer.indexOf("app.get('/api/delivery/:id/live'",start);
  const block=deliveryServer.slice(start,end);
  assert.match(block,/String\(req\.query\.view\|\|''\)==='home'/);
  assert.match(block,/status NOT IN \('delivered','failed','cancelled'\)/);
  const home=block.slice(block.indexOf("if(String(req.query.view"));
  const homeEnd=home.indexOf("const{rows}=await pool.query",home.indexOf("return res.json(rows)")+1);
  assert.doesNotMatch(home.slice(0,homeEnd>0?homeEnd:home.length),/completion_code|last_lat|last_lng/);
});

test('Local Services Home view is Customer-scoped and keeps only active plus recent confirmed jobs',()=>{
  const start=servicesServer.indexOf("app.get('/api/services/jobs/mine'");
  const end=servicesServer.indexOf("app.post('/api/service-provider/jobs/:id/quote'",start);
  const block=servicesServer.slice(start,end);
  assert.match(block,/String\(req\.query\.view\|\|''\)==='home'/);
  assert.match(block,/Customer profile required/);
  assert.match(block,/j\.customer_account_id=\$1/);
  assert.match(block,/NOT\(j\.status='completed' AND j\.customer_confirmed_at IS NOT NULL\)/);
  assert.match(block,/j\.status='completed' AND j\.customer_confirmed_at IS NOT NULL/);
  assert.match(block,/LIMIT 12/);
  assert.match(block,/LIMIT 3/);
});

test('Customer Money Home view excludes detailed ledger banking and payment history',()=>{
  assert.match(paymentsServer,/customerMoneyHomeSnapshot/);
  assert.match(paymentsServer,/role==='customer'&&String\(req\.query\.view\|\|''\)==='home'/);
  assert.match(moneyCore,/export async function customerMoneyHomeSnapshot/);
  const start=moneyCore.indexOf('export async function customerMoneyHomeSnapshot');
  const end=moneyCore.indexOf('export async function customerMoneySnapshot',start);
  const block=moneyCore.slice(start,end);
  assert.doesNotMatch(block,/recent_orders|recent_payments|account_money|financial_accounts|budgets/);
});

test('Customer Money Home aggregates use one database round trip',()=>{
  const start=moneyCore.indexOf('async function customerMoneyHomeSummary');
  const end=moneyCore.indexOf('export async function customerMoneyHomeSnapshot',start);
  const block=moneyCore.slice(start,end);
  assert.equal((block.match(/pool\.query\(/g)||[]).length,1);
  assert.match(block,/FROM orders/);
  assert.match(block,/FROM payment_intents/);
  assert.match(block,/FROM refunds r/);
  assert.match(block,/payment_intents\.status=succeeded/);
  assert.match(block,/orders\.outstanding_amount/);
  assert.match(block,/refunds\.status=succeeded/);
});


test('post-optimization Customer acceptance measures slim payloads against the same first-open shape',()=>{
  assert.match(qa,/CUSTOMER_PERFORMANCE_RUNTIME_WAVE='customer_performance_runtime_v1'/);
  assert.match(qa,/first_open_request_count:5/);
  assert.match(qa,/parallel_home_request_count:4/);
  assert.match(qa,/home_payload_bytes_total:totalPayload/);
  assert.match(qa,/slim_home_reads:true/);
  assert.match(qa,/deferred_history_excluded:true/);
});
