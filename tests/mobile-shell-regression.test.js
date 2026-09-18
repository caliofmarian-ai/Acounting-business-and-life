import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellCss=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');
const baseCss=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const governanceUi=readFileSync(new URL('../public/profile-governance-ui.js',import.meta.url),'utf8');
const adminUi=readFileSync(new URL('../public/admin-operations-ui.js',import.meta.url),'utf8');

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

test('governance remains reachable without duplicate topbar Admin',()=>{
  assert.match(governanceUi,/govDrawerAdmin/);
  assert.match(governanceUi,/Governance & approvals/);
  assert.match(governanceUi,/openAdminConsole/);
});
