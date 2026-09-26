import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const delivery=readFileSync(new URL('../server-delivery.js',import.meta.url),'utf8');

test('delivery privacy view expires exact destination access outside the Customer account',()=>{
  assert.match(delivery,/function deliveryPrivacyView\(d,audience='other'\)/);
  assert.match(delivery,/const active=activeTracking\(d\.status\)/);
  assert.match(delivery,/const exactDestination=audience==='customer'\|\|\(active&&\['courier','merchant','admin'\]\.includes\(audience\)\)/);
  assert.match(delivery,/dropoff_address:exactDestination\?d\.dropoff_address:''/);
  assert.match(delivery,/dropoff_lat:exactDestination\?d\.dropoff_lat:null/);
  assert.match(delivery,/dropoff_lng:exactDestination\?d\.dropoff_lng:null/);
  assert.match(delivery,/last_location_at:active\?d\.last_location_at:null/);
});

test('Merchant and Courier history use the redacted delivery privacy view',()=>{
  assert.match(delivery,/api\/delivery\/merchant[\s\S]*?rows\.map\(d=>deliveryPrivacyView\(d,'merchant'\)\)/);
  assert.match(delivery,/api\/courier\/delivery-profile[\s\S]*?deliveries:deliveries\.rows\.map\(d=>deliveryPrivacyView\(d,'courier'\)\)/);
});

test('Courier terminal completion response no longer returns the exact Customer destination',()=>{
  const start=delivery.indexOf("app.post('/api/courier/deliveries/:id/complete'");
  const end=delivery.indexOf("app.get('/api/delivery/mine'",start);
  const block=delivery.slice(start,end);
  assert.match(block,/res\.json\(deliveryPrivacyView\(await deliveryDetail\(id\),'courier'\)\)/);
  assert.doesNotMatch(block,/res\.json\(await deliveryDetail\(id\)\)/);
});

test('live delivery view derives audience and redacts terminal destination for non-Customer actors',()=>{
  const start=delivery.indexOf("app.get('/api/delivery/:id/live'");
  const end=delivery.indexOf("app.get('/api/admin/delivery/pricing'",start);
  const block=delivery.slice(start,end);
  assert.match(block,/audience=deliveryAudience\(me,d\)/);
  assert.match(block,/view=deliveryPrivacyView\(d,audience\)/);
  assert.match(block,/const customer=audience==='customer'/);
  assert.match(block,/distance_to_dropoff_km:activeTracking\(d\.status\)/);
});

test('Admin dispatch history also loses exact destination after terminal states',()=>{
  assert.match(delivery,/api\/admin\/deliveries[\s\S]*?rows\.map\(d=>deliveryPrivacyView\(d,'admin'\)\)/);
});
