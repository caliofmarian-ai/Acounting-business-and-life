import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const shellCss=read('public/shell.css');
const mobile=read('public/mobile-feature-loader.js');
const orders=read('public/orders-ui.js');
const marketplace=read('public/marketplace-ui.js');
const suppliers=read('public/suppliers-ui.js');
const delivery=read('public/delivery-ui.js');

test('canonical shell owns exclusive feature workspace orchestration',()=>{
  assert.match(shell,/const FEATURE_WORKSPACE_IDS=\['ordersWorkspace','marketWorkspace','servicesWorkspace','supWorkspace','deliveryWorkspace'\]/);
  assert.match(shell,/function hideFeatureWorkspaces\(keepWorkspaceId=null\)/);
  assert.match(shell,/function openFeatureWorkspace\(workspaceId\)/);
  assert.match(shell,/hideFeatureWorkspaces\(workspaceId\)/);
  assert.match(shell,/document\.dispatchEvent\(new CustomEvent\('abl:feature-workspace'/);
  assert.match(shell,/window\.BusinessLifeShell=Object\.freeze\(\{[\s\S]*openFeatureWorkspace/);
});

test('Account Home closes feature workspaces before rendering account surface',()=>{
  const start=shell.indexOf('function renderAccountHome()');
  const end=shell.indexOf('async function signOutCurrentAccount',start);
  assert.ok(start>=0&&end>start);
  const block=shell.slice(start,end);
  assert.match(block,/activeSurface='account';[\s\S]*hideFeatureWorkspaces\(\);[\s\S]*closeDrawer\(\);[\s\S]*hideMerchantWorkspace\(\)/);
});

test('Merchant feature modules use canonical exclusive opening instead of partial local hiding',()=>{
  assert.ok(orders.includes("openFeatureWorkspace?.('ordersWorkspace')"));
  assert.ok(marketplace.includes("openFeatureWorkspace?.('marketWorkspace')"));
  assert.ok(suppliers.includes("openFeatureWorkspace?.('supWorkspace')"));
  assert.ok(delivery.includes("openFeatureWorkspace?.('deliveryWorkspace')"));
});

test('Merchant desktop launchers share one visual class and active state contract',()=>{
  for(const [name,source] of Object.entries({orders,marketplace,suppliers,delivery})){
    assert.match(source,/b\.className='merchantWorkspaceButton'/,name+' launcher must use the canonical Merchant workspace class');
  }
  assert.match(shellCss,/\.merchantWorkspaceButton\{/);
  assert.match(shellCss,/\.merchantWorkspaceButton\.active,\.merchantWorkspaceButton\[aria-current="page"\]/);
  assert.doesNotMatch(marketplace,/b\.className='marketQuickButton'/);
});

test('Merchant role indicator and mobile tools provide a real home action',()=>{
  assert.match(shell,/<button id="activeRolePill" class="activeRolePill" type="button"/);
  assert.match(shell,/activeSurface==='profile'&&activeRole\)showActiveWorkspace\(\)/);
  assert.match(mobile,/\['merchantHome','🏠','Today'\]/);
  assert.match(mobile,/if\(id==='merchantHome'\)[\s\S]*showActiveWorkspace/);
  assert.match(mobile,/function syncMerchantMobileTools\(workspaceId=null\)/);
  assert.match(mobile,/abl:feature-workspace/);
});

test('Merchant performance intent remains deferred to explicit feature opening',()=>{
  for(const [name,source,endpoint] of [
    ['orders',orders,'/api/orders/merchant/list'],
    ['storefront',marketplace,'/api/merchant/storefront'],
    ['suppliers',suppliers,'/api/procurement/orders'],
    ['delivery',delivery,'/api/delivery/merchant']
  ]){
    const eventIndex=source.lastIndexOf('abl:profile-state');
    assert.ok(eventIndex>=0,name+' must still observe profile state');
    assert.ok(!source.slice(eventIndex).includes(endpoint),name+' must not fetch domain data during profile-state decoration');
  }
});
