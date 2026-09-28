import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryRoutingConfig,deliveryRoutingPublicConfig,deliveryRoutePolicy,
  buildGoogleRoutesRequest,parseGoogleRoutesResponse,fallbackDeliveryRoute,
  resolveDeliveryRoute,GOOGLE_ROUTES_ENDPOINT
} from '../delivery-routing-v2c.js';

const origin={lat:14.458,lng:120.946};
const destination={lat:14.408,lng:120.985};
const TEST_KEY='not-a-real-credential';

test('no routing credential keeps labelled fallback without provider call',async()=>{
  let calls=0;
  const route=await resolveDeliveryRoute({
    origin,destination,routeFactor:1.15,vehicleClass:'motorcycle',
    routeProfile:'motorcycle_no_expressway',
    env:{DELIVERY_ROUTING_PROVIDER:'google_routes'},
    fetchImpl:async()=>{calls++;throw new Error('unexpected provider call');}
  });
  assert.equal(calls,0);
  assert.equal(route.provider,'fallback');
  assert.equal(route.provider_attempted,false);
  assert.equal(route.source,'straight_line_estimate');
  assert.equal(route.fallback_used,true);
  assert.equal(route.provider_status,'missing_google_routes_key');
  assert.equal(route.travel_mode,'TWO_WHEELER');
  assert.equal(route.avoid_highways,true);
  assert.equal(route.avoid_tolls,true);
  assert.equal(route.toll_status,'none');
  assert.equal(route.toll_amount,0);
  assert.equal(route.eta_minutes,null);
});

test('public routing config never returns credential material',()=>{
  const env={DELIVERY_ROUTING_PROVIDER:'google_routes',GOOGLE_ROUTES_API_KEY:TEST_KEY,DELIVERY_ROUTING_TIMEOUT_MS:'3500'};
  const internal=deliveryRoutingConfig(env);
  const publicConfig=deliveryRoutingPublicConfig(env);
  assert.equal(internal.provider,'google_routes');
  assert.equal(publicConfig.provider,'google_routes');
  assert.equal(publicConfig.configured,true);
  assert.equal('google_api_key' in publicConfig,false);
  assert.doesNotMatch(JSON.stringify(publicConfig),/not-a-real-credential/);
});

test('motorcycle request uses TWO_WHEELER with highway and toll avoidance',()=>{
  const req=buildGoogleRoutesRequest({
    origin,destination,vehicleClass:'motorcycle',
    routeProfile:'motorcycle_no_expressway',
    routeChoice:'fastest_with_tolls'
  });
  assert.equal(req.body.travelMode,'TWO_WHEELER');
  assert.deepEqual(req.body.routeModifiers,{avoidTolls:true,avoidHighways:true,avoidFerries:false});
  assert.equal(req.policy.route_choice,'avoid_tolls');
  assert.equal(req.body.extraComputations,undefined);
  assert.match(req.field_mask,/routes\.distanceMeters/);
  assert.match(req.field_mask,/routes\.duration/);
  assert.match(req.field_mask,/routes\.routeRestrictionsPartiallyIgnored/);
  assert.doesNotMatch(req.field_mask,/polyline/i);
});

test('bicycle stays distinct from motorized two-wheeler',()=>{
  const policy=deliveryRoutePolicy({vehicleClass:'bicycle',routeProfile:'bicycle_local'});
  const req=buildGoogleRoutesRequest({origin,destination,vehicleClass:'bicycle',routeProfile:'bicycle_local'});
  assert.equal(policy.travel_mode,'BICYCLE');
  assert.equal(req.body.travelMode,'BICYCLE');
  assert.equal(req.body.routeModifiers,undefined);
});

test('car supports avoid-tolls and toll-allowed route choice',()=>{
  const avoid=buildGoogleRoutesRequest({
    origin,destination,vehicleClass:'sedan',routeProfile:'car_optional_tolls',routeChoice:'avoid_tolls'
  });
  assert.equal(avoid.body.travelMode,'DRIVE');
  assert.equal(avoid.body.routeModifiers.avoidTolls,true);
  assert.equal(avoid.body.extraComputations,undefined);
  const tolls=buildGoogleRoutesRequest({
    origin,destination,vehicleClass:'sedan',routeProfile:'car_optional_tolls',routeChoice:'fastest_with_tolls'
  });
  assert.equal(tolls.body.routeModifiers.avoidTolls,false);
  assert.deepEqual(tolls.body.extraComputations,['TOLLS']);
  assert.match(tolls.field_mask,/routes\.travelAdvisory\.tollInfo/);
});

