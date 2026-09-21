import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const notifications=read('server-notifications.js');
const admin=read('server-admin-operations.js');

test('Notifications embeds Admin + Support and retires localhost port 4307',()=>{
  assert.match(notifications,/startEmbeddedAdminOperations/);
  assert.match(notifications,/stopEmbeddedAdminOperations/);
  assert.match(notifications,/adminApp=await startEmbeddedAdminOperations\(\)/);
  assert.match(notifications,/return adminApp\(req,res,next\)/);
  assert.doesNotMatch(notifications,/INTERNAL_ADMIN_OPERATIONS_PORT/);
  assert.doesNotMatch(notifications,/\|\|4307/);
  assert.doesNotMatch(notifications,/spawn\(process\.execPath,\['server-admin-operations\.js'\]/);
  assert.doesNotMatch(notifications,/Admin operations child failed health check/);
});

test('notification transaction hooks observe embedded Admin responses instead of proxying through 4307',()=>{
  assert.match(notifications,/adminApp\.handle\(req,res/);
  assert.match(notifications,/const chunks=\[\]/);
  assert.match(notifications,/Buffer\.concat\(chunks\)\.toString\('utf8'\)/);
  assert.match(notifications,/Post-transaction notification hook/);
  assert.match(notifications,/INTERNAL_BUSINESS_ACCOUNTING_PORT\|\|4207/);
});

test('embedded Admin delegates through the in-process Accounting app',()=>{
  assert.match(admin,/startEmbeddedBusinessAccounting/);
  assert.match(admin,/dispatchBusinessAccounting/);
  assert.match(admin,/businessAccountingApp\.handle\(req,res/);
  assert.doesNotMatch(admin,/INTERNAL_BUSINESS_ACCOUNTING_PORT/);
  assert.doesNotMatch(admin,/\|\|4207/);
});

test('Admin + Support remains standalone-capable while exposing embedded lifecycle',()=>{
  assert.match(admin,/export async function startEmbeddedAdminOperations/);
  assert.match(admin,/export async function stopEmbeddedAdminOperations/);
  assert.match(admin,/startupWaitAttempts\(260\)/);
  assert.match(admin,/directExecution/);
  assert.match(admin,/Business & Life scoped Admin \+ Support mounted in-process/);
  assert.match(admin,/Business & Life scoped Admin \+ Support gateway listening on/);
  assert.match(admin,/spawn\(process\.execPath,\['server-business-accounting\.js'\]/);
});

test('Resend raw-body verification remains owned by isolated Notifications',()=>{
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw\(\{type:'application\/json',limit:'1mb'\}\)/);
  assert.match(notifications,/verifyResendWebhook/);
  assert.match(notifications,/resendWebhookRuntime\.secret/);
});
