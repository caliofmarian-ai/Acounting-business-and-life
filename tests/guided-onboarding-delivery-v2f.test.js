import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_COURIER_STEPS,
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const delivery=read('public/delivery-ui.js');
const shell=read('public/shell.js');
const settings=read('public/profile-settings-ui.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Delivery has its own versioned complete journey while Local Services remains on the V2B foundation',()=>{
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.customer.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.merchant.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.supplier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.courier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.service_provider.version,1);
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.courier.steps,GUIDED_ONBOARDING_COURIER_STEPS);
  assert.match(core,/journey_version DESC LIMIT 1/);
  assert.match(core,/normalizeProfileCompleted\(previousRow\.completed_steps,role\)/);
});

test('Delivery privacy money proof and safety education precede Profile Settings',()=>{
  assert.deepEqual(GUIDED_ONBOARDING_COURIER_STEPS,[
    'profile_welcome',
    'courier_eligibility_vehicle',
    'courier_availability_area',
    'courier_assignments_workflow',
    'courier_customer_privacy',
    'courier_navigation_location',
    'courier_handoff_evidence',
    'courier_money_earnings',
    'courier_settlement_payout',
    'courier_safety_support',
    'profile_settings'
  ]);
  const settingsIndex=GUIDED_ONBOARDING_COURIER_STEPS.indexOf('profile_settings');
  for(const step of [
    'courier_customer_privacy','courier_navigation_location','courier_handoff_evidence',
    'courier_money_earnings','courier_settlement_payout','courier_safety_support'
  ])assert.ok(GUIDED_ONBOARDING_COURIER_STEPS.indexOf(step)<settingsIndex,step);
});

test('Delivery tour covers authorization availability jobs privacy navigation proof money payout safety support and settings',()=>{
  assert.match(ui,/function courierProfileJourneyDefinition/);
  for(const key of [
    'courier_tour.eligibility_body','courier_tour.availability_body','courier_tour.assignments_body',
    'courier_tour.privacy_body','courier_tour.navigation_body','courier_tour.handoff_body',
    'courier_tour.money_body','courier_tour.settlement_body','courier_tour.support_body'
  ])assert.ok(ui.includes(key),key);
});

test('Delivery coachmarks point at real Courier operational, money and settings controls',()=>{
  for(const marker of [
    'COURIER_SECTION_META','courierEligibilityPanel','courierAvailabilityPanel',
    'courierDeliveriesPanel','courierTrackingPanel','data-courier-status',
    'data-share-location','data-complete-delivery','Customer handoff code'
  ])assert.ok(delivery.includes(marker),marker);
  for(const marker of [
    'id="courierHomeStatus"','id="courierHomeWork"','id="courierHomeMoney"',
    'data-courier-nav="deliveries"','data-courier-nav="money"',
    'data-hub-feature="Profile Settings"'
  ])assert.ok(shell.includes(marker),marker);
  assert.match(settings,/data-profile-settings-view="finance"/);
  assert.match(settings,/id="openAccountMoneyFromProfile"/);
  assert.match(ui,/courierJourneyTarget\('#courierHomeStatus'/);
  assert.match(ui,/courierJourneyTarget\('\[data-courier-home-open="Tracking"\]'/);
  assert.match(ui,/courierJourneyTarget\('\[data-complete-delivery\]'/);
});

test('Delivery journey is explanatory only and never changes availability job status location money or payout automatically',()=>{
  const start=ui.indexOf('function courierProfileJourneyDefinition');
  const end=ui.indexOf('function profileJourneyDefinition',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/\.click\(|fetch\(|dapi\(|profileApi\(|active-role|applyActiveRole|toggleProfile/);
  assert.doesNotMatch(block,/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]|JSON\.stringify\s*\(/i);
});

test('Delivery copy preserves authorization privacy location handoff and money evidence boundaries',()=>{
  assert.match(en['courier_tour.eligibility_body'],/only explicit Admin approval/i);
  assert.match(en['courier_tour.availability_body'],/not a public home address/i);
  assert.match(en['courier_tour.privacy_body'],/assigned delivery only/i);
  assert.match(en['courier_tour.navigation_body'],/only for an active assigned delivery/i);
  assert.match(en['courier_tour.navigation_body'],/must stop when the delivery ends/i);
  assert.match(en['courier_tour.handoff_body'],/do not ask for it early/i);
  assert.match(en['courier_tour.money_body'],/delivery charge is not automatically your earnings/i);
  assert.match(en['courier_tour.settlement_body'],/provider evidence confirms it/i);
  assert.match(en['courier_tour.support_body'],/Keep incident evidence private/i);
});

test('Every Delivery onboarding key is translated to Filipino and neither locale exposes internal territory mechanics',()=>{
  const keys=Object.keys(en).filter(k=>k.startsWith('courier_tour.'));
  assert.ok(keys.length>=27);
  for(const key of keys){
    assert.ok(fil[key],'missing Filipino key '+key);
    assert.doesNotMatch(en[key],/territory demand|expansion signal|re-detection/i);
    assert.doesNotMatch(fil[key],/territory demand|expansion signal|re-detection/i);
  }
});

test('Delivery dispatcher uses the Courier journey before generic profile fallback',()=>{
  const start=ui.indexOf('function profileJourneyDefinition');
  const end=ui.indexOf('function renderProfileJourney',start);
  const block=ui.slice(start,end);
  assert.match(block,/if\(role==='courier'\)/);
  assert.match(block,/courierProfileJourneyDefinition\(journey,label\)/);
});
