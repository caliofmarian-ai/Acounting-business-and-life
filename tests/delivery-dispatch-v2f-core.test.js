import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryOfferCanRespond,
  deliveryOfferSafeView,
  deliveryOfferCourierGate,
  deliveryAssignmentActive
} from '../delivery-dispatch-v2f-core.js';

const delivery={
  required_vehicle_class:'motorcycle',
  estimated_weight_kg:2,
  estimated_volume_l:4,
  route_distance_km:3
};
const courier={
  available:true,
  eligibility_status:'approved',
  approved_vehicle_class:'motorcycle',
  max_weight_kg:10,
  max_volume_l:20,
  service_radius_km:10
};

test('pending offer is the only respondable offer state',()=>{
  assert.equal(deliveryOfferCanRespond('pending'),true);
  for(const state of ['accepted','declined','withdrawn','expired'])assert.equal(deliveryOfferCanRespond(state),false,state);
});

test('offer view contains decision context but never exact Customer destination/contact',()=>{
  const view=deliveryOfferSafeView({
    id:7,delivery_id:8,offer_round:2,status:'pending',
    order_number:'BL-1',business_name:'Merchant',
    route_distance_km:3.2,estimated_weight_kg:1,estimated_volume_l:2,
    required_vehicle_class:'motorcycle',delivery_fee:120,currency_code:'PHP',
    dropoff_address:'SECRET',dropoff_lat:1,dropoff_lng:2,customer_name:'SECRET'
  });
  assert.equal(view.business_name,'Merchant');
  assert.equal(view.route_distance_km,3.2);
  assert.equal(Object.hasOwn(view,'dropoff_address'),false);
  assert.equal(Object.hasOwn(view,'dropoff_lat'),false);
  assert.equal(Object.hasOwn(view,'dropoff_lng'),false);
  assert.equal(Object.hasOwn(view,'customer_name'),false);
});

test('Courier offer gate requires available approved authorized capacity-matching Courier',()=>{
  assert.equal(deliveryOfferCourierGate(courier,delivery,{territoryAuthorized:true}).allowed,true);
  assert.equal(deliveryOfferCourierGate({...courier,available:false},delivery,{territoryAuthorized:true}).reason,'COURIER_NOT_AVAILABLE');
  assert.equal(deliveryOfferCourierGate(courier,delivery,{territoryAuthorized:false}).reason,'COURIER_TERRITORY_NOT_AUTHORIZED');
  assert.equal(deliveryOfferCourierGate(courier,delivery,{territoryAuthorized:true,hasActiveDelivery:true}).reason,'COURIER_ALREADY_ACTIVE');
  assert.equal(deliveryOfferCourierGate({...courier,approved_vehicle_class:'bicycle'},delivery,{territoryAuthorized:true}).reason,'VEHICLE_CLASS_MISMATCH');
});

test('accepted assignment is active but awaiting offer is not',()=>{
  assert.equal(deliveryAssignmentActive('awaiting_courier'),false);
  assert.equal(deliveryAssignmentActive('courier_assigned'),true);
  assert.equal(deliveryAssignmentActive('in_transit'),true);
  assert.equal(deliveryAssignmentActive('delivered'),false);
});
