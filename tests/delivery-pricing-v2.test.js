import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DELIVERY_CANONICAL_VEHICLE_CLASSES,DELIVERY_PLATFORM_RATE_PCT,DELIVERY_FEE_BASIS,
  canonicalDeliveryVehicleClass,normalizeVehiclePricingRule,deliveryVehicleRuleEligible,
  calculateDeliveryPrice,calculateDeliveryQuoteTotal,selectDeliveryVehicleQuote,
  courierCanServeDelivery,deliveryPriceSplit
} from '../delivery-pricing-v2-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-delivery.js');
const adminGateway=read('server-admin-operations.js');
const ui=read('public/delivery-ui.js');
const pkg=read('package.json');
const qa=read('qa-acceptance.js');

const motorcycle={
  vehicle_class:'motorcycle',formula_type:'tiered_distance',priority:10,
  base_fee:27,included_distance_km:3,
  distance_bands:[
    {up_to_km:5,per_km:9.5},
    {up_to_km:15,per_km:5.75},
    {up_to_km:null,per_km:5}
  ],
  minimum_fee:27,maximum_distance_km:40,max_weight_kg:20,max_volume_l:80,
  extra_stop_fee:35,free_wait_minutes:30,waiting_fee_per_minute:1,
  demand_adjustment_cap_pct:25,route_profile:'motorcycle_no_expressway',
  toll_policy:'disabled',parking_policy:'pass_through',stacking_policy:'direct_only'
};
const sedan={
  vehicle_class:'sedan',formula_type:'tiered_distance',priority:20,
  base_fee:65,included_distance_km:0,
  distance_bands:[
    {up_to_km:5,per_km:15},
    {up_to_km:null,per_km:13}
  ],
  minimum_fee:65,maximum_distance_km:40,max_weight_kg:200,max_volume_l:700,
  extra_stop_fee:40,free_wait_minutes:30,waiting_fee_per_minute:1.5,
  demand_adjustment_cap_pct:25,route_profile:'car_optional_tolls',
  toll_policy:'pass_through',parking_policy:'pass_through',stacking_policy:'direct_only'
};
const van={
  vehicle_class:'l300_van',formula_type:'tiered_distance',priority:30,
  base_fee:250,included_distance_km:0,
  distance_bands:[{up_to_km:null,per_km:17}],
  minimum_fee:250,maximum_distance_km:100,max_weight_kg:1000,max_volume_l:3000,
  extra_stop_fee:90,free_wait_minutes:60,waiting_fee_per_minute:2.25,
  demand_adjustment_cap_pct:25,route_profile:'light_commercial_optional_tolls',
  toll_policy:'pass_through',parking_policy:'pass_through',stacking_policy:'direct_only'
};

test('V2B has canonical Philippine delivery vehicle classes and migration aliases',()=>{
  assert.deepEqual(DELIVERY_CANONICAL_VEHICLE_CLASSES,[
    'bicycle','motorcycle','sedan','mpv_suv','pickup','l300_van'
  ]);
  assert.equal(canonicalDeliveryVehicleClass('motorbike'),'motorcycle');
  assert.equal(canonicalDeliveryVehicleClass('scooter'),'motorcycle');
  assert.equal(canonicalDeliveryVehicleClass('car'),'sedan');
  assert.equal(canonicalDeliveryVehicleClass('van'),'l300_van');
  assert.equal(canonicalDeliveryVehicleClass('L300'),'l300_van');
});

test('Motorcycle tiered pricing is deterministic at Bacoor pilot fixture thresholds',()=>{
  const r=normalizeVehiclePricingRule(motorcycle);
  assert.equal(r.expressway_eligible,false);
  assert.equal(r.toll_policy,'disabled');
  assert.equal(r.stacking_policy,'direct_only');
  assert.equal(calculateDeliveryPrice(r,{distanceKm:3}).service_fare,27);
  assert.equal(calculateDeliveryPrice(r,{distanceKm:5}).service_fare,46);
  assert.equal(calculateDeliveryPrice(r,{distanceKm:10}).service_fare,74.75);
  assert.equal(calculateDeliveryPrice(r,{distanceKm:15}).service_fare,103.5);
  assert.equal(calculateDeliveryPrice(r,{distanceKm:20}).service_fare,128.5);
  assert.equal(calculateDeliveryPrice(r,{distanceKm:40}).service_fare,228.5);
});

test('tiered pricing keeps kg and litre as capacity gates instead of hidden price multipliers',()=>{
  const a=calculateDeliveryPrice(motorcycle,{distanceKm:10,weightKg:1,volumeL:2});
  const b=calculateDeliveryPrice(motorcycle,{distanceKm:10,weightKg:19,volumeL:70});
  assert.equal(a.service_fare,b.service_fare);
  assert.equal(a.weight_component,0);
  assert.equal(a.volume_component,0);
  assert.equal(deliveryVehicleRuleEligible(motorcycle,{distanceKm:10,weightKg:20,volumeL:80}),true);
  assert.equal(deliveryVehicleRuleEligible(motorcycle,{distanceKm:10,weightKg:20.01,volumeL:80}),false);
  assert.equal(deliveryVehicleRuleEligible(motorcycle,{distanceKm:40.01,weightKg:1,volumeL:1}),false);
});

