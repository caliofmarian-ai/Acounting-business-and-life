import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const governance=read('server-profile-governance.js');

test('Super Admin Manage profiles bypass is explicit but ordinary gates remain intact',()=>{
  assert.match(shell,/function isSuperAdminAccount\(\)/);
  assert.match(shell,/Super Admin direct profile access/);
  assert.match(shell,/Ready for Super Admin testing/);
  assert.match(shell,/Verify email first/);
  assert.match(shell,/Complete details/);
});

test('Super Admin activation uses a dedicated self-test endpoint and switches into the activated profile',()=>{
  assert.match(shell,/\/api\/governance\/super-admin\/self-test\/profiles\/\$\{role\}\/activate/);
  assert.match(shell,/\/api\/me\/active-role/);
  assert.match(governance,/app\.post\('\/api\/governance\/super-admin\/self-test\/profiles\/:role\/activate'/);
  assert.match(governance,/Active Super Admin assignment required/);
  assert.match(governance,/super_admin_self_test_profile_activated/);
  assert.match(governance,/visibility:'private'/);
});

test('Super Admin self-test provisioning creates the minimum domain records needed to open every profile',()=>{
  assert.match(governance,/INSERT INTO customer_profiles/);
  assert.match(governance,/INSERT INTO business_memberships/);
  assert.match(governance,/INSERT INTO supplier_profiles/);
  assert.match(governance,/INSERT INTO courier_profiles/);
  assert.match(governance,/INSERT INTO service_provider_profiles/);
  assert.match(governance,/Super Admin self-test bypass/);
});

test('ordinary Customer reactivation uses the canonical Customer activation endpoint',()=>{
  const start=shell.indexOf('async function reactivateProfile');
  const end=shell.indexOf('async function toggleProfile',start);
  const block=shell.slice(start,end);
  assert.match(block,/role==='customer'/);
  assert.match(block,/\/api\/profiles\/customer\/activate/);
});

test('ordinary governed-role onboarding remains invitation and approval gated',()=>{
  assert.match(governance,/This launch profile requires an invitation before onboarding can start/);
  assert.match(governance,/This profile is invitation-only and requires Admin approval/);
});
