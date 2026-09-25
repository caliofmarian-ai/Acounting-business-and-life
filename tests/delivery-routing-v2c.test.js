import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  deliveryRoutingConfig,
  buildGoogleRoutesRequest,
  fallbackDeliveryRouteEstimate,
  requestGoogleDeliveryRoute,
  resolveDeliveryRoute
} from '../delivery-routing-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-delivery.js');
const qa=read('qa-acceptance.js');
const pkg=read('package.json');

const coords={
  pickupLat:14.4594,pickupLng:120.953,
  dropoffLat:14.4064,dropoffLng:120.941
};

test('routing config is fail-safe fallback until provider and secret are explicitly configured',()=>{
  assert.deepEqual(deliveryRoutingConfig({}),{
    provider:'fallback',
    google_routes_ready:false,
    google_routes_api_key:'',
    timeout_ms:4500
  });
  const configured=deliveryRoutingConfig({
    DELIVERY_ROUTING_PROVIDER:'google_routes',
    GOOGLE_ROUTES_API_KEY:'server_secret_google_routes_123456',
    DELIVERY_ROUTING_TIMEOUT_MS:'2500'
  });
  assert.equal(configured.provider,'google_routes');
  assert.equal(configured.google_routes_ready,true);
  assert.equal(configured.timeout_ms,2500);
});

test('Philippines Motorcycle request uses TWO_WHEELER and avoids highways plus tolls',()=>{
  const req=buildGoogleRoutesRequest({
    ...coords,routeProfile:'motorcycle_no_expressway',routeChoice:'fastest_with_tolls',includeTolls:true
  });
  assert.equal(req.travel_mode,'TWO_WHEELER');
  assert.deepEqual(req.body.routeModifiers,{avoidTolls:true,avoidHighways:true,avoidFerries:true});
  assert.equal(req.body.regionCode,'PH');
  assert.equal(req.toll_computation_requested,false);
  assert.ok(!('extraComputations' in req.body));
  assert.doesNotMatch(req.field_mask,/tollInfo/);
});

test('Sedan fastest-with-tolls requests toll advisory while avoid-tolls does not',()=>{
  const tolled=buildGoogleRoutesRequest({
    ...coords,routeProfile:'car_optional_tolls',routeChoice:'fastest_with_tolls',includeTolls:true
  });
  assert.equal(tolled.travel_mode,'DRIVE');
  assert.equal(tolled.body.routeModifiers.avoidTolls,false);
  assert.deepEqual(tolled.body.extraComputations,['TOLLS']);
  assert.match(tolled.field_mask,/routes\.travelAdvisory\.tollInfo/);

  const avoid=buildGoogleRoutesRequest({
    ...coords,routeProfile:'car_optional_tolls',routeChoice:'avoid_tolls',includeTolls:true
  });
  assert.equal(avoid.body.routeModifiers.avoidTolls,true);
  assert.equal(avoid.toll_computation_requested,false);
  assert.ok(!('extraComputations' in avoid.body));
});

test('fallback remains explicitly labelled and never invents ETA or road distance authority',()=>{
  const route=fallbackDeliveryRouteEstimate({
    ...coords,routeFactor:1.15,routeProfile:'motorcycle_no_expressway',routeChoice:'avoid_tolls'
  });
  assert.equal(route.provider,'fallback');
  assert.equal(route.source,'straight_line_estimate');
  assert.equal(route.fallback_estimate,true);
  assert.equal(route.eta_minutes,null);
  assert.equal(route.toll_status,'not_applicable');
  assert.ok(route.distance_km>0);
});

