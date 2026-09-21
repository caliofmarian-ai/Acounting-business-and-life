import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const notifications=read('server-notifications.js');
const admin=read('server-admin-operations.js');
const accounting=read('server-business-accounting.js');

test('Admin embeds Multi-business Accounting and retires localhost port 4207',()=>{
  assert.match(admin,/startEmbeddedBusinessAccounting/);
  assert.match(admin,/stopEmbeddedBusinessAccounting/);
  assert.match(admin,/businessAccountingApp=await startEmbeddedBusinessAccounting\(\)/);
  assert.match(admin,/return businessAccountingApp\(req,res,next\)/);
  assert.doesNotMatch(admin,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);
  assert.doesNotMatch(admin,/\|\|4207/);
  assert.doesNotMatch(admin,/spawn\(process\.execPath,\['server-business-accounting\.js'\]/);

  assert.match(notifications,/INTERNAL_PROFILE_GOVERNANCE_PORT\|\|4107/);
  assert.doesNotMatch(notifications,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);
  assert.doesNotMatch(notifications,/\|\|4207/);
});

test('Accounting remains standalone-capable while exposing embedded lifecycle over Profile Governance',()=>{
  assert.match(accounting,/export async function startEmbeddedBusinessAccounting/);
  assert.match(accounting,/export async function stopEmbeddedBusinessAccounting/);
  assert.match(accounting,/startupWaitAttempts\(180\)/);
  assert.match(accounting,/directExecution/);
  assert.match(accounting,/Business & Life multi-business accounting mounted in-process/);
  assert.match(accounting,/Business & Life multi-business accounting gateway listening on/);
  assert.match(accounting,/spawn\(process\.execPath,\['server-profile-governance\.js'\]/);
  assert.match(accounting,/INTERNAL_PROFILE_GOVERNANCE_PORT \|\| 4107/);
});

test('embedded Accounting preserves already-parsed JSON before proxying to Profile Governance',()=>{
  assert.match(accounting,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(accounting,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(accounting,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(accounting,/delete headers\['transfer-encoding'\]/);
  assert.match(accounting,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('delegated Admin actions traverse embedded Accounting with assertion and audit intact',()=>{
  assert.match(admin,/function dispatchBusinessAccounting/);
  assert.match(admin,/businessAccountingApp\.handle\(req,res/);
  assert.match(admin,/signAdminAssertion/);
  assert.match(admin,/'x-bl-admin-assertion':assertion/);
  assert.match(admin,/afterSuccess:!\['GET','HEAD'\]\.includes\(req\.method\)\?\(\)=>appendAdminAudit/);
  assert.match(admin,/originalEnd\(payload/);
  assert.match(accounting,/app\.post\('\/api\/governance\/admin\/applications\/:id\/review'/);
  assert.match(accounting,/ensureProfileBusinessBinding/);
});

test('root composition bypasses 4207 without losing Help or Notifications assets',()=>{
  assert.match(admin,/INTERNAL_PROFILE_GOVERNANCE_PORT\|\|4107/);
  assert.match(admin,/help-linking\.css/);
  assert.match(admin,/help-linking\.js/);
  assert.match(notifications,/help-linking\.css/);
  assert.match(notifications,/help-linking\.js/);
  assert.match(notifications,/notifications\.css/);
  assert.match(notifications,/notifications-ui\.js/);
});

test('Resend raw-body verification remains on isolated Notifications after V4',()=>{
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(notifications,/verifyResendWebhook/);
  assert.match(notifications,/resendWebhookRuntime\.secret/);
});
