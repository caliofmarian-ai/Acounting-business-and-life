import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DELIVERY_PLATFORM_RATE_PCT,DELIVERY_FEE_BASIS,
  normalizeVehiclePricingRule,deliveryVehicleRuleEligible,
  calculateDeliveryPrice,selectDeliveryVehicleQuote,
  courierCanServeDelivery,deliveryPriceSplit
} from '../delivery-pricing-v2-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-delivery.js');
const ui=read('public/delivery-ui.js');
const pkg=read('package.json');

const rules=[
  {vehicle_class:'bicycle',formula_type:'base_plus_km',priority:10,base_fee:30,per_km:10,per_kg:999,per_liter:999,minimum_fee:40,maximum_distance_km:10,max_weight_kg:5,max_volume_l:20},
  {vehicle_class:'car',formula_type:'distance_weight_volume',priority:20,base_fee:50,per_km:15,per_kg:2,per_liter:0.5,minimum_fee:80,maximum_distance_km:30,max_weight_kg:100,max_volume_l:500},
  {vehicle_class:'van',formula_type:'distance_weight_volume',priority:30,base_fee:100,per_km:20,per_kg:3,per_liter:0.75,minimum_fee:150,maximum_distance_km:80,max_weight_kg:1000,max_volume_l:5000}
];

test('Owner Delivery economics uses 10% of verified delivery price',()=>{
  assert.equal(DELIVERY_PLATFORM_RATE_PCT,10);
  assert.equal(DELIVERY_FEE_BASIS,'verified_delivery_price');
  const promo=deliveryPriceSplit(100,{postPromo:false});
  assert.deepEqual(promo,{
    delivery_price:100,
    fee_basis:'verified_delivery_price',
    post_promo:false,
    platform_rate_pct:0,
    business_life_delivery_fee:0,
    courier_gross_entitlement:100
  });
  const post=deliveryPriceSplit(100,{postPromo:true});
  assert.equal(post.business_life_delivery_fee,10);
  assert.equal(post.courier_gross_entitlement,90);
  assert.equal(post.platform_rate_pct,10);
});

test('Bicycle formula is base plus km and ignores kg/litre as price multipliers',()=>{
  const r=normalizeVehiclePricingRule(rules[0]);
  assert.equal(r.formula_type,'base_plus_km');
  assert.equal(r.per_kg,0);
  assert.equal(r.per_liter,0);
  const q=calculateDeliveryPrice(r,{distanceKm:3,weightKg:4,volumeL:15});
  assert.equal(q.base_component,30);
  assert.equal(q.distance_component,30);
  assert.equal(q.weight_component,0);
  assert.equal(q.volume_component,0);
  assert.equal(q.delivery_price,60);
});

test('Bicycle still enforces weight volume and distance capacity',()=>{
  assert.equal(deliveryVehicleRuleEligible(rules[0],{distanceKm:3,weightKg:5,volumeL:20}),true);
  assert.equal(deliveryVehicleRuleEligible(rules[0],{distanceKm:3,weightKg:5.01,volumeL:20}),false);
  assert.equal(deliveryVehicleRuleEligible(rules[0],{distanceKm:3,weightKg:5,volumeL:20.01}),false);
  assert.equal(deliveryVehicleRuleEligible(rules[0],{distanceKm:10.01,weightKg:1,volumeL:1}),false);
});

test('Car and Van formulas include distance weight and volume',()=>{
  const car=calculateDeliveryPrice(rules[1],{distanceKm:3,weightKg:10,volumeL:20});
  assert.equal(car.distance_component,45);
  assert.equal(car.weight_component,20);
  assert.equal(car.volume_component,10);
  assert.equal(car.delivery_price,125);

  const van=calculateDeliveryPrice(rules[2],{distanceKm:10,weightKg:200,volumeL:800});
  assert.equal(van.distance_component,200);
  assert.equal(van.weight_component,600);
  assert.equal(van.volume_component,600);
  assert.equal(van.delivery_price,1500);
});

test('quote selects the smallest configured class that can carry the shipment',()=>{
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:3,weightKg:2,volumeL:10}).vehicle_class,'bicycle');
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:3,weightKg:10,volumeL:30}).vehicle_class,'car');
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:15,weightKg:200,volumeL:600}).vehicle_class,'van');
});

test('minimum vehicle class can intentionally prevent Bicycle selection',()=>{
  const q=selectDeliveryVehicleQuote(rules,{distanceKm:3,weightKg:2,volumeL:10,minimumVehicleClass:'car'});
  assert.equal(q.vehicle_class,'car');
});

