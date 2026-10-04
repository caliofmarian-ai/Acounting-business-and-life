import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-super-admin-mfa-smoke.js',import.meta.url),'utf8');

test('Production Super Admin MFA smoke is production-only, synthetic and rollback-only',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/account_mode,test_role,email_verified_at/);
  assert.match(script,/@business-life\.invalid/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
  assert.match(script,/rollback:true/);
  assert.match(script,/real_money:false/);
});

test('Production Super Admin MFA smoke verifies schema, encryption, anti-replay, recovery, session state and durable rate limit',()=>{
  for(const marker of [
    'super_admin_mfa_factors',
    'super_admin_mfa_recovery_codes',
    'auth_mfa_attempt_windows',
    'mfa_verified_at',
    'mfa_method',
    'encryptMfaSecret',
    'verifyTotpCode',
    'last_totp_counter',
    'used_at IS NULL',
    'markV2SessionMfa',
    'resolveV2SessionMfa',
    'durable_rate_limit',
    'PRODUCTION_SUPER_ADMIN_MFA_SMOKE_RESULT'
  ])assert.ok(script.includes(marker),`missing production MFA smoke marker: ${marker}`);
  assert.doesNotMatch(script,/console\.(?:log|error)\([^\n]*(?:rfcSecret|recoveryCode|keyMaterial|TOKEN_SECRET)/);
});
