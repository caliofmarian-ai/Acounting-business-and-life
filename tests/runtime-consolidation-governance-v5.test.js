import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hardening=read('server-auth-hardening.js'),incidents=read('server-incidents.js'),finance=read('server-delivery-finance.js'),delivery=read('server-delivery.js'),suppliers=read('server-suppliers.js'),services=read('server-services.js'),marketplace=read('server-marketplace.js'),governance=read('server-profile-governance.js'),accounting=read('server-business-accounting.js'),admin=read('server-admin-operations.js'),notifications=read('server-notifications.js');
const orders=read('server-orders.js');
const auth=read('server-auth.js');

test('Profile Governance remains embedded and retired port 4107 stays absent',()=>{
  assert.match(accounting,/startEmbeddedProfileGovernance/);assert.match(accounting,/stopEmbeddedProfileGovernance/);assert.match(accounting,/profileGovernanceApp=await startEmbeddedProfileGovernance\(\)/);assert.match(accounting,/return profileGovernanceApp\(req,res,next\)/);
  for(const source of [accounting,admin,notifications]){assert.doesNotMatch(source,/INTERNAL_PROFILE_GOVERNANCE_PORT/);assert.doesNotMatch(source,/\|\|4107/)}
  assert.doesNotMatch(accounting,/spawn\(process\.execPath,\['server-profile-governance\.js'\]/);
});

test('Governance is standalone-capable while Auth Hardening is embedded beneath it',()=>{
  assert.match(governance,/startEmbeddedAuthHardening/);assert.match(governance,/stopEmbeddedAuthHardening/);assert.match(governance,/authHardeningApp=await startEmbeddedAuthHardening\(\)/);
  assert.match(governance,/export async function startEmbeddedProfileGovernance/);assert.match(governance,/export async function stopEmbeddedProfileGovernance/);assert.match(governance,/directExecution/);
  assert.match(governance,/Business & Life profile governance mounted in-process/);assert.match(governance,/Business & Life profile governance gateway listening on/);
  assert.doesNotMatch(governance,/spawn\(process\.execPath,\['server-auth-hardening\.js'\]/);assert.doesNotMatch(governance,/startupWaitAttempts\(220\)/);assert.doesNotMatch(governance,/INTERNAL_AUTH_HARDENING_PORT/);assert.doesNotMatch(governance,/4007/);
});

test('Accounting Admin and Notifications reuse the Auth Hardening policy-aware dispatcher',()=>{
  for(const source of [accounting,admin,notifications]){assert.match(source,/authHardeningFetch/);assert.doesNotMatch(source,/INTERNAL_AUTH_HARDENING_PORT/);assert.doesNotMatch(source,/4007/)}
  assert.match(accounting,/profile_governance:profileGovernanceReady/);assert.match(admin,/profile_governance:businessAccountingReady/);
});

test('parsed JSON preservation now lives through Local Services until Account/Auth reaches Accounting',()=>{
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.match(auth,/const parsedJsonBody=!rawPayload&&req\.body!==undefined/);
  assert.match(auth,/const payload=rawPayload\|\|/);
  assert.match(auth,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(auth,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(auth,/delete headers\['transfer-encoding'\]/);
  assert.match(auth,/if\(payload\)upstream\.end\(payload\);else req\.pipe\(upstream\)/);
  assert.match(governance,/return authHardeningApp\(req,res,next\)/);
});

test('Merchant and Supplier approval still traverses Governance before Accounting business binding',()=>{
  const route=accounting.slice(accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'"),accounting.indexOf("app.use((req,res,next)=>",accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'")));
  assert.match(route,/dispatchProfileGovernanceJson/);assert.match(route,/decision!=='approve'/);assert.match(route,/\['merchant','supplier'\]\.includes/);assert.match(route,/verifyAdminAssertion/);assert.match(route,/ensureProfileBusinessBinding/);
});

test('V6 preserves notification hook and signed Resend raw-body boundaries',()=>{
  assert.match(notifications,/const notificationParams=\{\.\.\.req\.params\}/);assert.match(notifications,/req\.params=notificationParams/);assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);assert.match(notifications,/verifyResendWebhook/);
});
