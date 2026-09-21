import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const notifications=read('server-notifications.js');
const admin=read('server-admin-operations.js');
const accounting=read('server-business-accounting.js');
const governance=read('server-profile-governance.js');

test('Admin still embeds Multi-business Accounting and keeps retired port 4207 absent',()=>{
  assert.match(admin,/startEmbeddedBusinessAccounting/);
  assert.match(admin,/stopEmbeddedBusinessAccounting/);
  assert.match(admin,/businessAccountingApp=await startEmbeddedBusinessAccounting\(\)/);
  assert.match(admin,/return businessAccountingApp\(req,res,next\)/);
  assert.doesNotMatch(admin,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);
  assert.doesNotMatch(admin,/\|\|4207/);
  assert.doesNotMatch(admin,/spawn\(process\.execPath,\['server-business-accounting\.js'\]/);

  assert.doesNotMatch(notifications,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);
  assert.doesNotMatch(notifications,/\|\|4207/);
});

test('Accounting remains standalone-capable while Profile Governance is embedded beneath it',()=>{
  assert.match(accounting,/export async function startEmbeddedBusinessAccounting/);
  assert.match(accounting,/export async function stopEmbeddedBusinessAccounting/);
  assert.match(accounting,/directExecution/);
  assert.match(accounting,/Business & Life multi-business accounting mounted in-process/);
  assert.match(accounting,/Business & Life multi-business accounting gateway listening on/);
  assert.match(accounting,/startEmbeddedProfileGovernance/);
  assert.match(accounting,/profileGovernanceApp=await startEmbeddedProfileGovernance\(\)/);
  assert.doesNotMatch(accounting,/spawn\(process\.execPath,\['server-profile-governance\.js'\]/);
});

test('parsed JSON preservation lives at the embedded Governance to Auth boundary',()=>{
  assert.match(governance,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(governance,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(governance,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(governance,/delete headers\['transfer-encoding'\]/);
  assert.match(governance,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('delegated Admin actions still traverse Accounting with assertion and business binding intact',()=>{
  assert.match(admin,/function dispatchBusinessAccounting/);
  assert.match(admin,/businessAccountingApp\.handle\(req,res/);
  assert.match(admin,/signAdminAssertion/);
  assert.match(admin,/'x-bl-admin-assertion':assertion/);
  assert.match(admin,/afterSuccess:!\['GET','HEAD'\]\.includes\(req\.method\)\?\(\)=>appendAdminAudit/);
  assert.match(accounting,/app\.post\('\/api\/governance\/admin\/applications\/:id\/review'/);
  assert.match(accounting,/dispatchProfileGovernanceJson/);
  assert.match(accounting,/ensureProfileBusinessBinding/);
});

test('root composition uses Auth Hardening without losing Help or Notifications assets',()=>{
  assert.match(admin,/INTERNAL_AUTH_HARDENING_PORT\|\|4007/);
  assert.match(notifications,/INTERNAL_AUTH_HARDENING_PORT\|\|4007/);
  assert.match(admin,/help-linking\.css/);
  assert.match(admin,/help-linking\.js/);
  assert.match(notifications,/help-linking\.css/);
  assert.match(notifications,/help-linking\.js/);
  assert.match(notifications,/notifications\.css/);
  assert.match(notifications,/notifications-ui\.js/);
});

test('Resend raw-body verification remains on isolated Notifications after later consolidation',()=>{
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(notifications,/verifyResendWebhook/);
  assert.match(notifications,/resendWebhookRuntime\.secret/);
});
