import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const governance=read('server-profile-governance.js');
const accounting=read('server-business-accounting.js');
const admin=read('server-admin-operations.js');
const notifications=read('server-notifications.js');

test('Profile Governance is embedded and localhost port 4107 is retired from the composed runtime',()=>{
  assert.match(accounting,/startEmbeddedProfileGovernance/);
  assert.match(accounting,/stopEmbeddedProfileGovernance/);
  assert.match(accounting,/profileGovernanceApp=await startEmbeddedProfileGovernance\(\)/);
  assert.match(accounting,/return profileGovernanceApp\(req,res,next\)/);
  assert.doesNotMatch(accounting,/INTERNAL_PROFILE_GOVERNANCE_PORT/);
  assert.doesNotMatch(accounting,/\|\|4107/);
  assert.doesNotMatch(accounting,/spawn\(process\.execPath,\['server-profile-governance\.js'\]/);
  assert.doesNotMatch(admin,/INTERNAL_PROFILE_GOVERNANCE_PORT/);
  assert.doesNotMatch(notifications,/INTERNAL_PROFILE_GOVERNANCE_PORT/);
  assert.doesNotMatch(admin,/\|\|4107/);
  assert.doesNotMatch(notifications,/\|\|4107/);
});

test('Governance remains standalone-capable over isolated Auth Hardening on 4007',()=>{
  assert.match(governance,/export async function startEmbeddedProfileGovernance/);
  assert.match(governance,/export async function stopEmbeddedProfileGovernance/);
  assert.match(governance,/startupWaitAttempts\(220\)/);
  assert.match(governance,/directExecution/);
  assert.match(governance,/Business & Life profile governance mounted in-process/);
  assert.match(governance,/Business & Life profile governance gateway listening on/);
  assert.match(governance,/spawn\(process\.execPath,\['server-auth-hardening\.js'\]/);
  assert.match(governance,/INTERNAL_AUTH_HARDENING_PORT \|\| 4007/);
});

test('Accounting, Admin and Notifications use Auth Hardening for non-Governance reads',()=>{
  assert.match(accounting,/INTERNAL_AUTH_HARDENING_PORT \|\| 4007/);
  assert.match(admin,/INTERNAL_AUTH_HARDENING_PORT\|\|4007/);
  assert.match(notifications,/INTERNAL_AUTH_HARDENING_PORT\|\|4007/);
  assert.match(accounting,/profile_governance:profileGovernanceReady/);
  assert.match(admin,/profile_governance:businessAccountingReady/);
});

test('Governance preserves parsed JSON before forwarding unmatched requests to Auth Hardening',()=>{
  assert.match(governance,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(governance,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(governance,/delete headers\['transfer-encoding'\]/);
  assert.match(governance,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('Merchant and Supplier approval still traverses Governance before Accounting business binding',()=>{
  const route=accounting.slice(
    accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'"),
    accounting.indexOf("app.use((req,res,next)=>",accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'"))
  );
  assert.match(route,/dispatchProfileGovernanceJson/);
  assert.match(route,/decision!=='approve'/);
  assert.match(route,/\['merchant','supplier'\]\.includes/);
  assert.match(route,/verifyAdminAssertion/);
  assert.match(route,/ensureProfileBusinessBinding/);
});

test('V5 preserves notification hook and signed Resend raw-body boundaries',()=>{
  assert.match(notifications,/const notificationParams=\{\.\.\.req\.params\}/);
  assert.match(notifications,/req\.params=notificationParams/);
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
  assert.match(notifications,/verifyResendWebhook/);
});