test('quote selects the smallest eligible canonical class and honors legacy minimum-class aliases',()=>{
  const rules=[motorcycle,sedan,van];
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:5,weightKg:2,volumeL:10}).vehicle_class,'motorcycle');
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:5,weightKg:50,volumeL:100}).vehicle_class,'sedan');
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:20,weightKg:500,volumeL:1000}).vehicle_class,'l300_van');
  assert.equal(selectDeliveryVehicleQuote(rules,{distanceKm:5,weightKg:2,volumeL:10,minimumVehicleClass:'car'}).vehicle_class,'sedan');
});

test('explicit extras are itemized and toll parking remain pass-through rather than fee basis',()=>{
  const q=calculateDeliveryQuoteTotal(sedan,{distanceKm:10,weightKg:10,volumeL:50},{
    extra_stops:1,waiting_minutes:45,toll_amount:88,parking_amount:20,demand_adjustment_pct:10
  });
  assert.equal(q.service_fare,205);
  assert.equal(q.extra_stop_amount,40);
  assert.equal(q.waiting_amount,22.5);
  assert.equal(q.demand_adjustment_amount,26.75);
  assert.equal(q.pass_through_amount,108);
  assert.equal(q.platform_fee_basis_amount,294.25);
  assert.equal(q.customer_delivery_total,402.25);
  const split=deliveryPriceSplit(q.customer_delivery_total,{postPromo:true,excludedPassThrough:q.pass_through_amount});
  assert.equal(split.platform_fee_basis_amount,294.25);
  assert.equal(split.business_life_delivery_fee,29.43);
  assert.equal(split.courier_gross_entitlement,264.82);
  assert.equal(split.excluded_pass_through,108);
});

test('Motorcycle no-expressway policy rejects toll charges and hidden surge beyond cap',()=>{
  assert.throws(
    ()=>calculateDeliveryQuoteTotal(motorcycle,{distanceKm:10},{toll_amount:39}),
    e=>e?.code==='DELIVERY_TOLL_NOT_ALLOWED'
  );
  assert.throws(
    ()=>calculateDeliveryQuoteTotal(motorcycle,{distanceKm:10},{demand_adjustment_pct:26}),
    e=>e?.code==='DELIVERY_DEMAND_CAP_EXCEEDED'
  );
});

test('Owner Delivery economics remains 0% promo and 10% post-promo on service fare basis',()=>{
  assert.equal(DELIVERY_PLATFORM_RATE_PCT,10);
  assert.equal(DELIVERY_FEE_BASIS,'verified_delivery_price');
  const promo=deliveryPriceSplit(100,{postPromo:false});
  assert.equal(promo.business_life_delivery_fee,0);
  assert.equal(promo.courier_gross_entitlement,100);
  const post=deliveryPriceSplit(100,{postPromo:true});
  assert.equal(post.business_life_delivery_fee,10);
  assert.equal(post.courier_gross_entitlement,90);
  assert.equal(post.platform_rate_pct,10);
});

test('legacy V2 rules still normalize safely while quote class becomes canonical',()=>{
  const legacyBicycle={vehicle_class:'bicycle',formula_type:'base_plus_km',base_fee:30,per_km:10,minimum_fee:30,maximum_distance_km:20,max_weight_kg:5,max_volume_l:20};
  const legacyCar={vehicle_class:'car',formula_type:'distance_weight_volume',base_fee:50,per_km:12,per_kg:2,per_liter:0.5,minimum_fee:50,maximum_distance_km:50,max_weight_kg:100,max_volume_l:400};
  const legacyVan={vehicle_class:'van',formula_type:'distance_weight_volume',base_fee:80,per_km:15,per_kg:1.5,per_liter:0.4,minimum_fee:80,maximum_distance_km:100,max_weight_kg:1000,max_volume_l:3000};
  assert.equal(normalizeVehiclePricingRule(legacyCar).vehicle_class,'sedan');
  assert.equal(normalizeVehiclePricingRule(legacyVan).vehicle_class,'l300_van');
  assert.equal(selectDeliveryVehicleQuote([legacyBicycle,legacyCar,legacyVan],{distanceKm:3,weightKg:10,volumeL:30}).vehicle_class,'sedan');
});

test('Courier assignment compares canonical aliases while preserving capacity and radius gates',()=>{
  const delivery={required_vehicle_class:'sedan',estimated_weight_kg:20,estimated_volume_l:100,route_distance_km:12};
  assert.deepEqual(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:150,service_radius_km:15},delivery),{allowed:true,reason:'READY'});
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'motorbike',max_weight_kg:30,max_volume_l:150,service_radius_km:15},delivery).reason,'VEHICLE_CLASS_MISMATCH');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:10,max_volume_l:150,service_radius_km:15},delivery).reason,'COURIER_WEIGHT_CAPACITY_EXCEEDED');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:50,service_radius_km:15},delivery).reason,'COURIER_VOLUME_CAPACITY_EXCEEDED');
  assert.equal(courierCanServeDelivery({approved_vehicle_class:'car',max_weight_kg:30,max_volume_l:150,service_radius_km:10},delivery).reason,'COURIER_SERVICE_RADIUS_EXCEEDED');
});

