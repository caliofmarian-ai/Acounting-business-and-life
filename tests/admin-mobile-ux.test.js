import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('public/admin-console.css');
const ui=read('public/admin-console.js');
const loader=read('public/mobile-feature-loader.js');
const legacy=read('public/admin-operations-ui.js');
const shell=read('public/shell.js');
const governance=read('public/profile-governance-ui.js');

test('Admin mobile navigation stays compact instead of stretching to viewport height',()=>{
  assert.match(css,/\.workspace\{[^}]*grid-template-rows:auto minmax\(0,1fr\);[^}]*align-content:start/);
  assert.match(css,/\.adminNav\{[^}]*align-items:center;[^}]*align-self:start;[^}]*overflow-x:auto;[^}]*overflow-y:hidden/);
  assert.match(css,/\.adminNav button\{[^}]*flex:0 0 auto;[^}]*align-self:center;[^}]*min-height:38px/);
  assert.match(css,/@media\(min-width:760px\)\{\.workspace\{[^}]*grid-template-rows:1fr;[^}]*align-content:stretch/);
});

test('Super Admin has one separate Admin Workspace entry and no topbar duplicate',()=>{
  assert.match(shell,/id="adminWorkspaceButton"/);
  assert.match(shell,/Admin Workspace/);
  assert.doesNotMatch(shell,/data-admin-profile/);
  assert.match(shell,/window\.location\.assign\('\/admin'\)/);
  assert.doesNotMatch(loader,/lazyAdminBtn/);
  assert.doesNotMatch(loader,/fetchAdminAccess/);
  assert.doesNotMatch(legacy,/adminOpsBtn/);
  assert.doesNotMatch(legacy,/refreshAdminButton/);
  assert.doesNotMatch(governance,/govDrawerAdmin/);
  assert.doesNotMatch(governance,/govAdminOpen/);
});

test('delegation defaults to least privilege Specialist when available',()=>{
  assert.match(ui,/defaultRank=allowedRanks\.some\(r=>r\.code==='specialist'\)\?'specialist'/);
  assert.match(ui,/r\.code===defaultRank\?'selected':''/);
  assert.match(ui,/document\.getElementById\('delegateRole'\)\?\.value\|\|'specialist'/);
});
