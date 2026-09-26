import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const orders=read('public/orders-ui.js');
const marketplace=read('public/marketplace-ui.js');
const suppliers=read('public/suppliers-ui.js');
const delivery=read('public/delivery-ui.js');
const mobile=read('public/mobile-feature-loader.js');

function slice(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  return a<0?'':source.slice(a,b>a?b:undefined);
}

test('all five Merchant desktop destinations exist in shell before feature modules hydrate',()=>{
  const chrome=slice(shell,'function ensureShellChrome','function syncMerchantWorkspaceNavVisibility');
  const ordered=['merchantHomeButton','ordersQuickButton','marketQuickButton','supQuickButton','deliveryQuickButton'];
  for(const id of ordered)assert.ok(chrome.includes('id="'+id+'"'),id+' must be shell-owned');
  const positions=ordered.map(id=>chrome.indexOf('id="'+id+'"'));
  for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1],'Merchant destination order must be stable');
  for(const label of ['Today','Orders','Storefront','Suppliers','Delivery'])assert.ok(chrome.includes('>'+label+'</button>'));
});

test('shell routes reserved Merchant destinations without eager domain data requests',()=>{
  const chrome=slice(shell,'function ensureShellChrome','function syncMerchantWorkspaceNavVisibility');
  assert.match(chrome,/ordersQuickButton:\(\)=>window\.BusinessLifeOrders\?\.openMerchantOrders/);
  assert.match(chrome,/marketQuickButton:\(\)=>window\.BusinessLifeMarketplace\?\.openMerchantStore/);
  assert.match(chrome,/supQuickButton:\(\)=>window\.BusinessLifeSuppliers\?\.openMerchantProcurement/);
  assert.match(chrome,/deliveryQuickButton:\(\)=>window\.BusinessLifeDelivery\?\.openMerchantDelivery/);
  assert.doesNotMatch(chrome,/\/api\/|fetch\(|\.api\(/);
});

test('feature decorators never append remove or recreate canonical Merchant nav buttons',()=>{
  const blocks={
    orders:slice(orders,'async function decorate(','function ordersVisible'),
    marketplace:slice(marketplace,'async function decorateMarket(','function observeMarket'),
    suppliers:slice(suppliers,'async function decorateSupplier(','function observeSupplier'),
    delivery:slice(delivery,'async function decorateDelivery(','function observeDelivery')
  };
  for(const [name,block] of Object.entries(blocks)){
    assert.doesNotMatch(block,/merchantWorkspaceHost|ordersQuickButton|marketQuickButton|supQuickButton|deliveryQuickButton/,name+' decorator must not own Merchant nav');
    assert.doesNotMatch(block,/createElement\('button'\)|appendChild\(|\.remove\(\)/,name+' decorator must not mutate primary nav geometry');
  }
});

test('all Merchant destination modules expose the action expected by shell routing',()=>{
  assert.match(orders,/BusinessLifeOrders=Object\.freeze\(\{[^}]*openMerchantOrders/);
  assert.match(marketplace,/BusinessLifeMarketplace=Object\.freeze\(\{[^}]*openMerchantStore/);
  assert.match(suppliers,/BusinessLifeSuppliers=Object\.freeze\(\{[^}]*openMerchantProcurement/);
  assert.match(delivery,/BusinessLifeDelivery=Object\.freeze\(\{[^}]*openMerchantDelivery/);
});

test('active workspace synchronization still targets the reserved shell buttons',()=>{
  assert.match(shell,/const FEATURE_LAUNCHERS=\{ordersWorkspace:'ordersQuickButton',marketWorkspace:'marketQuickButton',supWorkspace:'supQuickButton',deliveryWorkspace:'deliveryQuickButton'\}/);
  assert.match(shell,/button\.classList\.toggle\('active',active\)/);
  assert.match(shell,/button\.setAttribute\('aria-current','page'\)/);
});

test('mobile Merchant navigation remains separate and complete',()=>{
  for(const label of ['Today','Orders','Storefront','Suppliers','Delivery','Profile Settings'])assert.match(mobile,new RegExp(label));
  assert.match(mobile,/MERCHANT_MOBILE_ACTIONS/);
});