test('partially ignored restrictions are not verified route evidence',()=>{
  const policy=deliveryRoutePolicy({vehicleClass:'motorcycle'});
  const parsed=parseGoogleRoutesResponse({
    routes:[{distanceMeters:10000,duration:'900s',routeRestrictionsPartiallyIgnored:true}]
  },{policy});
  assert.equal(parsed.ok,false);
  assert.equal(parsed.code,'ROUTE_RESTRICTIONS_PARTIALLY_IGNORED');
  assert.equal(parsed.restrictions_partially_ignored,true);
});

test('Google success returns road distance ETA and toll estimate',async()=>{
  let calls=0,seen;
  const route=await resolveDeliveryRoute({
    origin,destination,vehicleClass:'sedan',routeProfile:'car_optional_tolls',routeChoice:'fastest_with_tolls',
    env:{DELIVERY_ROUTING_PROVIDER:'google_routes',GOOGLE_ROUTES_API_KEY:TEST_KEY},
    fetchImpl:async(url,options)=>{
      calls++;seen={url,options};
      return new Response(JSON.stringify({routes:[{
        distanceMeters:12345,duration:'1020s',routeRestrictionsPartiallyIgnored:false,
        travelAdvisory:{tollInfo:{estimatedPrice:[{currencyCode:'PHP',units:'88'}]}}
      }]}),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  assert.equal(calls,1);
  assert.equal(seen.url,GOOGLE_ROUTES_ENDPOINT);
  assert.equal(route.provider,'google_routes');
  assert.equal(route.provider_attempted,true);
  assert.equal(route.fallback_used,false);
  assert.equal(route.distance_km,12.345);
  assert.equal(route.eta_minutes,17);
  assert.equal(route.toll_status,'estimated');
  assert.equal(route.toll_amount,88);
  assert.equal(route.toll_currency,'PHP');
  assert.equal(route.restriction_status,'verified');
  assert.doesNotMatch(JSON.stringify(route),/not-a-real-credential/);
});

test('provider errors and partial restrictions fail safe without raw upstream details',async()=>{
  const errorRoute=await resolveDeliveryRoute({
    origin,destination,routeFactor:1.2,vehicleClass:'sedan',
    env:{DELIVERY_ROUTING_PROVIDER:'google_routes',GOOGLE_ROUTES_API_KEY:TEST_KEY},
    fetchImpl:async()=>new Response(JSON.stringify({error:{message:'upstream-detail-marker'}}),{status:503})
  });
  assert.equal(errorRoute.provider,'fallback');
  assert.equal(errorRoute.provider_attempted,true);
  assert.equal(errorRoute.provider_status,'provider_http_503');
  assert.doesNotMatch(JSON.stringify(errorRoute),/upstream-detail-marker|not-a-real-credential/);

  const partial=await resolveDeliveryRoute({
    origin,destination,routeFactor:1.2,vehicleClass:'motorcycle',
    env:{DELIVERY_ROUTING_PROVIDER:'google_routes',GOOGLE_ROUTES_API_KEY:TEST_KEY},
    fetchImpl:async()=>new Response(JSON.stringify({routes:[{
      distanceMeters:8000,duration:'600s',routeRestrictionsPartiallyIgnored:true
    }]}),{status:200})
  });
  assert.equal(partial.source,'straight_line_estimate');
  assert.equal(partial.provider_attempted,true);
  assert.equal(partial.provider_status,'restrictions_partially_ignored');
  assert.equal(partial.restriction_status,'partially_ignored');
  assert.equal(partial.toll_status,'none');
});

test('absence of toll price is unknown rather than zero for toll-capable car route',()=>{
  const policy=deliveryRoutePolicy({vehicleClass:'sedan',routeChoice:'fastest_with_tolls'});
  const parsed=parseGoogleRoutesResponse({
    routes:[{distanceMeters:9000,duration:'700s',routeRestrictionsPartiallyIgnored:false}]
  },{policy});
  assert.equal(parsed.ok,true);
  assert.equal(parsed.toll_status,'unknown');
  assert.equal(parsed.toll_amount,null);
});

test('fallback evidence is explicit',()=>{
  const route=fallbackDeliveryRoute({
    origin,destination,routeFactor:1.15,vehicleClass:'l300_van',
    routeProfile:'light_commercial_optional_tolls',routeChoice:'avoid_tolls'
  });
  assert.ok(route.distance_km>0);
  assert.equal(route.provider,'fallback');
  assert.equal(route.provider_route_source,'haversine_route_factor');
  assert.equal(route.toll_status,'unknown');
  assert.equal(route.toll_amount,null);
});
