import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const shell=readFileSync(new URL('../public/shell.js',import.meta.url),'utf8');
const shellCss=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');
const orders=readFileSync(new URL('../public/orders-ui.js',import.meta.url),'utf8');
const ordersCss=readFileSync(new URL('../public/orders.css',import.meta.url),'utf8');
const delivery=readFileSync(new URL('../public/delivery-ui.js',import.meta.url),'utf8');
const market=readFileSync(new URL('../public/marketplace-ui.js',import.meta.url),'utf8');
const services=readFileSync(new URL('../public/services-ui.js',import.meta.url),'utf8');
const money=readFileSync(new URL('../public/profile-money-ui.js',import.meta.url),'utf8');

test('Customer uses a dedicated simplified Home instead of the old seven-tile generic HUBS map',()=>{
  assert.match(shell,/function renderCustomerHub\(/);
  assert.match(shell,/if\(role==='customer'\)return renderCustomerHub\(\)/);
  const hubsStart=shell.indexOf('const HUBS = {');
  const supplierStart=shell.indexOf('supplier:',hubsStart);
  const genericBeforeSupplier=shell.slice(hubsStart,supplierStart);
  assert.doesNotMatch(genericBeforeSupplier,/customer\s*:/);
  assert.match(shell,/What would you like to do\?/);
});

test('Customer primary navigation is exactly Home Shop Services Orders Money',()=>{
  const start=shell.indexOf('<nav class="customerPrimaryNav"');
  const end=shell.indexOf('</nav>',start);
  assert.ok(start>=0&&end>start);
  const nav=shell.slice(start,end);
  for(const label of ['Home','Shop','Services','Orders','Money'])assert.match(nav,new RegExp('<strong>'+label+'<\\/strong>'));
  assert.doesNotMatch(nav,/>Delivery</);
  assert.doesNotMatch(nav,/Profile Settings/);
  assert.doesNotMatch(nav,/>Food</);
  assert.doesNotMatch(nav,/>Non-food</);
});

test('Shop preserves Food Non-food and separate Platform Store entry points',()=>{
  const shopStart=shell.indexOf('data-customer-panel="shop"');
  const shopEnd=shell.indexOf('</section>',shopStart);
  const shop=shell.slice(shopStart,shopEnd);
  assert.equal((shop.match(/data-hub-feature="Marketplace"/g)||[]).length,2);
  assert.match(shop,/>Food</);
  assert.match(shop,/>Non-food</);
  assert.match(shop,/data-hub-feature="Platform Store"/);
  assert.match(shop,/Merchant Marketplace and Platform Store stay separate/);
  assert.match(market,/querySelectorAll\('\[data-hub-feature="Marketplace"\]'\)/);
  assert.match(market,/data-hub-feature="Platform Store"/);
});

test('Services Orders and Money reuse their canonical Customer feature selectors',()=>{
  assert.match(shell,/data-hub-feature="Local Services"/);
  assert.match(shell,/data-hub-feature="Orders"/);
  assert.match(shell,/data-hub-feature="Money"/);
  assert.match(services,/data-hub-feature="Local Services"/);
  assert.match(money,/data-hub-feature="Money"/);
});

test('Delivery is contextual to Orders and reuses canonical Customer Delivery workspace',()=>{
  assert.match(shell,/customerFeatureProxy hidden/);
  assert.match(shell,/data-hub-feature="Delivery"/);
  assert.match(orders,/id="customerDeliveriesBtn"/);
  assert.match(orders,/My deliveries/);
  assert.match(orders,/BusinessLifeDelivery/);
  assert.match(orders,/openCustomerDelivery/);
  assert.match(delivery,/window\.BusinessLifeDelivery=Object\.freeze\(\{openCustomerDelivery,openCourierWorkspace,openMerchantDelivery\}\)/);
  assert.match(delivery,/async function openCustomerDelivery\(/);
});

test('Customer navigation adds no polling and keeps live Delivery polling bounded in Delivery only',()=>{
  const customerStart=shell.indexOf('function setCustomerHubPanel');
  const customerEnd=shell.indexOf('function renderRoleHub',customerStart);
  assert.doesNotMatch(shell.slice(customerStart,customerEnd),/setInterval\s*\(/);
  assert.doesNotMatch(orders,/setInterval\s*\(/);
  assert.match(delivery,/openLiveDelivery\(id,back\).*setInterval/s);
  assert.match(delivery,/if\(document\.getElementById\('deliveryWorkspace'\)\?\.classList\.contains\('hidden'\)\)return/);
  assert.match(delivery,/clearInterval\(delPoll\)/);
});

test('Customer navigation is mobile-safe with five columns and comfortable touch targets',()=>{
  assert.match(shellCss,/\.customerPrimaryNav\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(shellCss,/\.customerPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(shellCss,/\.customerActionCard,.customerShopCard\{[^}]*min-height:126px/);
  assert.match(shellCss,/@media\(max-width:420px\)/);
  assert.match(ordersCss,/\.customerOrderTools>button\{[^}]*min-height:58px/);
});

test('Customer Profile Settings stays reachable without becoming a primary navigation tab',()=>{
  assert.match(shell,/data-hub-feature="Profile Settings"/);
  const navStart=shell.indexOf('<nav class="customerPrimaryNav"');
  const navEnd=shell.indexOf('</nav>',navStart);
  assert.doesNotMatch(shell.slice(navStart,navEnd),/Profile Settings/);
});

test('Customer Money language remains personal rather than Merchant business accounting',()=>{
  assert.match(money,/Personal purchase activity only/);
  assert.match(money,/Optional personal money tracking/);
  assert.match(money,/Personal cash flow/);
});
