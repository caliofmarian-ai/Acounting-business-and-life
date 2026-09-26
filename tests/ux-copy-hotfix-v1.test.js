import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('public/app.js');
const merchant=read('public/v03.js');
const shell=read('public/shell.js');
const suppliers=read('public/suppliers-ui.js');

function renderRoleHubBlock(){
  const start=shell.indexOf('function renderRoleHub(role)');
  const end=shell.indexOf('function renderAccountHome()',start);
  assert.ok(start>=0&&end>start);
  return shell.slice(start,end);
}

test('connectivity indicators use production copy only',()=>{
  for(const source of [app,merchant]){
    assert.match(source,/textContent=ok\?'Online':'Offline'/);
    assert.doesNotMatch(source,/Offline copy/);
  }
});

test('shell never exposes development implementation language to profile users',()=>{
  assert.doesNotMatch(shell,/implementation continues in the next marketplace\/service slice/i);
  assert.doesNotMatch(shell,/next marketplace\/service slice/i);
  assert.match(shell,/is still loading\. Try again in a moment\./);
});

test('Supplier hub has a canonical route available before decorator rebinding finishes',()=>{
  assert.match(suppliers,/BusinessLifeSuppliers=Object\.freeze\(\{openMerchantProcurement,openSupplierWorkspace\}\)/);
  const block=renderRoleHubBlock();
  assert.match(block,/role==='supplier'&&window\.BusinessLifeSuppliers\?\.openSupplierWorkspace/);
  assert.match(block,/BusinessLifeSuppliers\.openSupplierWorkspace\(feature\)/);
});

test('Profile Settings race fallback is user-facing loading copy rather than silent no-op',()=>{
  const block=renderRoleHubBlock();
  assert.match(block,/if\(feature==='Profile Settings'\)return openProfileSettingsForRole\(role\)/);
  assert.match(shell,/function openProfileSettingsForRole\(role\)/);
  assert.match(shell,/Profile Settings is still loading\. Try again in a moment\./);
});
