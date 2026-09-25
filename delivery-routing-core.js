export const DELIVERY_ROUTING_PROVIDERS=Object.freeze(['fallback','google_routes']);
export const DELIVERY_ROUTE_CHOICES=Object.freeze(['avoid_tolls','fastest_with_tolls']);

const clean=(v,max=160)=>String(v??'').trim().slice(0,max);
const finiteNumber=(v,label)=>{
  const n=Number(v);
  if(!Number.isFinite(n))throw Object.assign(new Error(label+' must be numeric'),{status:400});
  return n;
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)));

function coord(value,min,max,label){
  const n=finiteNumber(value,label);
  if(n<min||n>max)throw Object.assign(new Error(label+' is outside its valid range'),{status:400});
  return n;
}
function haversine(lat1,lon1,lat2,lon2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function money(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
function routeChoice(value){
  const x=clean(value,40)||'avoid_tolls';
  if(!DELIVERY_ROUTE_CHOICES.includes(x))throw Object.assign(new Error('Unsupported delivery route choice'),{status:400});
  return x;
}
function normalizeRouteProfile(value){
  const x=clean(value,80);
  if(!x)throw Object.assign(new Error('Delivery route profile is required'),{status:400});
  return x;
}
function googleTravelMode(profile){
  if(profile==='bicycle_local')return'BICYCLE';
  if(profile==='motorcycle_no_expressway')return'TWO_WHEELER';
  return'DRIVE';
}
function googleRouteModifiers(profile,choice){
  if(profile==='motorcycle_no_expressway'){
    return{avoidTolls:true,avoidHighways:true,avoidFerries:true};
  }
  if(profile==='bicycle_local')return{};
  return{avoidTolls:choice==='avoid_tolls',avoidHighways:false,avoidFerries:true};
}
function parseGoogleDuration(value){
  const x=clean(value,40);
  const match=x.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if(!match)return null;
  const seconds=Number(match[1]);
  return Number.isFinite(seconds)?seconds:null;
}
function tollMoney(tollInfo){
  if(!tollInfo||typeof tollInfo!=='object')return{status:'none',amount:0,currency_code:'PHP'};
  const prices=Array.isArray(tollInfo.estimatedPrice)?tollInfo.estimatedPrice:[];
  const php=prices.filter(x=>x?.currencyCode==='PHP');
  if(!php.length)return{status:'unknown',amount:null,currency_code:'PHP'};
  const amount=php.reduce((sum,x)=>sum+Number(x.units||0)+Number(x.nanos||0)/1_000_000_000,0);
  if(!Number.isFinite(amount))return{status:'unknown',amount:null,currency_code:'PHP'};
  return{status:'estimated',amount:money(amount),currency_code:'PHP'};
}

export function deliveryRoutingConfig(env=process.env){
  const raw=clean(env.DELIVERY_ROUTING_PROVIDER,60)||'fallback';
  const provider=DELIVERY_ROUTING_PROVIDERS.includes(raw)?raw:'fallback';
  const googleKey=String(env.GOOGLE_ROUTES_API_KEY||'').trim();
  const timeoutRaw=Number(env.DELIVERY_ROUTING_TIMEOUT_MS||4500);
  const timeoutMs=Number.isFinite(timeoutRaw)?clamp(timeoutRaw,1000,10000):4500;
  return{
    provider,
    google_routes_ready:provider==='google_routes'&&googleKey.length>=20,
    google_routes_api_key:googleKey,
    timeout_ms:timeoutMs
  };
}

export function fallbackDeliveryRouteEstimate({
  pickupLat,pickupLng,dropoffLat,dropoffLng,routeFactor=1,routeProfile:routeProfileValue,routeChoice:choice='avoid_tolls',
  reason='provider_not_configured'
}={}){
  const pLat=coord(pickupLat,-90,90,'pickup latitude');
  const pLng=coord(pickupLng,-180,180,'pickup longitude');
  const dLat=coord(dropoffLat,-90,90,'dropoff latitude');
  const dLng=coord(dropoffLng,-180,180,'dropoff longitude');
  const factor=Math.max(1,finiteNumber(routeFactor,'route factor'));
  const profile=normalizeRouteProfile(routeProfileValue);
  const selectedChoice=routeChoice(choice);
  const distance=haversine(pLat,pLng,dLat,dLng)*factor;
  return{
    provider:'fallback',
    source:'straight_line_estimate',
    route_profile:profile,
    route_choice:selectedChoice,
    distance_km:Math.round(distance*10000)/10000,
    duration_seconds:null,
    eta_minutes:null,
    fallback_estimate:true,
    provider_ready:false,
    provider_error_code:clean(reason,80)||'fallback',
    route_restrictions_partially_ignored:false,
    toll_status:profile==='motorcycle_no_expressway'||profile==='bicycle_local'?'not_applicable':'unknown',
    toll_amount:null,
    toll_currency_code:'PHP'
  };
}

export function buildGoogleRoutesRequest({
  pickupLat,pickupLng,dropoffLat,dropoffLng,routeProfile:profileValue,
  routeChoice:choiceValue='avoid_tolls',includeTolls=false
}={}){
  const profile=normalizeRouteProfile(profileValue);
  const requestedChoice=routeChoice(choiceValue);
  const choice=['motorcycle_no_expressway','bicycle_local'].includes(profile)?'avoid_tolls':requestedChoice;
  const travelMode=googleTravelMode(profile);
  const routeModifiers=googleRouteModifiers(profile,choice);
  const body={
    origin:{location:{latLng:{latitude:coord(pickupLat,-90,90,'pickup latitude'),longitude:coord(pickupLng,-180,180,'pickup longitude')}}},
    destination:{location:{latLng:{latitude:coord(dropoffLat,-90,90,'dropoff latitude'),longitude:coord(dropoffLng,-180,180,'dropoff longitude')}}},
    travelMode,
    routeModifiers,
    regionCode:'PH',
    units:'METRIC'
  };
  const tolls=Boolean(includeTolls&&profile==='car_optional_tolls'&&travelMode==='DRIVE'&&choice==='fastest_with_tolls');
  if(tolls)body.extraComputations=['TOLLS'];
  const fields=[
    'routes.distanceMeters',
    'routes.duration',
    'routes.travelAdvisory.routeRestrictionsPartiallyIgnored'
  ];
  if(tolls)fields.push('routes.travelAdvisory.tollInfo');
  return{
    body,
    field_mask:fields.join(','),
    travel_mode:travelMode,
    route_profile:profile,
    route_choice:choice,
    toll_computation_requested:tolls
  };
}

export async function requestGoogleDeliveryRoute({
  apiKey,timeoutMs=4500,fetchImpl=globalThis.fetch,...input
}={}){
  const key=String(apiKey||'').trim();
  if(key.length<20)throw Object.assign(new Error('Google Routes credential is not configured'),{code:'ROUTING_PROVIDER_NOT_READY'});
  if(typeof fetchImpl!=='function')throw Object.assign(new Error('Routing network client is unavailable'),{code:'ROUTING_NETWORK_UNAVAILABLE'});
  const request=buildGoogleRoutesRequest(input);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),clamp(timeoutMs,1000,10000));
  try{
    const response=await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Goog-Api-Key':key,
        'X-Goog-FieldMask':request.field_mask
      },
      body:JSON.stringify(request.body),
      signal:controller.signal
    });
    if(!response?.ok)throw Object.assign(new Error('Routing provider request failed'),{code:'ROUTING_PROVIDER_REQUEST_FAILED'});
    const json=await response.json().catch(()=>({}));
    const route=Array.isArray(json?.routes)?json.routes[0]:null;
    const distanceMeters=Number(route?.distanceMeters);
    const durationSeconds=parseGoogleDuration(route?.duration);
    if(!route||!Number.isFinite(distanceMeters)||distanceMeters<=0){
      throw Object.assign(new Error('Routing provider returned no usable route'),{code:'ROUTING_PROVIDER_NO_ROUTE'});
    }
    const restrictionsIgnored=Boolean(route?.travelAdvisory?.routeRestrictionsPartiallyIgnored);
    if(request.route_profile==='motorcycle_no_expressway'&&restrictionsIgnored){
      throw Object.assign(new Error('Routing provider could not fully honor Motorcycle restrictions'),{code:'ROUTING_MOTORCYCLE_RESTRICTION_WARNING'});
    }
    const toll=request.toll_computation_requested?tollMoney(route?.travelAdvisory?.tollInfo):{
      status:request.route_profile==='motorcycle_no_expressway'||request.route_profile==='bicycle_local'?'not_applicable':'not_requested',
      amount:null,currency_code:'PHP'
    };
    return{
      provider:'google_routes',
      source:'google_routes',
      route_profile:request.route_profile,
      route_choice:request.route_choice,
      travel_mode:request.travel_mode,
      distance_km:Math.round(distanceMeters)/1000,
      duration_seconds:durationSeconds,
      eta_minutes:durationSeconds==null?null:Math.max(1,Math.ceil(durationSeconds/60)),
      fallback_estimate:false,
      provider_ready:true,
      provider_error_code:null,
      route_restrictions_partially_ignored:restrictionsIgnored,
      toll_status:toll.status,
      toll_amount:toll.amount,
      toll_currency_code:toll.currency_code,
      toll_computation_requested:request.toll_computation_requested,
      mode_warning_required:['BICYCLE','TWO_WHEELER'].includes(request.travel_mode),
      mode_warning_code:request.travel_mode==='TWO_WHEELER'?'GOOGLE_TWO_WHEELER_BETA':request.travel_mode==='BICYCLE'?'GOOGLE_BICYCLE_BETA':null
    };
  }catch(error){
    if(error?.name==='AbortError')throw Object.assign(new Error('Routing provider timed out'),{code:'ROUTING_PROVIDER_TIMEOUT'});
    if(error?.code)throw error;
    throw Object.assign(new Error('Routing provider request failed'),{code:'ROUTING_PROVIDER_REQUEST_FAILED'});
  }finally{
    clearTimeout(timeout);
  }
}

export async function resolveDeliveryRoute({
  env=process.env,fetchImpl=globalThis.fetch,routeFactor=1,...input
}={}){
  const config=deliveryRoutingConfig(env);
  const fallback=reason=>fallbackDeliveryRouteEstimate({...input,routeFactor,reason});
  if(config.provider!=='google_routes')return fallback('provider_fallback_selected');
  if(!config.google_routes_ready)return fallback('provider_not_ready');
  try{
    return await requestGoogleDeliveryRoute({
      ...input,
      apiKey:config.google_routes_api_key,
      timeoutMs:config.timeout_ms,
      fetchImpl
    });
  }catch(error){
    return fallback(clean(error?.code||'provider_error',80));
  }
}
