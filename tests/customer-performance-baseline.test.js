import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const qa=read('qa-acceptance.js');
const notifications=read('public/notifications-ui.js');

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