test('runtime schema persists V2B bands extras route policy and immutable quote breakdown',()=>{
  for(const marker of [
    "distance_bands JSONB NOT NULL DEFAULT '[]'::jsonb",
    'included_distance_km NUMERIC',
    'extra_stop_fee NUMERIC',
    'free_wait_minutes INTEGER',
    'waiting_fee_per_minute NUMERIC',
    'demand_adjustment_cap_pct NUMERIC',
    "route_source TEXT NOT NULL DEFAULT 'straight_line_estimate'",
    "price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb",
    'platform_fee_basis_amount NUMERIC',
    'pass_through_amount NUMERIC'
  ])assert.ok(server.includes(marker),marker);
  assert.match(server,/pricing_snapshot/);
  assert.match(server,/distance_band_components/);
  assert.match(server,/routeSource='straight_line_estimate'/);
});

test('Admin V2B preview is simulation-only and does not activate or create Customer quotes',()=>{
  assert.match(server,/app\.post\('\/api\/admin\/delivery\/pricing\/preview'/);
  assert.match(server,/mode:'simulation_only'/);
  assert.match(server,/activation_changed:false,quote_created:false/);
  assert.match(server,/No pricing rule or Customer quote was created or activated/);
  assert.match(adminGateway,/app\.post\('\/api\/admin\/delivery\/pricing\/preview'/);
});

test('Admin V2B pricing stores canonical rules without requiring obsolete Bicycle Car Van trio',()=>{
  assert.match(server,/V2 pricing requires at least one vehicle rule/);
  assert.match(server,/Each canonical V2 vehicle class may appear only once/);
  assert.match(server,/normalizeVehiclePricingRule/);
  assert.match(server,/distance_bands/);
  assert.doesNotMatch(server,/V2 pricing requires bicycle, car and van rules/);
  assert.doesNotMatch(ui,/\/api\/admin\/delivery\/pricing/);
});

test('Customer quote exposes service fare pass-through and route-source evidence',()=>{
  const start=server.indexOf("app.post('/api/delivery/quote'");
  const end=server.indexOf("app.post('/api/marketplace/checkout'",start);
  const block=server.slice(start,end);
  assert.match(block,/calculateDeliveryQuoteTotal/);
  assert.match(block,/service_fare/);
  assert.match(block,/pass_through/);
  assert.match(block,/platform_fee_basis/);
  assert.match(block,/routeSource='straight_line_estimate'/);
  assert.match(block,/fallback_estimate:true/);
});

test('checkout copies exact quote economics and completion monetizes only service fee basis',()=>{
  assert.match(server,/INSERT INTO deliveries\(order_id,quote_id[\s\S]*service_fare,platform_fee_basis_amount,pass_through_amount,price_breakdown,route_source,route_profile/);
  assert.match(server,/deliveryFeeBasis=Number\(x\.platform_fee_basis_amount\|\|x\.service_fare\|\|x\.delivery_fee\|\|0\)/);
  assert.match(server,/serviceScope:'delivery'[\s\S]*grossValue:deliveryFeeBasis/);
});

test('Delivery checkout still rejects disabled storefronts and invalid quote ids before bigint queries',()=>{
  const start=server.indexOf("app.post('/api/marketplace/checkout'");
  const end=server.indexOf("app.put('/api/delivery/store-location'",start);
  const checkout=server.slice(start,end);
  assert.match(checkout,/Number\.isInteger\(businessId\)/);
  assert.match(checkout,/SELECT delivery_enabled FROM merchant_storefronts/);
  assert.match(checkout,/Delivery is not enabled for this Merchant/);
  assert.match(checkout,/Number\.isInteger\(quoteId\)/);
  assert.match(checkout,/Delivery quote is missing or expired/);
});

test('Delivery Pricing V2B runtime wave proves preview math and zero persistence',()=>{
  assert.match(qa,/DELIVERY_PRICING_V2B_RUNTIME_WAVE='delivery_pricing_v2b_runtime'/);
  assert.match(qa,/runDeliveryPricingV2BRuntimeAcceptance/);
  assert.match(qa,/simulation_only:true/);
  assert.match(qa,/active_rule_unchanged:true/);
  assert.match(qa,/pricing_rule_count_unchanged:true/);
  assert.match(qa,/quote_count_unchanged:true/);
  assert.match(qa,/motorcycle_no_expressway:true/);
  assert.match(qa,/post_promo_platform_rate_pct:10/);
});

test('project syntax contract checks Delivery Pricing V2 core and tests',()=>{
  assert.match(pkg,/node --check delivery-pricing-v2-core\.js/);
  assert.match(pkg,/node --check tests\/delivery-pricing-v2\.test\.js/);
});
