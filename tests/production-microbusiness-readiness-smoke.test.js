import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-microbusiness-readiness-smoke.js',import.meta.url),'utf8');

test('Production readiness smoke is rollback-only and company-test scoped',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/account_mode,test_role,email_verified_at/);
  assert.match(script,/createAccount\('merchant'/);
  assert.match(script,/createAccount\('service_provider'/);
  assert.match(script,/@business-life\.invalid/);
  assert.match(script,/INSERT INTO businesses/);
  assert.match(script,/INSERT INTO merchant_storefronts/);
  assert.match(script,/INSERT INTO service_provider_profiles/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
});

test('Production readiness smoke validates transition gate in both directions',()=>{
  assert.match(script,/microbusinessReadinessEnforcementMode\(process\.env\)!=='transition'/);
  assert.match(script,/Merchant readiness-only subject was not blocked/);
  assert.match(script,/Merchant eligible_full subject was not allowed/);
  assert.match(script,/Local Services readiness-only subject was not blocked/);
  assert.match(script,/Local Services eligible_full subject was not allowed/);
  assert.match(script,/evidenceChecklist:evidenceFor/);
});

test('Production readiness smoke does not call money/payment execution paths',()=>{
  assert.doesNotMatch(script,/paymongo|payment.*post|checkout|disbursement|withdrawal|transfer/i);
  assert.match(script,/real_money:false/);
});
