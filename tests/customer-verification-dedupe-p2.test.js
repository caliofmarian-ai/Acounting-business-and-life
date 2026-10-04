import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emailVerificationNotificationEventKey} from '../notification-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('notification-core.js');
const auth=read('server-auth-hardening.js');
const fixtures=read('controlled-role-fixtures.js');

test('same outstanding email-verification identity reuses one stable inbox event key',()=>{
  const a=emailVerificationNotificationEventKey(42,'User@Example.COM');
  const b=emailVerificationNotificationEventKey(42,'user@example.com');
  assert.equal(a,b);
  assert.match(a,/^auth:verify_email:42:[a-f0-9]{24}$/);
  assert.notEqual(a,emailVerificationNotificationEventKey(42,'new@example.com'));
  assert.notEqual(a,emailVerificationNotificationEventKey(43,'user@example.com'));
  assert.doesNotMatch(a,/user|example/i);
});

test('verification resend reopens one recipient instead of creating duplicate actionable inbox rows',()=>{
  assert.match(core,/export async function reconcileEmailVerificationNotificationState/);
  assert.match(core,/e\.event_code='auth\.email_verification'/);
  assert.match(core,/e\.event_key<>\$2/);
  assert.match(core,/SET dismissed_at=NULL/);
  assert.match(core,/read_at=CASE WHEN \$3::boolean THEN NULL/);
  assert.match(core,/reopenInApp=false/);
  assert.match(core,/if\(reopenInApp\)/);
  assert.match(core,/await reconcileEmailVerificationNotificationState\(pool\)\.catch/);
  const reconciliation=core.slice(
    core.indexOf('export async function reconcileEmailVerificationNotificationState'),
    core.indexOf('export async function sendTransientEmailNotification')
  );
  assert.doesNotMatch(reconciliation,/\bDELETE\b/i);
});

test('email verification uses the stable event while password-reset requests remain separate security events',()=>{
  const send=auth.slice(auth.indexOf('async function sendEmail'),auth.indexOf('async function ownerMigrationRequired'));
  assert.match(send,/verification=template==='verify_email'/);
  assert.match(send,/emailVerificationNotificationEventKey\(accountId,to\)/);
  assert.match(send,/auth:\$\{template\}:\$\{accountId\}:\$\{Date\.now\(\)\}/);
  assert.match(send,/reopenInApp:verification/);
  assert.match(send,/reconcileEmailVerificationNotificationState\(pool/);
  assert.match(auth,/reconcileEmailVerificationNotificationState\(pool,\{accountId:used\.account_id,verified:true\}\)/);
});

test('controlled Customer geography remains deterministic and carries no invented personal address',()=>{
  assert.match(fixtures,/CUSTOMER_ALIAS='dropi\.deliveries\+testcustomer@gmail\.com'/);
  assert.match(fixtures,/DEFAULT_PSGC_CODE='0402103028'/);
  assert.match(fixtures,/saveAccountGeography/);
  assert.match(fixtures,/geographyByAccount\.get\(customer\.id\)/);
  assert.match(fixtures,/phone='',address=''/);
  assert.match(fixtures,/personal_data:false/);
});
