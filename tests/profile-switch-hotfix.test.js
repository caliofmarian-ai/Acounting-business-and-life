import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const paymongo=read('server-paymongo.js');
const shell=read('public/shell.js');
const governance=read('public/profile-governance-ui.js');

test('public gateway reserializes parsed JSON before catch-all proxying',()=>{
  assert.match(paymongo,/parsedJsonBody/);
  assert.match(paymongo,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(paymongo,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(paymongo,/delete headers\['transfer-encoding'\]/);
  assert.match(paymongo,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('normal profile switching still uses the canonical active-role API',()=>{
  assert.match(shell,/profileApi\('\/api\/me\/active-role'/);
  assert.match(shell,/method: 'PATCH'/);
  assert.match(shell,/activeRole = snapshot\.account\.active_role \|\| role/);
});

test('Admin authority is exposed as a privileged switcher workspace without becoming a public role',()=>{
  assert.match(shell,/ADMIN_RANK_LABELS/);
  assert.match(shell,/super_admin:'Super Admin'/);
  assert.match(shell,/adminProfileRole/);
  assert.match(shell,/profileApi\('\/api\/admin\/me'\)/);
  assert.match(shell,/data-admin-profile/);
  assert.match(shell,/window\.location\.assign\('\/admin'\)/);
  assert.doesNotMatch(shell,/ROLE_ORDER = \[[^\]]*super_admin/);
  assert.match(governance,/!panel\.querySelector\('#adminProfileRole'\)/);
});
