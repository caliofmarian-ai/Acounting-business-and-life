import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const orders=read('public/orders-ui.js');
const marketplace=read('public/marketplace-ui.js');
const suppliers=read('public/suppliers-ui.js');
const delivery=read('public/delivery-ui.js');
const mobile=read('public/mobile-feature-loader.js');

test('Merchant desktop navigation has a dedicated shell row with five primary destinations',()=>{
  assert.match(shell,/id='merchantWorkspaceNav'/);
  assert.match(shell,/id="merchantWorkspaceActions"/);
  assert.match(shell,/id="merchantHomeButton"/);
  assert.match(shell,/>Today<\/button>/);
  assert.doesNotMatch(shell,/merchantWorkspaceHost/);
  assert.match(css,/\.merchantWorkspaceActions\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/#merchantHomeButton\{order:0\}/);
  assert.match(css,/#ordersQuickButton\{order:1\}/);
  assert.match(css,/#marketQuickButton\{order:2\}/);
  assert.match(css,/#supQuickButton\{order:3\}/);
  assert.match(css,/#deliveryQuickButton\{order:4\}/);
});

test('Merchant feature launchers are shell-owned and modules never create or remove canonical nav destinations',()=>{
  const slices={
    orders:orders.slice(orders.indexOf('async function decorate('),orders.indexOf('function ordersVisible')),
    marketplace:marketplace.slice(marketplace.indexOf('async function decorateMarket('),marketplace.indexOf('function observeMarket')),
    suppliers:suppliers.slice(suppliers.indexOf('async function decorateSupplier('),suppliers.indexOf('function observeSupplier')),
    delivery:delivery.slice(delivery.indexOf('async function decorateDelivery('),delivery.indexOf('function observeDelivery'))
  };
  for(const [name,source] of Object.entries(slices)){
    assert.doesNotMatch(source,/merchantWorkspaceHost|createElement\('button'\)|appendChild\(|\.remove\(\)/,name+' must not mutate canonical Merchant nav');
    assert.doesNotMatch(source,/document\.querySelector\('\.shellProfileControls'\)/,name+' must not mount beside avatar controls');
  }
});

test('desktop global topbar no longer horizontally scrolls to reveal Merchant workspaces',()=>{
  assert.match(css,/@media\(min-width:650px\)\{[\s\S]*\.topActions\{max-width:none;overflow:visible;/);
  assert.match(css,/\.merchantWorkspaceNav:not\(\.hidden\)\{display:block\}/);
  assert.match(css,/@media\(max-width:649px\)\{[\s\S]*\.merchantWorkspaceNav\{display:none!important\}/);
});

test('Merchant nav visibility follows active profile surface and Today is canonical home',()=>{
  assert.match(shell,/function syncMerchantWorkspaceNavVisibility\(\)/);
  assert.match(shell,/activeSurface==='profile'&&activeRole==='merchant'/);
  assert.match(shell,/if\(destination==='merchantHome'\)return showActiveWorkspace\(\)/);
  assert.match(shell,/const home=document\.getElementById\('merchantHomeButton'\)/);
  assert.match(shell,/const active=!activeWorkspaceId/);
});

test('narrow screens keep six shell-owned Merchant mobile destinations instead of desktop nav',()=>{
  for(const label of ['Today','Orders','Storefront','Suppliers','Delivery','Profile Settings'])assert.match(shell,new RegExp('<strong>'+label+'<\\/strong>|>'+label+'<\\/button>'));
  assert.match(shell,/id='merchantMobileTools'/);
  assert.doesNotMatch(mobile,/mountMerchantMobileTools|MERCHANT_MOBILE_ACTIONS/);
  assert.match(css,/@media\(max-width:649px\)/);
});
