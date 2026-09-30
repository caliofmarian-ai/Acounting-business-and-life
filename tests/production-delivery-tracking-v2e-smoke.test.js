import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-delivery-tracking-v2e-smoke.js',import.meta.url),'utf8');

test('Delivery V2E Production smoke is rollback-only and company-test scoped',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/account_mode,test_role,email_verified_at/);
  assert.match(script,/createAccount\('customer'/);
  assert.match(script,/createAccount\('merchant'/);
  assert.match(script,/createAccount\('courier'/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
});

test('Delivery V2E Production smoke verifies route order, dedup and terminal privacy',()=>{
  assert.match(script,/deliveryRoutePointDecision/);
  assert.match(script,/Canonical normalized route point could not re-enter the sampling decision/);
  assert.match(script,/normalized_point_roundtrip:true/);
  assert.match(script,/Near duplicate route point was not deduplicated/);
  assert.match(script,/ORDER BY sequence_no/);
  assert.match(script,/Route point Courier binding is incorrect/);
  assert.match(script,/Terminal Delivery still allows route tracking/);
  assert.match(script,/last_lat=NULL,last_lng=NULL,last_location_at=NULL/);
});

test('Delivery V2E Production smoke verifies real Private Evidence Storage and cleanup',()=>{
  assert.match(script,/storePrivateEvidence\(pool/);
  assert.match(script,/readPrivateEvidence\(pool/);
  assert.match(script,/INSERT INTO delivery_proof_media/);
  assert.match(script,/deletePrivateEvidence\(pool/);
  assert.match(script,/proof_object_deleted:true/);
  assert.doesNotMatch(script,/checkout|PayMongo|disbursement|withdrawal/i);
  assert.match(script,/real_money:false/);
});