test('Google adapter sends secret only in server header and returns minimal route evidence',async()=>{
  let captured=null;
  const fakeFetch=async(url,options)=>{
    captured={url,options};
    return{
      ok:true,
      async json(){return{routes:[{
        distanceMeters:12345,
        duration:'1880s',
        travelAdvisory:{routeRestrictionsPartiallyIgnored:false}
      }]}}
    };
  };
  const out=await requestGoogleDeliveryRoute({
    ...coords,
    routeProfile:'motorcycle_no_expressway',
    routeChoice:'avoid_tolls',
    apiKey:'server_secret_google_routes_123456',
    fetchImpl:fakeFetch,
    timeoutMs:2000
  });
  assert.equal(captured.url,'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(captured.options.headers['X-Goog-Api-Key'],'server_secret_google_routes_123456');
  assert.match(captured.options.headers['X-Goog-FieldMask'],/routes\.distanceMeters/);
  assert.doesNotMatch(JSON.stringify(captured.options.body),/server_secret_google_routes_123456/);
  assert.equal(out.provider,'google_routes');
  assert.equal(out.distance_km,12.345);
  assert.equal(out.eta_minutes,32);
  assert.equal(out.fallback_estimate,false);
  assert.equal(out.mode_warning_required,true);
  assert.equal(out.mode_warning_code,'GOOGLE_TWO_WHEELER_BETA');
  assert.doesNotMatch(JSON.stringify(out),/server_secret_google_routes_123456/);
});

test('Google car route preserves verified PHP toll estimate as separate route evidence',async()=>{
  const fakeFetch=async()=>({
    ok:true,
    async json(){return{routes:[{
      distanceMeters:10000,
      duration:'1200s',
      travelAdvisory:{
        routeRestrictionsPartiallyIgnored:false,
        tollInfo:{estimatedPrice:[{currencyCode:'PHP',units:'88',nanos:0}]}
      }
    }]}}
  });
  const out=await requestGoogleDeliveryRoute({
    ...coords,
    routeProfile:'car_optional_tolls',
    routeChoice:'fastest_with_tolls',
    includeTolls:true,
    apiKey:'server_secret_google_routes_123456',
    fetchImpl:fakeFetch
  });
  assert.equal(out.toll_status,'estimated');
  assert.equal(out.toll_amount,88);
  assert.equal(out.toll_currency_code,'PHP');
  assert.equal(out.toll_computation_requested,true);
});

test('light-commercial fallback drive mode does not auto-infer passenger-car toll pricing',()=>{
  const request=buildGoogleRoutesRequest({
    ...coords,
    routeProfile:'light_commercial_optional_tolls',
    routeChoice:'fastest_with_tolls',
    includeTolls:true
  });
  assert.equal(request.travel_mode,'DRIVE');
  assert.equal(request.toll_computation_requested,false);
  assert.ok(!('extraComputations' in request.body));
  assert.doesNotMatch(request.field_mask,/tollInfo/);
});

test('toll presence without an estimated PHP price remains unknown rather than zero',async()=>{
  const fakeFetch=async()=>({
    ok:true,
    async json(){return{routes:[{
      distanceMeters:10000,
      duration:'1200s',
      travelAdvisory:{tollInfo:{estimatedPrice:[]}}
    }]}}
  });
  const out=await requestGoogleDeliveryRoute({
    ...coords,
    routeProfile:'car_optional_tolls',
    routeChoice:'fastest_with_tolls',
    includeTolls:true,
    apiKey:'server_secret_google_routes_123456',
    fetchImpl:fakeFetch
  });
  assert.equal(out.toll_status,'unknown');
  assert.equal(out.toll_amount,null);
});

test('Motorcycle provider restriction warning falls back instead of silently accepting unsafe route',async()=>{
  const fakeFetch=async()=>({
    ok:true,
    async json(){return{routes:[{
      distanceMeters:9000,
      duration:'900s',
      travelAdvisory:{routeRestrictionsPartiallyIgnored:true}
    }]}}
  });
  const out=await resolveDeliveryRoute({
    ...coords,
    routeFactor:1.15,
    routeProfile:'motorcycle_no_expressway',
    routeChoice:'avoid_tolls',
    env:{
      DELIVERY_ROUTING_PROVIDER:'google_routes',
      GOOGLE_ROUTES_API_KEY:'server_secret_google_routes_123456'
    },
    fetchImpl:fakeFetch
  });
  assert.equal(out.source,'straight_line_estimate');
  assert.equal(out.provider_error_code,'ROUTING_MOTORCYCLE_RESTRICTION_WARNING');
  assert.equal(out.fallback_estimate,true);
});

test('missing provider key and provider failures degrade to labelled fallback without leaking upstream body',async()=>{
  const noKey=await resolveDeliveryRoute({
    ...coords,routeFactor:1.15,routeProfile:'car_optional_tolls',
    env:{DELIVERY_ROUTING_PROVIDER:'google_routes'}
  });
  assert.equal(noKey.provider_error_code,'provider_not_ready');

  const failed=await resolveDeliveryRoute({
    ...coords,routeFactor:1.15,routeProfile:'car_optional_tolls',
    env:{
      DELIVERY_ROUTING_PROVIDER:'google_routes',
      GOOGLE_ROUTES_API_KEY:'server_secret_google_routes_123456'
    },
    fetchImpl:async()=>({ok:false,status:500,async json(){return{secret_upstream:'do-not-leak'}}})
  });
  assert.equal(failed.provider_error_code,'ROUTING_PROVIDER_REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(failed),/secret_upstream|do-not-leak/);
});


test('Delivery quote integration uses bounded provider routing and persists route evidence',()=>{
  const start=server.indexOf("app.post('/api/delivery/quote'");
  const end=server.indexOf("app.post('/api/marketplace/checkout'",start);
  const block=server.slice(start,end);
  assert.match(block,/deliveryRoutingConfig\(\)/);
  assert.match(block,/resolveDeliveryRoute\(/);
  assert.match(block,/providerRouteCalls\+=1/);
  assert.match(block,/providerRouteCalls>2/);
  assert.match(block,/route_eta_minutes:route\.eta_minutes/);
  assert.match(block,/route_provider_error_code:route\.provider_error_code\|\|null/);
  assert.match(block,/route_distance_km:Number\(route\.distance_km\)/);
  assert.match(block,/routeSource=route\.source\|\|'straight_line_estimate'/);
  assert.match(server,/routing_provider_ready:routing\.google_routes_ready/);
  assert.doesNotMatch(server,/GOOGLE_ROUTES_API_KEY[^\n]*res\.json/);
});

test('Delivery Routing V2C runtime wave proves no paid call and no invented ETA without a key',()=>{
  assert.match(qa,/DELIVERY_ROUTING_V2C_RUNTIME_WAVE='delivery_routing_v2c_runtime'/);
  assert.match(qa,/runDeliveryRoutingV2CRuntimeAcceptance/);
  assert.match(qa,/provider_route_calls:0/);
  assert.match(qa,/fallback_eta_invented:false/);
  assert.match(qa,/credential_exposed:false/);
  assert.match(qa,/motorcycle_google_mode_contract:'TWO_WHEELER'/);
});

test('package syntax contract includes Delivery Routing V2C core and tests',()=>{
  assert.match(pkg,/node --check delivery-routing-core\.js/);
  assert.match(pkg,/node --check tests\/delivery-routing-v2c\.test\.js/);
});
