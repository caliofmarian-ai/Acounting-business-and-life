import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-delivery-dispatch-v2g-smoke.js',import.meta.url),'utf8');

test('Delivery V2G Production smoke is rollback-only and company-test scoped',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/account_mode,test_role,email_verified_at/);
  assert.match(script,/company_test/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
});

test('Delivery V2G Production smoke verifies expiry cannot assign and retry can',()=>{
  assert.match(script,/status='expired'/);
  assert.match(script,/Expired offer could still claim/);
  assert.match(script,/dispatch_round=2/);
  assert.match(script,/Fresh retry offer could not claim/);
  assert.match(script,/ttl_seconds:ttl/);
});

test('Delivery V2G Production smoke has no real-money path',()=>{
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/PayMongo|checkout|disbursement|withdrawal/i);
});
