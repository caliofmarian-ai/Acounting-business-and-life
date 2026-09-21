import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const orders=read('public/orders-ui.js');
const delivery=read('public/delivery-ui.js');
const services=read('public/services-ui.js');
const money=read('public/profile-money-ui.js');

function customerBlock(){
  const start=shell.indexOf('const CUSTOMER_HOME_CACHE_MS');
  const end=shell.indexOf('function renderRoleHub',start);
  assert.ok(start>=0&&end>start);
  return shell.slice(start,end);
}

test('Customer Home reads only the four canonical Customer sources in parallel',()=>{
  const block=customerBlock();
  assert.match(block,/Promise\.allSettled\(\[/);
  for(const path of ['/api/orders/mine','/api/delivery/mine','/api/services/jobs/mine','/api/profile-money/customer']){
    assert.match(block,new RegExp(path.replaceAll('/','\\/')));
  }
});

test('Customer Home uses a bounded cache and no general polling',()=>{
  const block=customerBlock();
  assert.match(block,/const CUSTOMER_HOME_CACHE_MS=30000/);
  assert.match(block,/Date\.now\(\)-customerHomeCache\.loadedAt<CUSTOMER_HOME_CACHE_MS/);
  assert.doesNotMatch(block,/setInterval\s*\(/);
  assert.doesNotMatch(block,/MutationObserver/);
  assert.match(shell,/activeRole!=='customer'\)invalidateCustomerHome/);
});

test('Customer Home preserves service completion confirmation as active work',()=>{
  const block=customerBlock();
  assert.match(block,/job\.status==='cancelled'\|\|\(job\.status==='completed'&&job\.customer_confirmed_at\)/);
  assert.match(block,/job\.status!=='completed'\|\|!job\.customer_confirmed_at/);
});

test('Customer Home never converts unknown Money evidence to zero',()=>{
  const block=customerBlock();
  assert.match(block,/value==null\|\|!Number\.isFinite\(Number\(value\)\)\?'Unavailable':customerMoney\(value\)/);
  assert.match(block,/Money summary unavailable/);
  assert.match(block,/No balance has been assumed/);
});

test('Customer Home keeps active work before discovery and caps recent history',()=>{
  const block=customerBlock();
  assert.match(block,/>Continue</);
  assert.match(block,/>Discover</);
  assert.match(block,/slice\(0,6\)/);
  assert.match(block,/slice\(0,3\)/);
  assert.match(block,/You’re all caught up/);
});

test('Customer Home activity cards open canonical workspaces',()=>{
  const block=customerBlock();
  assert.match(block,/BusinessLifeOrders\?\.openCustomerOrders/);
  assert.match(block,/BusinessLifeDelivery\?\.openCustomerDelivery/);
  assert.match(block,/BusinessLifeServices\?\.openCustomerJobs/);
  assert.match(block,/BusinessLifeProfileMoney\?\.openCustomerMoney/);
  assert.match(orders,/window\.BusinessLifeOrders=Object\.freeze\(\{openMerchantOrders,openCustomerOrders,closeOrders\}\)/);
  assert.match(delivery,/window\.BusinessLifeDelivery=Object\.freeze\(\{openCustomerDelivery,openCourierWorkspace\}\)/);
  assert.match(services,/window\.BusinessLifeServices=Object\.freeze\(\{openDirectory,openCustomerJobs(?:,openProviderWorkspace)?\}\)/);
  assert.match(money,/window\.BusinessLifeProfileMoney=Object\.freeze\(\{openCustomerMoney:\(\)=>openPm\('customer'\),openProfileMoney:openPm\}\)/);
});

test('Customer Home keeps partial failures visible and retryable',()=>{
  const block=customerBlock();
  assert.match(block,/Some Home information is unavailable/);
  assert.match(block,/data-customer-home-retry/);
  assert.match(block,/failures\.length===4/);
  assert.match(block,/Customer Home could not be loaded/);
});

test('Customer Home remains mobile safe',()=>{
  assert.match(css,/\.customerHomeToolbar button\{[^}]*min-height:44px/);
  assert.match(css,/\.customerContinueCard,.customerRecentRow\{[^}]*min-height:58px/);
  assert.match(css,/\.customerMoneySnapshot\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/\.customerContinueCard,.customerRecentRow\{min-height:56px/);
});

test('Customer V2A five-destination navigation remains intact',()=>{
  const block=customerBlock();
  const start=block.indexOf('<nav class="customerPrimaryNav"');
  const end=block.indexOf('</nav>',start);
  const nav=block.slice(start,end);
  for(const label of ['Home','Shop','Services','Orders','Money'])assert.match(nav,new RegExp('<strong>'+label+'<\\/strong>'));
  assert.doesNotMatch(nav,/>Delivery</);
});
