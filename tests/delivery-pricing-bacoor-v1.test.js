import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACOOR_CAVITE_PRICING_V1,
  BACOOR_CAVITE_PRICING_V1_KEY,
  normalizedBacoorCavitePricingV1Rules
} from '../delivery-pricing-bacoor-v1.js';
import {
  calculateDeliveryQuoteTotal,
  selectDeliveryVehicleQuote
} from '../delivery-pricing-v2-core.js';

const rules=()=>normalizedBacoorCavitePricingV1Rules();
const byClass=cls=>rules().find(rule=>rule.vehicle_class===cls);

test('Bacoor/Cavite Production V1 is explicit, versionable and launch-surge-free',()=>{
  assert.equal(BACOOR_CAVITE_PRICING_V1_KEY,'bacoor-cavite-market-2026-10-01-v1');
  assert.equal(BACOOR_CAVITE_PRICING_V1.country_code,'PH');
  assert.equal(BACOOR_CAVITE_PRICING_V1.currency_code,'PHP');
  assert.equal(BACOOR_CAVITE_PRICING_V1.benchmark_date,'2026-10-01');
  assert.deepEqual(rules().map(rule=>rule.vehicle_class),['motorcycle','sedan','l300_van']);
  for(const rule of rules()){
    assert.equal(rule.formula_type,'tiered_distance');
    assert.equal(rule.demand_adjustment_cap_pct,0);
    assert.equal(rule.stacking_policy,'direct_only');
    assert.equal(rule.maximum_distance_km,40);
  }
});

test('Bacoor/Cavite motorcycle totals match the current public benchmark formula',()=>{
  const rule=byClass('motorcycle');
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:3}).customer_delivery_total,67);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5}).customer_delivery_total,79);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:10}).customer_delivery_total,104);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:40}).customer_delivery_total,254);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5},{extra_stops:1}).customer_delivery_total,119);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5},{waiting_minutes:31}).customer_delivery_total,80);
  assert.equal(rule.route_profile,'motorcycle_no_expressway');
  assert.equal(rule.expressway_eligible,false);
  assert.equal(rule.toll_policy,'disabled');
});

test('Bacoor/Cavite sedan totals and waiting rule match the approved Production V1',()=>{
  const rule=byClass('sedan');
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:3}).customer_delivery_total,154);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5}).customer_delivery_total,190);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:10}).customer_delivery_total,265);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:40}).customer_delivery_total,715);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5},{waiting_minutes:31}).customer_delivery_total,191.67);
  assert.equal(rule.toll_policy,'pass_through');
});

test('Bacoor/Cavite L300 totals match the approved Production V1',()=>{
  const rule=byClass('l300_van');
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:3}).customer_delivery_total,340);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5}).customer_delivery_total,380);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:10}).customer_delivery_total,480);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:40}).customer_delivery_total,1080);
  assert.equal(calculateDeliveryQuoteTotal(rule,{distanceKm:5},{waiting_minutes:61}).customer_delivery_total,382.5);
});

test('Production V1 vehicle selection escalates by capacity instead of adding hidden kg/litre fees',()=>{
  const all=rules();
  assert.equal(selectDeliveryVehicleQuote(all,{distanceKm:5,weightKg:5,volumeL:20}).vehicle_class,'motorcycle');
  assert.equal(selectDeliveryVehicleQuote(all,{distanceKm:5,weightKg:50,volumeL:100}).vehicle_class,'sedan');
  assert.equal(selectDeliveryVehicleQuote(all,{distanceKm:5,weightKg:500,volumeL:1000}).vehicle_class,'l300_van');
  for(const rule of all){
    assert.equal(rule.per_kg,0);
    assert.equal(rule.per_liter,0);
  }
});
