import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Auth Runtime V6 has a bounded dedicated acceptance wave',()=>{
  assert.match(qa,/const AUTH_RUNTIME_V6_WAVE='auth_runtime_v6'/);
  assert.match(qa,/runAuthRuntimeV6Acceptance/);
  assert.match(qa,/config\.wave===AUTH_RUNTIME_V6_WAVE/);
  assert.match(qa,/wave:AUTH_RUNTIME_V6_WAVE/);
});

test('Auth Runtime V6 acceptance covers the security and recovery invariants',()=>{
  for(const marker of [
    "'/api/me'",
    "'/api/auth/sessions/revoke-others'",
    "'/api/login'",
    "'legacy.qa.signature'",
    "'/api/auth/email-verification/verify'",
    "'/api/auth/forgot-password'",
    "'/api/auth/reset-password'",
    "'/api/auth/logout'",
    "'/api/auth/google/start'",
    "'/api/auth/google/link/start'",
    "'/api/auth/google/callback'",
    "'/api/auth/oauth/handoff'"
  ]) assert.ok(qa.includes(marker),`missing auth V6 acceptance marker: ${marker}`);
  assert.match(qa,/expectStatus\(retiredPin,410/);
  assert.match(qa,/expectStatus\(legacy,401/);
  assert.match(qa,/expectStatus\(revokedFirst,401/);
  assert.match(qa,/expectStatus\(invalidVerification,400/);
  assert.match(qa,/QA credential restore failed/);
});
