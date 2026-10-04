import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-customer-qa-768-smoke.js',import.meta.url),'utf8');

test('Production Customer QA smoke is read-only and Production-gated',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/read_only:true/);
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCOMMIT\b|\bROLLBACK\b/i);
});

test('Production Customer QA smoke verifies notification dedupe and controlled geography',()=>{
  for(const marker of [
    'dropi.deliveries+testcustomer@gmail.com',
    '0402103028',
    'auth.email_verification',
    'auth.password_reset',
    'active_rows',
    'account_geography_assignments',
    'ACCOUNT_TERRITORY_NOT_OPEN',
    'PRODUCTION_CUSTOMER_QA_768_SMOKE_RESULT'
  ])assert.ok(script.includes(marker),'missing #768 Production smoke marker: '+marker);
  assert.match(script,/activeRows>1\|\|activeKeys>1/);
  assert.match(script,/email_verified_at&&activeRows!==0/);
});
