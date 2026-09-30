import {canonicalDeliveryVehicleClass,courierCanServeDelivery} from './delivery-pricing-v2-core.js';

export const DELIVERY_OFFER_STATUSES=Object.freeze(['pending','accepted','declined','withdrawn','expired']);
export const DELIVERY_ACTIVE_ASSIGNMENT_STATES=Object.freeze([
  'courier_assigned','courier_en_route_to_merchant','courier_arrived_at_merchant',
  'picked_up','in_transit','courier_arrived_at_customer'
]);

const activeStates=new Set(DELIVERY_ACTIVE_ASSIGNMENT_STATES);
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

export function deliveryOfferCanRespond(status=''){
  return String(status||'')==='pending';
}

export function deliveryOfferSafeView(row={}){
  return Object.freeze({
    id:Number(row.id),
    delivery_id:Number(row.delivery_id),
    offer_round:Number(row.offer_round||0),
    status:clean(row.status,30),
    order_number:clean(row.order_number,80),
    business_name:clean(row.business_name,160),
    route_distance_km:row.route_distance_km==null?null:Number(row.route_distance_km),
    estimated_weight_kg:row.estimated_weight_kg==null?null:Number(row.estimated_weight_kg),
    estimated_volume_l:row.estimated_volume_l==null?null:Number(row.estimated_volume_l),
    required_vehicle_class:clean(row.required_vehicle_class,40),
    delivery_price:row.delivery_fee==null?null:Number(row.delivery_fee),
    currency_code:clean(row.currency_code||'PHP',10),
    offered_at:row.offered_at||null,
    responded_at:row.responded_at||null
  });
}

export function deliveryOfferCourierGate(courier={},delivery={},{
  territoryAuthorized=false,
  hasActiveDelivery=false,
  nowMs=Date.now()
}={}){
  if(!territoryAuthorized)return Object.freeze({allowed:false,reason:'COURIER_TERRITORY_NOT_AUTHORIZED'});
  if(courier.available!==true)return Object.freeze({allowed:false,reason:'COURIER_NOT_AVAILABLE'});
  if(String(courier.eligibility_status||'')!=='approved')return Object.freeze({allowed:false,reason:'COURIER_NOT_APPROVED'});
  if(courier.eligibility_expires_at){
    const expiry=new Date(courier.eligibility_expires_at).getTime();
    if(Number.isFinite(expiry)&&expiry<=Number(nowMs))return Object.freeze({allowed:false,reason:'COURIER_APPROVAL_EXPIRED'});
  }
  if(hasActiveDelivery)return Object.freeze({allowed:false,reason:'COURIER_ALREADY_ACTIVE'});
  const approvedRaw=clean(courier.approved_vehicle_class||courier.vehicle_type,40);
  if(!approvedRaw)return Object.freeze({allowed:false,reason:'VEHICLE_CLASS_MISMATCH'});
  let approvedClass;
  try{approvedClass=canonicalDeliveryVehicleClass(approvedRaw)}
  catch{return Object.freeze({allowed:false,reason:'VEHICLE_CLASS_MISMATCH'})}
  if(delivery.required_vehicle_class){
    let capacity;
    try{capacity=courierCanServeDelivery(courier,delivery)}
    catch{return Object.freeze({allowed:false,reason:'VEHICLE_CLASS_MISMATCH'})}
    if(!capacity.allowed)return Object.freeze({allowed:false,reason:capacity.reason});
  }
  return Object.freeze({allowed:true,reason:'READY',approved_vehicle_class:approvedClass});
}

export function deliveryAssignmentActive(status=''){
  return activeStates.has(String(status||''));
}
