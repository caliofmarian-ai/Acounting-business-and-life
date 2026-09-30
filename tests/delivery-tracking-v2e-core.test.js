import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_ROUTE_POINT_LIMIT,
  deliveryRouteTrackingActive,
  normalizeDeliveryRoutePoint,
  deliveryRoutePointDecision,
  deliveryProofAllowed
} from '../delivery-tracking-v2e-core.js';

test('route tracking starts only after Courier starts the assigned workflow',()=>{
  assert.equal(deliveryRouteTrackingActive('courier_assigned'),false);
  for(const status of [
    'courier_en_route_to_merchant','courier_arrived_at_merchant',
    'picked_up','in_transit','courier_arrived_at_customer'
  ])assert.equal(deliveryRouteTrackingActive(status),true,status);
  for(const status of ['quoted','awaiting_courier','delivered','failed','cancelled']){
    assert.equal(deliveryRouteTrackingActive(status),false,status);
  }
});

test('route point normalization bounds optional device telemetry',()=>{
  assert.deepEqual(
    normalizeDeliveryRoutePoint({lat:14.4,lng:120.9,accuracy_m:15,heading_deg:370,speed_mps:4}),
    {latitude:14.4,longitude:120.9,accuracy_m:15,heading_deg:10,speed_mps:4}
  );
  assert.throws(()=>normalizeDeliveryRoutePoint({lat:100,lng:120}),/Valid coordinates/);
});

test('normalized route point can safely pass through the dedup decision again',()=>{
  const normalized=normalizeDeliveryRoutePoint({
    lat:14.4,lng:120.9,accuracy_m:12,heading_deg:45,speed_mps:3
  });
  const result=deliveryRoutePointDecision({
    previous:null,
    next:normalized,
    pointCount:0
  });
  assert.equal(result.append,true);
  assert.equal(result.point.latitude,14.4);
  assert.equal(result.point.longitude,120.9);
});

test('near-duplicate route points are not appended',()=>{
  const previous={latitude:14.400000,longitude:120.900000,recorded_at:'2026-09-30T10:00:00.000Z'};
  const result=deliveryRoutePointDecision({
    previous,
    next:{lat:14.400010,lng:120.900010,accuracy_m:8},
    pointCount:10,
    nowMs:new Date('2026-09-30T10:00:05.000Z').getTime()
  });
  assert.equal(result.append,false);
  assert.equal(result.reason,'deduplicated');
});

test('route history is bounded while current-location compatibility may continue separately',()=>{
  const result=deliveryRoutePointDecision({
    next:{lat:14.4,lng:120.9},
    pointCount:DELIVERY_ROUTE_POINT_LIMIT
  });
  assert.equal(result.append,false);
  assert.equal(result.reason,'route_point_limit');
});

test('pickup and delivery proofs are lifecycle-scoped',()=>{
  assert.equal(deliveryProofAllowed('pickup','courier_arrived_at_merchant'),true);
  assert.equal(deliveryProofAllowed('pickup','picked_up'),true);
  assert.equal(deliveryProofAllowed('pickup','in_transit'),false);
  assert.equal(deliveryProofAllowed('delivery','courier_arrived_at_customer'),true);
  assert.equal(deliveryProofAllowed('delivery','delivered'),false);
});
