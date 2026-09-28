import {canonicalDeliveryVehicleClass} from './delivery-pricing-v2-core.js';

export const DELIVERY_ROUTING_PROVIDERS=Object.freeze(['fallback','google_routes']);
export const DELIVERY_ROUTE_CHOICES=Object.freeze(['avoid_tolls','fastest_with_tolls']);
export const GOOGLE_ROUTES_ENDPOINT='https://routes.googleapis.com/directions/v2:computeRoutes';

const clean=(value,max=120)=>String(value??'').trim().slice(0,max);
const bounded=(value,fallback,min,max)=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
};
const coordinate=(value,label,min,max)=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw Object.assign(new Error(label+' is invalid'),{status:400});
  return n;
};
const moneyValue=value=>{
  if(!value||typeof value!=='object')return null;
  const units=Number(value.units||0),nanos=Number(value.nanos||0);
  if(!Number.isFinite(units)||!Number.isFinite(nanos))return null;
  return Math.round((units+nanos/1e9)*100)/100;
};
const durationSeconds=value=>{
  const match=String(value||'').match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match?Number(match[1]):null;
};

export function straightLineDistanceKm(origin,destination){
  const lat1=coordinate(origin?.lat,'origin latitude',-90,90);
  const lon1=coordinate(origin?.lng,'origin longitude',-180,180);
  const lat2=coordinate(destination?.lat,'destination latitude',-90,90);
  const lon2=coordinate(destination?.lng,'destination longitude',-180,180);
  const R=6371;
  const dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

export function deliveryRoutingConfig(env=process.env){
  const requested=clean(env.DELIVERY_ROUTING_PROVIDER||'fallback',40).toLowerCase();
  const supported=DELIVERY_ROUTING_PROVIDERS.includes(requested);
  const key=clean(env.GOOGLE_ROUTES_API_KEY||'',500);
  const configured=requested==='google_routes'&&Boolean(key);
  const provider=configured?'google_routes':'fallback';
  let reason='fallback_requested';
  if(!supported)reason='unsupported_provider';
  else if(requested==='google_routes'&&!key)reason='missing_google_routes_key';
  else if(configured)reason='configured';
  return{
    requested_provider:requested||'fallback',
    provider,
    configured,
    reason,
    google_api_key:key,
    timeout_ms:bounded(env.DELIVERY_ROUTING_TIMEOUT_MS,4500,1000,8000)
  };
}

export function deliveryRoutingPublicConfig(env=process.env){
  const cfg=deliveryRoutingConfig(env);
  return{
    requested_provider:cfg.requested_provider,
    provider:cfg.provider,
    configured:cfg.configured,
    reason:cfg.reason,
    timeout_ms:cfg.timeout_ms
  };
}

export function deliveryRoutePolicy({vehicleClass,routeProfile='',routeChoice='avoid_tolls'}={}){
  const cls=canonicalDeliveryVehicleClass(vehicleClass);
  const requestedChoice=clean(routeChoice||'avoid_tolls',40);
  if(!DELIVERY_ROUTE_CHOICES.includes(requestedChoice)){
    throw Object.assign(new Error('Unsupported Delivery route choice'),{status:400,code:'DELIVERY_ROUTE_CHOICE_INVALID'});
  }
  if(cls==='bicycle'){
    return{
      vehicle_class:cls,route_profile:routeProfile||'bicycle_local',route_choice:'avoid_tolls',
      travel_mode:'BICYCLE',avoid_tolls:false,avoid_highways:false,toll_policy:'none',
      provider_warning:'Bicycle route guidance may be incomplete; follow local road rules.'
    };
  }
  if(cls==='motorcycle'){
    return{
      vehicle_class:cls,route_profile:routeProfile||'motorcycle_no_expressway',route_choice:'avoid_tolls',
      travel_mode:'TWO_WHEELER',avoid_tolls:true,avoid_highways:true,toll_policy:'none',
      provider_warning:'Two-wheel route guidance may be incomplete; follow local road rules and expressway restrictions.'
    };
  }
  const commercial=['pickup','l300_van'].includes(cls);
  return{
    vehicle_class:cls,
    route_profile:routeProfile||(commercial?'light_commercial_optional_tolls':'car_optional_tolls'),
    route_choice:requestedChoice,
    travel_mode:'DRIVE',
    avoid_tolls:requestedChoice==='avoid_tolls',
    avoid_highways:false,
    toll_policy:requestedChoice==='fastest_with_tolls'?'estimate_if_available':'unknown',
    provider_warning:''
  };
}

export function buildGoogleRoutesRequest({origin,destination,vehicleClass,routeProfile='',routeChoice='avoid_tolls'}={}){
  const policy=deliveryRoutePolicy({vehicleClass,routeProfile,routeChoice});
  const body={
    origin:{location:{latLng:{
      latitude:coordinate(origin?.lat,'origin latitude',-90,90),
      longitude:coordinate(origin?.lng,'origin longitude',-180,180)
    }}},
    destination:{location:{latLng:{
      latitude:coordinate(destination?.lat,'destination latitude',-90,90),
      longitude:coordinate(destination?.lng,'destination longitude',-180,180)
    }}},
    travelMode:policy.travel_mode,
    computeAlternativeRoutes:false,
    languageCode:'en-US',
    units:'METRIC'
  };
  if(policy.travel_mode==='TWO_WHEELER'){
    body.routeModifiers={avoidTolls:true,avoidHighways:true,avoidFerries:false};
  }else if(policy.travel_mode==='DRIVE'){
    body.routeModifiers={avoidTolls:policy.avoid_tolls,avoidHighways:false,avoidFerries:false};
  }
  const fields=['routes.distanceMeters','routes.duration','routes.routeRestrictionsPartiallyIgnored'];
  if(policy.travel_mode==='DRIVE'&&policy.route_choice==='fastest_with_tolls'){
    body.extraComputations=['TOLLS'];
    fields.push('routes.travelAdvisory.tollInfo');
  }
  return{body,field_mask:fields.join(','),policy};
}

export function parseGoogleRoutesResponse(payload,{policy}={}){
  const route=Array.isArray(payload?.routes)?payload.routes[0]:null;
  if(!route)return{ok:false,code:'GOOGLE_ROUTE_MISSING'};
  if(route.routeRestrictionsPartiallyIgnored===true){
    return{ok:false,code:'ROUTE_RESTRICTIONS_PARTIALLY_IGNORED',restrictions_partially_ignored:true};
  }
  const meters=Number(route.distanceMeters),seconds=durationSeconds(route.duration);
  if(!Number.isFinite(meters)||meters<=0||!Number.isFinite(seconds)||seconds<0){
    return{ok:false,code:'GOOGLE_ROUTE_INVALID'};
  }
  let toll_status='unknown',toll_amount=null,toll_currency='';
  if(policy?.toll_policy==='none'){
    toll_status='none';toll_amount=0;
  }else if(policy?.toll_policy==='estimate_if_available'){
    const prices=route.travelAdvisory?.tollInfo?.estimatedPrice;
    const price=Array.isArray(prices)?prices[0]:null;
    const amount=moneyValue(price);
    if(amount!=null&&clean(price?.currencyCode,3)){
      toll_status='estimated';toll_amount=amount;toll_currency=clean(price.currencyCode,3).toUpperCase();
    }
  }
  return{
    ok:true,
    distance_km:Math.round(meters/1000*10000)/10000,
    eta_minutes:Math.max(1,Math.ceil(seconds/60)),
    restrictions_partially_ignored:false,
    toll_status,toll_amount,toll_currency
  };
}

export function fallbackDeliveryRoute({origin,destination,routeFactor=1,vehicleClass,routeProfile='',routeChoice='avoid_tolls',providerStatus='fallback'}={}){
  const factor=bounded(routeFactor,1,0.1,5);
  const policy=deliveryRoutePolicy({vehicleClass,routeProfile,routeChoice});
  const distance=Math.round(straightLineDistanceKm(origin,destination)*factor*10000)/10000;
  return{
    provider:'fallback',
    provider_attempted:false,
    provider_route_source:'haversine_route_factor',
    source:'straight_line_estimate',
    provider_status:clean(providerStatus,80)||'fallback',
    distance_km:distance,
    eta_minutes:null,
    route_profile:policy.route_profile,
    route_choice:policy.route_choice,
    travel_mode:policy.travel_mode,
    avoid_tolls:policy.avoid_tolls,
    avoid_highways:policy.avoid_highways,
    fallback_used:true,
    restriction_status:'not_verified',
    toll_status:policy.toll_policy==='none'?'none':'unknown',
    toll_amount:policy.toll_policy==='none'?0:null,
    toll_currency:'',
    provider_warning:policy.provider_warning
  };
}

export async function resolveDeliveryRoute({
  origin,destination,routeFactor=1,vehicleClass,routeProfile='',routeChoice='avoid_tolls',
  env=process.env,fetchImpl=globalThis.fetch
}={}){
  const cfg=deliveryRoutingConfig(env);
  const fallback=(status,extra={})=>({
    ...fallbackDeliveryRoute({origin,destination,routeFactor,vehicleClass,routeProfile,routeChoice,providerStatus:status}),
    ...extra
  });
  if(cfg.provider!=='google_routes'){
    return fallback(cfg.reason);
  }
  if(typeof fetchImpl!=='function')return fallback('provider_fetch_unavailable');
  const request=buildGoogleRoutesRequest({origin,destination,vehicleClass,routeProfile,routeChoice});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),cfg.timeout_ms);
  try{
    const response=await fetchImpl(GOOGLE_ROUTES_ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Goog-Api-Key':cfg.google_api_key,
        'X-Goog-FieldMask':request.field_mask
      },
      body:JSON.stringify(request.body),
      signal:controller.signal
    });
    if(!response?.ok)return fallback('provider_http_'+String(response?.status||'error'),{provider_attempted:true});
    const payload=await response.json().catch(()=>null);
    if(!payload)return fallback('provider_invalid_json',{provider_attempted:true});
    const parsed=parseGoogleRoutesResponse(payload,{policy:request.policy});
    if(!parsed.ok){
      return fallback(parsed.code==='ROUTE_RESTRICTIONS_PARTIALLY_IGNORED'?'restrictions_partially_ignored':'provider_invalid_route',{
        provider_attempted:true,
        restriction_status:parsed.restrictions_partially_ignored?'partially_ignored':'not_verified'
      });
    }
    return{
      provider:'google_routes',
      provider_attempted:true,
      provider_route_source:'compute_routes',
      source:'google_routes',
      provider_status:'success',
      distance_km:parsed.distance_km,
      eta_minutes:parsed.eta_minutes,
      route_profile:request.policy.route_profile,
      route_choice:request.policy.route_choice,
      travel_mode:request.policy.travel_mode,
      avoid_tolls:request.policy.avoid_tolls,
      avoid_highways:request.policy.avoid_highways,
      fallback_used:false,
      restriction_status:'verified',
      toll_status:parsed.toll_status,
      toll_amount:parsed.toll_amount,
      toll_currency:parsed.toll_currency,
      provider_warning:request.policy.provider_warning
    };
  }catch(error){
    return fallback(error?.name==='AbortError'?'provider_timeout':'provider_error',{provider_attempted:true});
  }finally{
    clearTimeout(timer);
  }
}
