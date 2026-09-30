export const DELIVERY_ROUTE_TRACKING_STATES=Object.freeze([
  'courier_en_route_to_merchant',
  'courier_arrived_at_merchant',
  'picked_up',
  'in_transit',
  'courier_arrived_at_customer'
]);

export const DELIVERY_ROUTE_POINT_LIMIT=1000;
export const DELIVERY_ROUTE_DEDUP_SECONDS=12;
export const DELIVERY_ROUTE_DEDUP_METERS=8;

const ACTIVE=new Set(DELIVERY_ROUTE_TRACKING_STATES);
const finite=value=>Number.isFinite(Number(value));

export function deliveryRouteTrackingActive(status=''){
  return ACTIVE.has(String(status||''));
}

export function normalizeDeliveryRoutePoint(input={}){
  const latitude=Number(input.lat??input.latitude);
  const longitude=Number(input.lng??input.longitude);
  if(!finite(latitude)||latitude<-90||latitude>90||!finite(longitude)||longitude<-180||longitude>180){
    throw Object.assign(new Error('Valid coordinates required'),{status:400,code:'DELIVERY_ROUTE_COORDINATES_INVALID'});
  }
  const accuracyRaw=input.accuracy_m==null?null:Number(input.accuracy_m);
  const headingRaw=input.heading_deg==null?null:Number(input.heading_deg);
  const speedRaw=input.speed_mps==null?null:Number(input.speed_mps);
  const accuracyM=accuracyRaw==null?null:Math.min(5000,Math.max(0,accuracyRaw));
  const headingDeg=headingRaw==null||!finite(headingRaw)?null:((headingRaw%360)+360)%360;
  const speedMps=speedRaw==null||!finite(speedRaw)?null:Math.min(100,Math.max(0,speedRaw));
  return Object.freeze({latitude,longitude,accuracy_m:accuracyM,heading_deg:headingDeg,speed_mps:speedMps});
}

function distanceMeters(a,b){
  if(!a||!b)return Infinity;
  const lat1=Number(a.latitude),lon1=Number(a.longitude),lat2=Number(b.latitude),lon2=Number(b.longitude);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return Infinity;
  const R=6371000;
  const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180;
  const dp=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

export function deliveryRoutePointDecision({
  previous=null,
  next,
  pointCount=0,
  nowMs=Date.now(),
  pointLimit=DELIVERY_ROUTE_POINT_LIMIT
}={}){
  const normalized=normalizeDeliveryRoutePoint(next||{});
  if(Number(pointCount)>=Number(pointLimit)){
    return Object.freeze({append:false,reason:'route_point_limit',point:normalized});
  }
  if(previous){
    const recordedMs=new Date(previous.recorded_at||0).getTime();
    const ageSeconds=Number.isFinite(recordedMs)?Math.max(0,(Number(nowMs)-recordedMs)/1000):Infinity;
    const movedMeters=distanceMeters(previous,normalized);
    if(ageSeconds<DELIVERY_ROUTE_DEDUP_SECONDS&&movedMeters<DELIVERY_ROUTE_DEDUP_METERS){
      return Object.freeze({append:false,reason:'deduplicated',point:normalized,moved_meters:movedMeters,age_seconds:ageSeconds});
    }
  }
  return Object.freeze({append:true,reason:'append',point:normalized});
}

export function deliveryProofAllowed(proofType,status){
  const type=String(proofType||'');
  const state=String(status||'');
  if(type==='pickup')return ['courier_arrived_at_merchant','picked_up'].includes(state);
  if(type==='delivery')return state==='courier_arrived_at_customer';
  return false;
}
