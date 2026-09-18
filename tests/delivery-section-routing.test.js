import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const ui=read('public/delivery-ui.js');

test('Delivery shell destinations route to distinct courier sections',()=>{
  for(const feature of ['Eligibility','Availability','Deliveries','Tracking']){
    assert.match(shell,new RegExp("['\"]"+feature+"['\"]"));
    assert.match(ui,new RegExp(feature));
  }
  assert.match(ui,/openCourierWorkspace\(b\.dataset\.hubFeature\)/);
  assert.doesNotMatch(ui,/b\.onclick=openCourierWorkspace/);
});

test('Courier workspace separates eligibility, availability, assigned work and tracking',()=>{
  assert.match(ui,/COURIER_SECTION_META/);
  assert.match(ui,/courierEligibilityPanel/);
  assert.match(ui,/courierAvailabilityPanel/);
  assert.match(ui,/courierDeliveriesPanel/);
  assert.match(ui,/courierTrackingPanel/);
  assert.match(ui,/delCourierSection=normalized/);
});

test('availability remains visibly blocked until explicit courier approval',()=>{
  assert.match(ui,/p\.eligibility_status==='approved'/);
  assert.match(ui,/Availability stays locked until Admin explicitly approves eligibility/);
  assert.match(ui,/approved\?'':'disabled'/);
  assert.match(ui,/Enabling this profile alone does not authorize delivery work/);
});

test('Active Route only includes active courier delivery states and preserves live Details',()=>{
  for(const state of ['courier_assigned','courier_en_route_to_merchant','courier_arrived_at_merchant','picked_up','in_transit','courier_arrived_at_customer']){
    assert.match(ui,new RegExp(state));
  }
  assert.match(ui,/COURIER_ACTIVE_STATES\.has\(x\.status\)/);
  assert.match(ui,/data-del-live/);
  assert.match(ui,/renderCourierWorkspace\(delCourierSection\)/);
});
