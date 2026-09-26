import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dispatcher=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const courier=readFileSync(new URL('../qa-courier-acceptance.js',import.meta.url),'utf8');

test('Courier experience wave is registered and isolated behind the QA dispatcher',()=>{
  assert.match(dispatcher,/COURIER_ALIAS='dropi\.deliveries\+testcourier@gmail\.com'/);
  assert.match(dispatcher,/COURIER_EXPERIENCE_WAVE='courier_experience_v1'/);
  assert.match(dispatcher,/runCourierExperienceAcceptance/);
  assert.match(dispatcher,/config\.wave===COURIER_EXPERIENCE_WAVE/);
});

test('Courier acceptance uses invite-first governance and Admin eligibility',()=>{
  for(const marker of [
    '/api/governance/admin/invitations',
    '/api/governance/invitations/',
    '/api/governance/admin/applications/',
    '/api/courier/documents',
    '/api/admin/couriers/',
    '/api/courier/availability'
  ]) assert.ok(courier.includes(marker),'missing Courier governance marker: '+marker);
  assert.match(courier,/approved_vehicle_class:'bicycle'/);
  assert.match(courier,/eligibility_status:'approved'/);
});

test('Courier acceptance exercises real delivery lifecycle and secure completion',()=>{
  for(const marker of [
    '/api/delivery/quote',
    '/api/marketplace/checkout',
    '/api/delivery/store-location',
    '/api/delivery/',
    '/request-courier',
    '/api/admin/delivery/eligible-couriers',
    '/api/admin/deliveries/',
    '/api/courier/deliveries/',
    'courier_en_route_to_merchant',
    'courier_arrived_at_merchant',
    'picked_up',
    'in_transit',
    'courier_arrived_at_customer',
    'completion_code'
  ]) assert.ok(courier.includes(marker),'missing Courier E2E marker: '+marker);
  assert.match(courier,/incorrect completion-code denial/);
  assert.match(courier,/live_tracking_closed_after_completion:true/);
});

test('Courier digital payment is server-authoritative PayMongo QA evidence',()=>{
  assert.match(courier,/payMongoRuntimeConfig/);
  assert.match(courier,/checkout_session\.payment\.paid/);
  assert.match(courier,/paymongo-signature/);
  assert.match(courier,/createHmac\('sha256'/);
  assert.match(courier,/provider_code:'paymongo'/);
  assert.match(courier,/intent_status!=='succeeded'/);
  assert.doesNotMatch(courier,/UPDATE payment_intents SET status='succeeded'/);
  assert.doesNotMatch(courier,/UPDATE orders SET payment_status='paid'/);
});

test('Courier finance preserves 30-day promo and settlement boundaries',()=>{
  assert.match(courier,/promo_duration_days!==30/);
  assert.match(courier,/promotional_days:30/);
  assert.match(courier,/component_code='courier_net'/);
  assert.match(courier,/courier_compensation_runtime:'TRACKED'/);
  assert.match(courier,/HOLD_FOR_CONTROLLED_LIVE_PILOT/);
  assert.match(courier,/HOLD_FOR_PROVIDER_EVIDENCE/);
});
