import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const paymongo=read('server-paymongo.js');
const shell=read('public/shell.js');
const governance=read('public/profile-governance-ui.js');

test('public gateway preserves raw JSON bytes before handing requests to embedded Payment Core',()=>{
  assert.match(paymongo,/verify:\(req,_res,buf\)=>\{req\.rawBody=Buffer\.from\(buf\)\}/);
  assert.match(paymongo,/startEmbeddedPaymentCore/);
  assert.match(paymongo,/app\.use\(paymentApp\)/);
  assert.doesNotMatch(paymongo,/Payment Core upstream unavailable/);
  assert.doesNotMatch(paymongo,/spawn\(process\.execPath,\['server-payments\.js'\]/);
});

test('normal profile switching still uses the canonical active-role API',()=>{
  assert.match(shell,/profileApi\('\/api\/me\/active-role'/);
  assert.match(shell,/method: 'PATCH'/);
  assert.match(shell,/activeRole = snapshot\.account\.active_role \|\| role/);
});

test('Admin authority is exposed separately from public profiles',()=>{
  assert.match(shell,/ADMIN_RANK_LABELS/);
  assert.match(shell,/super_admin:'Super Admin'/);
  assert.match(shell,/profileApi\('\/api\/admin\/me'\)/);
  assert.match(shell,/id="adminWorkspaceButton"/);
  assert.match(shell,/Delegated administration — separate from your personal and commercial profiles/);
  assert.match(shell,/window\.location\.assign\('\/admin'\)/);
  assert.doesNotMatch(shell,/data-admin-profile/);
  assert.doesNotMatch(shell,/ROLE_ORDER = \[[^\]]*super_admin/);
  assert.doesNotMatch(governance,/govDrawerAdmin/);
  assert.doesNotMatch(governance,/govAdminOpen/);
});