test('quote fails closed if no configured class can carry the delivery',()=>{
  assert.throws(
    ()=>selectDeliveryVehicleQuote(rules,{distanceKm:100,weightKg:2000,volumeL:8000}),
    e=>e?.code==='DELIVERY_NO_ELIGIBLE_VEHICLE_CLASS'
  );
});

test('courier assignment requires exact quoted class capacity and radius',()=>{
  const delivery={required_vehicle_class:'car',estimated_weight_kg:20,estimated_volume_l:100,route_distance_km:12};
  assert.deepEqual(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:150,service_radius_km:15},delivery),{allowed:true,reason:'READY'});
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'bicycle',max_weight_kg:30,max_volume_l:150,service_radius_km:15},delivery).reason,'VEHICLE_CLASS_MISMATCH');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:10,max_volume_l:150,service_radius_km:15},delivery).reason,'COURIER_WEIGHT_CAPACITY_EXCEEDED');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:50,service_radius_km:15},delivery).reason,'COURIER_VOLUME_CAPACITY_EXCEEDED');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:150,service_radius_km:10},delivery).reason,'COURIER_SERVICE_RADIUS_EXCEEDED');
});

test('delivery runtime stores class-specific quote snapshot and required vehicle class',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS delivery_vehicle_pricing_rules/);
  assert.match(server,/required_vehicle_class TEXT NOT NULL DEFAULT ''/);
  assert.match(server,/pricing_snapshot JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(server,/selectDeliveryVehicleQuote\(vehicleRules/);
  assert.match(server,/vehicle_pricing_rule_id/);
  assert.match(server,/formula_type/);
  assert.match(server,/price_breakdown/);
  assert.match(server,/quote\.required_vehicle_class/);
});

test('Admin V2 pricing API requires Bicycle Car and Van rules without hardcoded PHP rates',()=>{
  assert.match(server,/V2 pricing requires bicycle, car and van rules/);
  assert.match(server,/normalizeVehiclePricingRule/);
  assert.match(server,/delivery_vehicle_pricing_rules/);
  assert.match(server,/for\(const cls of \['bicycle','car','van'\]\)/);
  assert.doesNotMatch(ui,/\/api\/admin\/delivery\/pricing/);
  assert.doesNotMatch(ui,/Admin • Delivery pricing/);
});

test('Admin assignment server enforces quote vehicle capacity and radius outside Merchant UI',()=>{
  assert.match(server,/courierCanServeDelivery\(courier,d\)/);
  assert.match(server,/VEHICLE_CLASS_MISMATCH/);
  assert.match(server,/COURIER_WEIGHT_CAPACITY_EXCEEDED/);
  assert.match(server,/COURIER_VOLUME_CAPACITY_EXCEEDED/);
  assert.match(server,/COURIER_SERVICE_RADIUS_EXCEEDED/);
  assert.match(server,/c\.max_weight_kg,c\.max_volume_l,c\.service_radius_km/);
  assert.doesNotMatch(ui,/data-del-assign/);
  assert.doesNotMatch(ui,/\/api\/admin\/deliveries/);
  assert.doesNotMatch(ui,/Vehicle override \(optional\)/);
});

test('Delivery checkout rejects disabled storefronts and invalid quote ids before PostgreSQL bigint queries',()=>{
  const start=server.indexOf("app.post('/api/marketplace/checkout'");
  const end=server.indexOf("app.put('/api/delivery/store-location'",start);
  assert.ok(start>=0&&end>start);
  const checkout=server.slice(start,end);
  assert.match(checkout,/Number\.isInteger\(businessId\)/);
  assert.match(checkout,/SELECT delivery_enabled FROM merchant_storefronts/);
  assert.match(checkout,/Delivery is not enabled for this Merchant/);
  assert.match(checkout,/Number\.isInteger\(quoteId\)/);
  assert.match(checkout,/Delivery quote is missing or expired/);
  assert.doesNotMatch(checkout,/\[quoteId,me\.account\.id,Number\(req\.body\.business_id\)\]/);
});

test('completed Delivery monetization event uses delivery_fee as gross fee base',()=>{
  assert.match(server,/serviceScope:'delivery'[\s\S]*grossValue:x\.delivery_fee/);
});

test('project syntax contract checks Delivery Pricing V2 core and tests',()=>{
  assert.match(pkg,/node --check delivery-pricing-v2-core\.js/);
  assert.match(pkg,/node --check tests\/delivery-pricing-v2\.test\.js/);
});
