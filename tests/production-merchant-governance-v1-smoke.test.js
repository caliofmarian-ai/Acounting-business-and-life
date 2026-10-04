import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-merchant-governance-v1-smoke.js',import.meta.url),'utf8');

test('Production Merchant Governance smoke is rollback-only and synthetic company-test scoped',()=>{
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

test('Production Merchant Governance smoke validates canonical projection and review evidence',()=>{
  assert.match(script,/applicationStatusAfterSave/);
  assert.match(script,/applicationStatusAfterSubmit/);
  assert.match(script,/applicationStatusAfterReview/);
  assert.match(script,/profileProjectionForApplication/);
  assert.match(script,/profile_application_reviews/);
  assert.match(script,/evidence_attestation_retained/);
  assert.match(script,/review_time_retained/);
  assert.match(script,/PRODUCTION_MERCHANT_GOVERNANCE_SMOKE_RESULT/);
});
