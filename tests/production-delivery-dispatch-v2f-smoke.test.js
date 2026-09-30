import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-delivery-dispatch-v2f-smoke.js',import.meta.url),'utf8');

test('Delivery V2F Production smoke is rollback-only and company-test scoped',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/account_mode,test_role,email_verified_at/);
  assert.match(script,/company_test/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
});

test('Delivery V2F Production smoke covers refusal, re-offer and first-accept assignment',()=>{
  assert.match(script,/status='declined'/);
  assert.match(script,/dispatch_round=2/);
  assert.match(script,/status='courier_assigned'/);
  assert.match(script,/Second Courier incorrectly claimed/);
  assert.match(script,/competing_offer_withdrawn:true/);
});

test('Delivery V2F Production smoke protects pre-accept privacy and notification contract',()=>{
  assert.match(script,/deliveryOfferSafeView/);
  assert.match(script,/Pre-accept safe offer leaked/);
  assert.match(script,/delivery\.offer_received/);
  assert.match(script,/delivery\.assigned/);
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/PayMongo|checkout|disbursement|withdrawal/i);
});
