import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth=readFileSync(new URL('../server-auth.js',import.meta.url),'utf8');

test('active runtime exposes Courier vehicle and capacity configuration before generic API fallback',()=>{
  const route=auth.indexOf("app.patch('/api/courier'");
  const fallback=auth.indexOf("app.use('/api'");
  assert.ok(route>=0,'Courier profile configuration route is missing from server-auth.js');
  assert.ok(fallback>route,'Courier route must be handled before Merchant accounting fallback');
  assert.match(auth,/role='courier' AND enabled=TRUE AND status='active'/);
  assert.match(auth,/max_weight_kg=\$3/);
  assert.match(auth,/max_volume_l=\$4/);
  assert.match(auth,/service_radius_km=\$5/);
});

test('Courier profile configuration cannot self-enable dispatch availability or eligibility',()=>{
  const start=auth.indexOf("app.patch('/api/courier'");
  const end=auth.indexOf("app.get('/api/context/:role'",start);
  const block=auth.slice(start,end);
  assert.match(block,/available=FALSE/);
  assert.doesNotMatch(block,/eligibility_status=/);
  assert.doesNotMatch(block,/approved_vehicle_class=/);
  assert.match(block,/Courier capacity values must be zero or greater/);
});
