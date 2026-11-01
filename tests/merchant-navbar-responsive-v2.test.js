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

test('Merchant single top navigation has six operational destinations and secondary Business tools',()=>{
  assert.match(shell,/id='merchantWorkspaceNav'/);
  assert.match(shell,/id="merchantWorkspaceActions"/);
  for(const id of ['merchantHomeButton','ordersQuickButton','catalogQuickButton','merchantRecipesTopButton','merchantStockTopButton','merchantMoneyTopButton'])
    assert.match(shell,new RegExp('id="'+id+'"'));
  assert.match(shell,/id="merchantBusinessTools"/);
  for(const id of ['marketQuickButton','supQuickButton','deliveryQuickButton','profileSettingsQuickButton'])
    assert.match(shell,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(shell,/merchantWorkspaceHost/);
  assert.match(css,/\.merchantWorkspaceActions\{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css,/#shell \.merchantPrimaryNav\{display:none!important\}/);
  assert.match(css,/#shell \.merchantMobileTools\{display:none!important\}/);
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

test('desktop and narrow Android expose the same single shell navigation, without topbar overflow',()=>{
  assert.match(css,/@media\(min-width:650px\)\{[\s\S]*\.topActions\{max-width:none;overflow:visible;/);
  assert.match(css,/#shell \.merchantWorkspaceNav:not\(\.hidden\)\{display:block\}/);
  assert.match(css,/@media\(max-width:649px\)\{[\s\S]*#shell \.merchantWorkspaceNav:not\(\.hidden\)\{display:block!important\}/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('Merchant nav visibility follows active profile surface and Today is canonical home',()=>{
  assert.match(shell,/function syncMerchantWorkspaceNavVisibility\(\)/);
  assert.match(shell,/activeSurface==='profile'&&activeRole==='merchant'/);
  assert.match(shell,/if\(destination==='merchantHome'\)return showActiveWorkspace\(\)/);
  assert.match(shell,/profileSettingsQuickButton:'profileSettings'/);
  assert.match(shell,/if\(destination==='profileSettings'\)return openProfileSettingsForRole\('merchant'\)/);
  assert.match(shell,/const home=document\.getElementById\('merchantHomeButton'\)/);
  assert.match(shell,/const active=!activeWorkspaceId&&/);
});

test('Merchant secondary Storefront Suppliers Delivery Settings remain accessible on phone',()=>{
  for(const label of ['Today','Orders','Catalog','Products &amp; recipes','Stock','Money','Storefront','Suppliers','Delivery','Settings'])
    assert.match(shell,new RegExp('>'+label+'<'));
  assert.match(shell,/id='merchantMobileTools'/); // compatibility surface stays inert
  assert.doesNotMatch(mobile,/mountMerchantMobileTools|MERCHANT_MOBILE_ACTIONS/);
  assert.match(css,/#shell \.merchantBusinessToolsMenu\{/);
  assert.match(css,/#shell \.merchantWorkspaceNav \.merchantBusinessToolsMenu \.merchantWorkspaceButton\{/);
});
