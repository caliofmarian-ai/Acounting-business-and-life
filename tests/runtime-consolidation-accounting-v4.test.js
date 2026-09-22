import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hardening=read('server-auth-hardening.js'),incidents=read('server-incidents.js'),finance=read('server-delivery-finance.js'),notifications=read('server-notifications.js'),admin=read('server-admin-operations.js'),accounting=read('server-business-accounting.js'),governance=read('server-profile-governance.js');

test('Admin still embeds Multi-business Accounting and keeps retired port 4207 absent',()=>{
  assert.match(admin,/startEmbeddedBusinessAccounting/);assert.match(admin,/stopEmbeddedBusinessAccounting/);assert.match(admin,/businessAccountingApp=await startEmbeddedBusinessAccounting\(\)/);assert.match(admin,/return businessAccountingApp\(req,res,next\)/);assert.doesNotMatch(admin,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);assert.doesNotMatch(admin,/\|\|4207/);assert.doesNotMatch(admin,/spawn\(process\.execPath,\['server-business-accounting\.js'\]/);assert.doesNotMatch(notifications,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);assert.doesNotMatch(notifications,/\|\|4207/);
});

test('Accounting remains standalone-capable while Profile Governance is embedded beneath it',()=>{
  assert.match(accounting,/export async function startEmbeddedBusinessAccounting/);assert.match(accounting,/export async function stopEmbeddedBusinessAccounting/);assert.match(accounting,/directExecution/);assert.match(accounting,/Business & Life multi-business accounting mounted in-process/);assert.match(accounting,/Business & Life multi-business accounting gateway listening on/);assert.match(accounting,/startEmbeddedProfileGovernance/);assert.match(accounting,/profileGovernanceApp=await startEmbeddedProfileGovernance\(\)/);assert.doesNotMatch(accounting,/spawn\(process\.execPath,\['server-profile-governance\.js'\]/);
});

test('parsed JSON preservation remains below Accounting at the embedded Delivery Finance boundary',()=>{
  assert.match(finance,/const parsedJsonBody=req\.body!==undefined/);assert.match(finance,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);assert.match(finance,/headers\['content-length'\]=String\(payload\.length\)/);assert.match(finance,/delete headers\['transfer-encoding'\]/);assert.match(finance,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);assert.match(governance,/authHardeningApp/);
});

test('delegated Admin actions still traverse Accounting with assertion and business binding intact',()=>{
  assert.match(admin,/function dispatchBusinessAccounting/);assert.match(admin,/businessAccountingApp\.handle\(req,res/);assert.match(admin,/signAdminAssertion/);assert.match(admin,/'x-bl-admin-assertion':assertion/);assert.match(admin,/afterSuccess:!\['GET','HEAD'\]\.includes\(req\.method\)\?\(\)=>appendAdminAudit/);assert.match(accounting,/app\.post\('\/api\/governance\/admin\/applications\/:id\/review'/);assert.match(accounting,/dispatchProfileGovernanceJson/);assert.match(accounting,/ensureProfileBusinessBinding/);
});

test('root composition uses the shared Auth Hardening dispatcher without losing UI assets',()=>{
  for(const source of [accounting,admin,notifications]){assert.match(source,/authHardeningFetch/);assert.doesNotMatch(source,/INTERNAL_AUTH_HARDENING_PORT/);assert.doesNotMatch(source,/4007/)}
  assert.match(hardening,/modernAuthRoot/);assert.match(hardening,/auth-hardening\.css/);assert.match(hardening,/auth-hardening-ui\.js/);assert.match(admin,/help-linking\.css/);assert.match(admin,/help-linking\.js/);assert.match(notifications,/help-linking\.css/);assert.match(notifications,/help-linking\.js/);assert.match(notifications,/notifications\.css/);assert.match(notifications,/notifications-ui\.js/);
});

test('Resend raw-body verification remains on isolated Notifications after later consolidation',()=>{
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);assert.match(notifications,/verifyResendWebhook/);assert.match(notifications,/resendWebhookRuntime\.secret/);
});
