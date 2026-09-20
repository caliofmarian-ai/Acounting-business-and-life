import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellCss=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');
const baseCss=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const governanceUi=readFileSync(new URL('../public/profile-governance-ui.js',import.meta.url),'utf8');
const adminUi=readFileSync(new URL('../public/admin-operations-ui.js',import.meta.url),'utf8');
const loader=readFileSync(new URL('../public/mobile-feature-loader.js',import.meta.url),'utf8');
const loaderCss=readFileSync(new URL('../public/mobile-feature-loader.css',import.meta.url),'utf8');

test('mobile shell prevents injected top actions from widening the page',()=>{
  assert.match(baseCss,/html,body,#app,#shell\{max-width:100%;overflow-x:hidden\}/);
  assert.match(shellCss,/\.topbar\{width:100%;max-width:100%;min-width:0;[^}]*overflow:hidden/);
  assert.match(shellCss,/\.topActions\{min-width:0;[^}]*overflow-x:auto/);
  assert.match(shellCss,/\.topActions>\*\{flex:0 0 auto\}/);
  assert.match(shellCss,/@media\(max-width:640px\)[\s\S]*\.topActions\{width:100%;max-width:100%;justify-content:flex-start/);
});

test('Admin authority is profile-first and never injected into the topbar',()=>{
  assert.doesNotMatch(governanceUi,/govAdminTop/);
  assert.doesNotMatch(governanceUi,/function addAdminButton/);
  assert.doesNotMatch(adminUi,/adminOpsBtn/);
  assert.doesNotMatch(adminUi,/refreshAdminButton/);
});

test('legacy governance does not inject a second Admin entry into the avatar drawer',()=>{
  assert.doesNotMatch(governanceUi,/govDrawerAdmin/);
  assert.doesNotMatch(governanceUi,/govAdminOpen/);
  assert.match(governanceUi,/openAdminConsole/);
});


test('Merchant mobile navigation exposes the same core workspace tools as desktop',()=>{
  assert.match(loader,/merchantMobileTools/);
  for(const id of ['ordersQuickButton','marketQuickButton','supQuickButton','deliveryQuickButton','profileSettings']){
    assert.match(loader,new RegExp(id));
  }
  for(const label of ['Orders','Storefront','Suppliers','Delivery','Profile Settings']){
    assert.match(loader,new RegExp(label));
  }
  assert.doesNotMatch(loader,/\['accountAvatarButton','👤','Merchant'\]/);
  assert.match(loader,/businessWorkspaceBar/);
  assert.match(loaderCss,/@media\(max-width:649px\)/);
  assert.match(loaderCss,/merchantMobileToolsGrid/);
  assert.match(loaderCss,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
