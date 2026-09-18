import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('public/app.js');
const help=read('public/help-linking.js');
const shell=read('public/shell.js');
const modules={
  services:read('public/services-ui.js'),
  delivery:read('public/delivery-ui.js'),
  orders:read('public/orders-ui.js'),
  marketplace:read('public/marketplace-ui.js'),
  suppliers:read('public/suppliers-ui.js')
};

test('base accounting waits for canonical Merchant profile context',()=>{
  assert.match(app,/isMerchantBaseActive/);
  assert.match(app,/abl:profile-state/);
  assert.match(app,/if\(!isMerchantBaseActive\(\)\)return/);
  assert.doesNotMatch(app,/function showShell\(\)\{[^}]*refreshAll\(\)/);
});

test('contextual Help suppresses errors emitted by hidden feature domains',()=>{
  assert.match(help,/activeRole/);
  assert.match(help,/supplierAccountingMode/);
  assert.match(help,/servicesWorkspace/);
  assert.match(help,/deliveryWorkspace/);
  assert.match(help,/ordersWorkspace/);
  assert.match(help,/marketWorkspace/);
  assert.match(help,/supWorkspace/);
});

test('shell exposes in-app workspace restoration without a page reload',()=>{
  assert.match(shell,/BusinessLifeShell/);
  assert.match(shell,/showActiveWorkspace/);
  assert.match(shell,/publishProfileState\(\)/);
});

test('normal feature Back and post-checkout navigation never hard reload the app',()=>{
  for(const [name,source] of Object.entries(modules)){
    assert.doesNotMatch(source,/location\.reload\(\)/,name+' must restore the active workspace in-app');
    assert.match(source,/BusinessLifeShell/,name+' must use the canonical shell restoration API');
  }
});
