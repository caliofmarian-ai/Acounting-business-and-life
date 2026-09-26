import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const loader=read('public/mobile-feature-loader.js');
const css=read('public/mobile-feature-loader.css');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  return a<0?'':source.slice(a,b>a?b:undefined);
}

test('Merchant Android navigation exists in shell before profile-state feature hydration',()=>{
  const chrome=between(shell,'function ensureShellChrome','function syncMerchantWorkspaceNavVisibility');
  assert.match(chrome,/id='merchantMobileTools'/);
  assert.match(chrome,/className='merchantMobileTools hidden'/);
  const actions=['merchantHome','ordersQuickButton','marketQuickButton','supQuickButton','deliveryQuickButton','profileSettings'];
  for(const action of actions)assert.match(chrome,new RegExp('data-merchant-mobile-action="'+action+'"'));
  const labels=['Today','Orders','Storefront','Suppliers','Delivery','Profile Settings'];
  for(const label of labels)assert.match(chrome,new RegExp('<strong>'+label+'<\\/strong>'));
});

test('shell owns mobile Merchant routing without eager data requests',()=>{
  const route=between(shell,'function openMerchantDestination','function ensureShellChrome');
  assert.match(route,/destination==='merchantHome'/);
  assert.match(route,/destination==='profileSettings'/);
  assert.match(route,/BusinessLifeOrders\?\.openMerchantOrders/);
  assert.match(route,/BusinessLifeMarketplace\?\.openMerchantStore/);
  assert.match(route,/BusinessLifeSuppliers\?\.openMerchantProcurement/);
  assert.match(route,/BusinessLifeDelivery\?\.openMerchantDelivery/);
  assert.doesNotMatch(route,/fetch\(|\/api\//);
});

test('Merchant desktop and Android navigation share one visibility lifecycle',()=>{
  const block=between(shell,'function syncMerchantWorkspaceNavVisibility','function syncBusinessWorkspacePlaceholder');
  assert.match(block,/const visible=activeSurface==='profile'&&activeRole==='merchant'/);
  assert.match(block,/merchantWorkspaceNav/);
  assert.match(block,/merchantMobileTools/);
  assert.match(block,/classList\.toggle\('hidden',!visible\)/);
});

test('workspace active state is synchronized into reserved Android actions by shell',()=>{
  const block=between(shell,'function syncFeatureLauncherState','function hideFeatureWorkspaces');
  assert.match(block,/const mobileActive=activeWorkspaceId\?FEATURE_LAUNCHERS\[activeWorkspaceId\]:'merchantHome'/);
  assert.match(block,/querySelectorAll\('#merchantMobileTools \[data-merchant-mobile-action\]'\)/);
  assert.match(block,/button\.dataset\.merchantMobileAction===mobileActive/);
  assert.match(block,/aria-current/);
});

test('mobile feature loader no longer owns Merchant navigation geometry',()=>{
  assert.doesNotMatch(loader,/MERCHANT_MOBILE_ACTIONS/);
  assert.doesNotMatch(loader,/function syncMerchantMobileTools/);
  assert.doesNotMatch(loader,/function openMerchantMobileAction/);
  assert.doesNotMatch(loader,/function mountMerchantMobileTools/);
  assert.doesNotMatch(loader,/merchantMobileToolsGrid/);
  assert.doesNotMatch(loader,/abl:feature-workspace/);
  assert.doesNotMatch(loader,/abl:business-workspace-changed/);
});

test('Android presentation remains narrow-screen only with three stable columns',()=>{
  assert.match(css,/\.merchantMobileTools\{display:none\}/);
  assert.match(css,/@media\(max-width:649px\)/);
  assert.match(css,/\.merchantMobileToolsGrid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
