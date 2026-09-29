import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=read('server-auth.js');
const hardening=read('server-auth-hardening.js');
const lifecycle=read('account-lifecycle-core.js');
const adminAuth=read('admin-authorization.js');
const adminFunctions=read('admin-functions.js');
const securityUi=read('public/auth-hardening-ui.js');

test('password registration is pending until email ownership is verified',()=>{
  assert.match(auth,/const accountStatus=companyTest\?'active':'pending_verification'/);
  assert.match(auth,/INSERT INTO accounts\(display_name,phone,email,address,active_role,password_salt,password_hash,auth_status,account_mode,test_role\)/);
  assert.match(hardening,/auth_status=CASE WHEN auth_status='pending_verification' THEN 'active' ELSE auth_status END/);
  assert.match(hardening,/UPDATE accounts[\s\S]*auth_status='pending_verification'[\s\S]*email_verified_at IS NULL/);
});

test('unverified sessions are useful for account security but cannot mutate operational state',()=>{
  assert.match(auth,/function unverifiedSelfServiceAllowed\(req\)/);
  assert.match(auth,/EMAIL_VERIFICATION_REQUIRED/);
  assert.match(auth,/req\.emailVerificationPending=pendingVerification/);
  assert.match(hardening,/function pendingVerificationMutationAllowed\(path,method\)/);
  assert.match(hardening,/pending&&!pendingVerificationMutationAllowed/);
  assert.match(hardening,/code:'EMAIL_VERIFICATION_REQUIRED'/);
});

test('changing a personal email invalidates previous ownership verification',()=>{
  const mePatch=auth.slice(auth.indexOf("app.patch('/api/me'"),auth.indexOf("app.put('/api/me/geography'"));
  assert.match(mePatch,/email_verified_at=CASE WHEN account_mode<>'company_test'/);
  assert.match(mePatch,/THEN NULL ELSE email_verified_at END/);
  assert.match(mePatch,/THEN 'pending_verification' ELSE auth_status END/);
});

test('self-service account deletion requires step-up, deterministic preflight and explicit DELETE confirmation',()=>{
  assert.match(hardening,/app\.get\('\/api\/auth\/account-closure\/preflight'/);
  assert.match(hardening,/app\.post\('\/api\/auth\/account-closure\/close'/);
  assert.match(hardening,/requireRecentStepUp\(req\)/);
  assert.match(hardening,/confirmation,40\)\.toUpperCase\(\)!=='DELETE'/);
  assert.match(hardening,/accountClosureAssessment\(pool,s\.accountId\)/);
  assert.match(hardening,/closeAccountSafely\(pool/);
  assert.match(hardening,/clearBrowserSessionCookies\(res\)/);
});

test('account closure core models finance, operations, support, safety and legal holds',()=>{
  for(const marker of [
    'account_closure_holds',
    'ACTIVE_ADMIN_AUTHORITY',
    'ACTIVE_BUSINESS_MEMBERSHIP',
    'OPEN_PROFILE_APPLICATION',
    'PROFILE_AUTHORIZATION',
    'SERVICE_CATEGORY_AUTHORIZATION',
    'OPEN_ORDER',
    'OPEN_PURCHASE_ORDER',
    'OPEN_DELIVERY',
    'OPEN_SERVICE_JOB',
    'UNSETTLED_PAYMENT',
    'UNSETTLED_REFUND',
    'UNSETTLED_MONEY_MOVEMENT',
    'OPEN_SUPPORT_OR_PRIVACY_CASE',
    'OPEN_TRUST_SAFETY_CASE'
  ])assert.ok(lifecycle.includes(marker),'missing account closure blocker: '+marker);
  assert.match(lifecycle,/account_closure_events/);
  assert.match(lifecycle,/auth_status='closed'/);
  assert.match(lifecycle,/anonymize_and_retain_required_history/);
});

test('closure minimizes authentication and payment destination data without deleting retained economic history',()=>{
  assert.match(lifecycle,/account_financial_destinations SET status='inactive'/);
  assert.match(lifecycle,/account_saved_payment_methods SET status='inactive'/);
  assert.match(lifecycle,/provider_destination_ref=''/);
  assert.match(lifecycle,/provider_payment_method_ref=''/);
  assert.match(lifecycle,/provider_subject=\('closed:'\|\|account_id::text\|\|':'\|\|id::text\)/);
  assert.match(lifecycle,/provider_email_snapshot=''/);
  assert.match(lifecycle,/revoked_at=COALESCE\(revoked_at,NOW\(\)\)/);
  assert.match(lifecycle,/SAVEPOINT account_lifecycle_optional_/);
  assert.doesNotMatch(lifecycle,/DELETE FROM payment_intents/);
  assert.doesNotMatch(lifecycle,/DELETE FROM orders/);
  assert.doesNotMatch(lifecycle,/DELETE FROM support_tickets/);
});

test('destructive purge is reserved for empty never-verified personal registrations',()=>{
  assert.match(lifecycle,/purgeEligible=account\.account_mode!=='company_test'&&!account\.email_verified_at&&blockers\.length===0&&meaningfulHistory===0/);
  assert.match(lifecycle,/ACCOUNT_PURGE_NOT_ELIGIBLE/);
  assert.match(lifecycle,/empty_unverified_registration_purged/);
  assert.match(lifecycle,/DELETE FROM accounts WHERE id=\$1 RETURNING id/);
});

test('Admin closure has a distinct delegated permission, step-up, scope and protected Super Admin guard',()=>{
  assert.match(adminAuth,/'members\.close_account'/);
  assert.match(adminFunctions,/member_account_controls[\s\S]*members\.close_account/);
  assert.match(hardening,/app\.get\('\/api\/admin\/members\/:accountId\/account-closure\/preflight'/);
  assert.match(hardening,/app\.post\('\/api\/admin\/members\/:accountId\/account-closure'/);
  assert.match(hardening,/requireAdminPermission\(pool,actor\.accountId,'members\.close_account',territoryId\)/);
  assert.match(hardening,/PROTECTED_SUPER_ADMIN/);
  assert.match(hardening,/member_account_closure_blocked/);
  assert.match(hardening,/member_empty_unverified_account_purged/);
});

test('Security & access exposes governed user deletion instead of a blind hard-delete button',()=>{
  assert.match(securityUi,/api\/auth\/account-closure\/preflight/);
  assert.match(securityUi,/<h2>Delete account<\/h2>/);
  assert.match(securityUi,/financial, security, Support and legal blocker check/);
  assert.match(securityUi,/api\/auth\/account-closure\/close/);
  assert.match(securityUi,/Type DELETE exactly to continue/);
});
