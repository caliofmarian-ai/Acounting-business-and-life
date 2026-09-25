import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const shell=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');
const ops=readFileSync(new URL('../public/admin-operations.css',import.meta.url),'utf8');
const admin=readFileSync(new URL('../public/admin-console.css',import.meta.url),'utf8');

test('Visual System V2D gives Account Settings a premium shared-account hierarchy',()=>{
  assert.match(shell,/Visual System V2D — Account Settings polish/);
  assert.match(shell,/\.accountSettingsHeader\{/);
  assert.match(shell,/background:linear-gradient\(135deg,#17233c 0%,#164b51 56%,#0a7c66 100%\)/);
  assert.match(shell,/\.accountSettingsGrid>button:focus-visible/);
  assert.match(shell,/\.accountUtilityList>button:focus-visible/);
  assert.match(shell,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Visual System V2D makes Support conversations visibly distinguish Admin and User messages',()=>{
  assert.match(ops,/Visual System V2D — Support & operations polish/);
  assert.match(ops,/\.supportMessage\.fromAdmin\{/);
  assert.match(ops,/\.supportMessage\.fromUser\{/);
  assert.match(ops,/\.supportMessage\.fromAdmin strong\{color:#086b59\}/);
  assert.match(ops,/\.supportMessage\.fromUser strong\{color:#4f469c\}/);
  assert.match(ops,/\.ticketCard:focus-visible/);
  assert.match(ops,/\.opsForm textarea:focus/);
});

test('Visual System V2D keeps privileged Admin visually distinct and keyboard accessible',()=>{
  assert.match(admin,/Visual System V2D — privileged Admin polish/);
  assert.match(admin,/\.adminShell\{[^}]*--admin-accent:#60d6b4/);
  assert.match(admin,/\.adminNav button\.active\{/);
  assert.match(admin,/\.adminMain \.hero\{/);
  assert.match(admin,/\.adminMain \.metric,/);
  assert.match(admin,/\.adminForm input:focus/);
  assert.match(admin,/@media\(max-width:520px\)/);
});
