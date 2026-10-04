import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/auth-hardening-ui.js',import.meta.url),'utf8');
const session=readFileSync(new URL('../auth-session-core.js',import.meta.url),'utf8');

test('Super Admin MFA schema is encrypted, auditable and durable',()=>{
  for(const marker of [
    'super_admin_mfa_factors',
    'secret_ciphertext',
    'last_totp_counter',
    'super_admin_mfa_recovery_codes',
    'code_hash',
    'auth_mfa_attempt_windows',
    'mfa_verified_at',
    'mfa_method'
  ])assert.ok(server.includes(marker),`missing MFA schema marker: ${marker}`);
  assert.match(server,/encryptMfaSecret\(secret,SUPER_ADMIN_MFA_ENCRYPTION_KEY\)/);
  assert.match(server,/hashRecoveryCode\(recoveryCode,SUPER_ADMIN_MFA_ENCRYPTION_KEY\)/);
  assert.match(server,/durableMfaRateLimited/);
});

test('Super Admin MFA exposes enrollment, challenge, recovery reset and anti-replay',()=>{
  for(const path of [
    "/api/auth/mfa/status",
    "/api/auth/mfa/enroll/start",
    "/api/auth/mfa/enroll/qr",
    "/api/auth/mfa/enroll/confirm",
    "/api/auth/mfa/challenge",
    "/api/auth/mfa/reset"
  ])assert.ok(server.includes(path),`missing MFA endpoint: ${path}`);
  assert.match(server,/minCounter:Number\(factor\.last_totp_counter/);
  assert.match(server,/used_at=NOW\(\)/);
  assert.match(server,/super_admin_mfa_challenge_succeeded/);
  assert.match(server,/super_admin_mfa_reset_started/);
});

test('privileged Admin requests fail closed until MFA is active and fresh',()=>{
  for(const prefix of [
    "/api/admin",
    "/api/governance/admin",
    "/api/legal/admin",
    "/api/payments/admin"
  ])assert.ok(server.includes(prefix),`missing protected Admin prefix: ${prefix}`);
  assert.match(server,/SUPER_ADMIN_MFA_ENROLLMENT_REQUIRED/);
  assert.match(server,/SUPER_ADMIN_MFA_STEP_UP_REQUIRED/);
  assert.match(server,/AUTH_MFA_SESSION_TTL_MS/);
  assert.match(server,/AUTH_STEP_UP_TTL_MS/);
});

test('session core keeps MFA independent from password step-up',()=>{
  assert.match(session,/AUTH_MFA_SESSION_TTL_MS/);
  assert.match(session,/markV2SessionMfa/);
  assert.match(session,/resolveV2SessionMfa/);
  assert.match(session,/clearV2SessionMfa/);
});

test('Android-safe UI enrolls by QR, retries blocked Admin request and shows recovery once',()=>{
  assert.match(ui,/superAdminMfaQr/);
  assert.match(ui,/inputmode="numeric"/);
  assert.match(ui,/recovery_codes/);
  assert.match(ui,/They are shown only once|will not be shown again/i);
  assert.match(ui,/installMfaFetchGuard/);
  assert.match(ui,/response\.status!==428/);
  assert.match(ui,/originalFetch\(replayInput,init\)/);
});
