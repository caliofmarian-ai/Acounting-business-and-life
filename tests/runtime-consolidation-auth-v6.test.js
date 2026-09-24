import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hardening=read('server-auth-hardening.js'),incidents=read('server-incidents.js'),finance=read('server-delivery-finance.js'),delivery=read('server-delivery.js'),suppliers=read('server-suppliers.js'),services=read('server-services.js'),marketplace=read('server-marketplace.js'),governance=read('server-profile-governance.js'),accounting=read('server-business-accounting.js'),admin=read('server-admin-operations.js'),notifications=read('server-notifications.js');
const composed=[hardening,governance,accounting,admin,notifications];

test('Auth Hardening exposes embedded lifecycle and remains standalone rollback-capable',()=>{
  assert.match(hardening,/export async function startEmbeddedAuthHardening\(\)/);assert.match(hardening,/export async function stopEmbeddedAuthHardening\(\)/);assert.match(hardening,/startEmbeddedIncidents/);assert.match(hardening,/incidentsApp=await startEmbeddedIncidents\(\)/);assert.match(hardening,/Business & Life auth hardening mounted in-process/);assert.match(hardening,/directExecution/);assert.match(hardening,/Business & Life auth hardening gateway listening on/);assert.doesNotMatch(hardening,/INTERNAL_INCIDENTS_PORT/);assert.doesNotMatch(hardening,/3907/);
});
test('composed V6 runtime has no Auth Hardening localhost port 4007 dependency',()=>{
  for(const source of composed){assert.doesNotMatch(source,/INTERNAL_AUTH_HARDENING_PORT/);assert.doesNotMatch(source,/\|\|\s*4007/);assert.doesNotMatch(source,/127\.0\.0\.1:4007/)}
  assert.doesNotMatch(governance,/server-auth-hardening\.js'\],/);assert.match(governance,/authHardeningApp=await startEmbeddedAuthHardening\(\)/);assert.match(governance,/return authHardeningApp\(req,res,next\)/);
});
test('public retired PIN and legacy bearer policies stay on the hardening boundary',()=>{
  assert.match(hardening,/pathname === '\/api\/login'.*'POST'/);assert.match(hardening,/PIN login has been retired from the public app\. Use email\/password or account recovery\./);assert.match(hardening,/isLegacyBearerToken\(raw\)/);assert.match(hardening,/Legacy PIN session expired\. Sign in with your email account\./);assert.match(hardening,/app\.use\('\/api', async \(req, res, next\)/);
});
test('canonical V2 sessions and hotfix optional verification remain intact',()=>{
  assert.match(hardening,/resolveV2SessionToken\(pool,TOKEN_SECRET,token\)/);assert.match(hardening,/async function optionalV2\(req\)/);assert.match(hardening,/const session = await optionalV2\(req\);/);assert.doesNotMatch(hardening,/\bresolveV2\(req\)/);
});
test('all Auth Hardening owned routes and assets remain present',()=>{
  for(const route of ['/api/auth/hardening/status','/api/auth/forgot-password','/api/auth/reset-password','/api/auth/email-verification/request','/api/auth/email-verification/verify','/api/auth/owner-migrate','/api/auth/sessions/revoke-others','/api/auth/identities','/api/auth/google/start','/api/auth/google/link/start','/api/auth/google/callback','/api/auth/oauth/handoff','/auth-hardening.css','/auth-hardening-ui.js'])assert.ok(hardening.includes(route),`missing Auth Hardening route/asset ${route}`);
});
test('parsed JSON and untouched raw streams reach the final Marketplace to Orders HTTP boundary safely',()=>{
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);assert.match(marketplace,/const parsedJsonBody=req\.body!==undefined/);assert.match(marketplace,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);assert.match(marketplace,/headers\['content-length'\]=String\(payload\.length\)/);assert.match(marketplace,/delete headers\['transfer-encoding'\]/);assert.match(marketplace,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
});
test('Governance Accounting Admin and Notifications cannot bypass Auth Hardening for direct reads',()=>{
  assert.match(governance,/authHardeningFetch/);for(const source of [accounting,admin,notifications]){assert.match(source,/authHardeningFetch/);assert.doesNotMatch(source,/http:\/\/127\.0\.0\.1:\$\{upstreamPort\}/)}
  assert.match(accounting,/upstream\(`\/api\/orders\/\$\{order\.id\}`/);assert.doesNotMatch(admin,/upstream\('\/api\/incidents'/);assert.match(admin,/dispatchBusinessAccounting\(req,res/);
});
test('root composition retains modern Auth Hardening UI before higher decorators',()=>{
  assert.match(hardening,/modernAuthRoot/);assert.match(hardening,/auth-hardening\.css/);assert.match(hardening,/auth-hardening-ui\.js/);assert.match(accounting,/help-linking\.css/);assert.match(admin,/help-linking\.css/);assert.match(notifications,/notifications\.css/);
});
