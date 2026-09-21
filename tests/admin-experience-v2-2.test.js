import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const server=read('server-admin-operations.js');
const governance=read('server-profile-governance.js');

test('Admin console stays syntactically valid',()=>{
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../public/admin-console.js',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('canonical Profiles is available to invitation delegates and creates only governed invite roles',()=>{
  assert.match(ui,/profiles\.invite_merchant/);
  assert.match(ui,/profiles\.invite_supplier/);
  assert.match(ui,/profiles\.invite_courier/);
  assert.match(ui,/PROFILE_INVITE_PERMISSIONS=\{merchant:'profiles\.invite_merchant',supplier:'profiles\.invite_supplier',courier:'profiles\.invite_courier'\}/);
  assert.match(ui,/id="profileInviteForm"/);
  assert.match(ui,/\/api\/governance\/admin\/invitations/);
  assert.match(governance,/const INVITE_ROLES = new Set\(\['merchant','supplier','courier'\]\)/);
});

test('invite UI only offers onboarding or active territories and does not pretend invitation is approval',()=>{
  assert.match(ui,/\['onboarding','active'\]\.includes/);
  assert.match(ui,/This creates an invitation to apply\. It does not approve the profile/);
  assert.match(governance,/Invitation requires an onboarding or active PH territory/);
});

test('private invitation token is exposed only in the immediate copy result, not Admin history',()=>{
  assert.match(ui,/location\.origin\+'\/\?invite='\+encodeURIComponent\(created\.invite_token\)/);
  assert.match(ui,/raw token is not kept in Admin history/);
  assert.match(server,/SELECT i\.id,i\.target_email,i\.role,i\.territory_id,i\.status,i\.expires_at,i\.created_at,t\.name territory_name/);
  assert.doesNotMatch(server,/SELECT i\.id,i\.target_email,i\.role,i\.territory_id,i\.status,i\.expires_at,i\.created_at,i\.token_hash/);
});

test('Team assignment detail edits delegated function bundles through existing audited endpoint',()=>{
  assert.match(ui,/id="assignmentFunctionsForm"/);
  assert.match(ui,/\/api\/admin\/assignments\/'\+Number\(a\.id\)\+'\/permissions/);
  assert.match(ui,/function_codes:functionCodes/);
  assert.match(ui,/permissions:explicitPermissions/);
  assert.match(server,/app\.put\('\/api\/admin\/assignments\/:id\/permissions'/);
  assert.match(server,/eventCode:'admin_permissions_replaced'/);
});

test('function editor preserves direct permissions and fails closed for non-delegable current functions',()=>{
  assert.match(ui,/function assignmentExplicitPermissions\(a\)/);
  assert.match(ui,/Function editing is locked from this account/);
  assert.match(ui,/outside your delegation authority/);
  assert.match(server,/You cannot delegate permission:/);
});

test('Team uses readable function labels and protects Platform Owner assignment',()=>{
  assert.match(ui,/function adminFunctionLabel\(code\)/);
  assert.match(ui,/Protected Platform Owner assignment/);
  assert.match(server,/Platform Owner Super Admin cannot be changed here/);
});

test('new invitation and responsibility actions remain mobile safe',()=>{
  assert.match(css,/\.adminInviteResult button\{min-height:44px\}/);
  assert.match(css,/#assignmentFunctionsForm \.functionChoice\{min-height:44px\}/);
  assert.match(css,/\.adminInviteResult code\{[^}]*overflow-wrap:anywhere/);
});
