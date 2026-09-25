export const DELIVERY_CANONICAL_VEHICLE_CLASSES=Object.freeze([
  'bicycle','motorcycle','sedan','mpv_suv','pickup','l300_van'
]);
export const DELIVERY_VEHICLE_ALIASES=Object.freeze({
  bike:'bicycle',
  motorbike:'motorcycle',
  scooter:'motorcycle',
  moto:'motorcycle',
  car:'sedan',
  hatchback:'sedan',
  suv:'mpv_suv',
  mpv:'mpv_suv',
  'mpv/suv':'mpv_suv',
  l300:'l300_van',
  van:'l300_van',
  cargo_van:'l300_van',
  'l300/cargo_van':'l300_van'
});
export const DELIVERY_VEHICLE_CLASSES=DELIVERY_CANONICAL_VEHICLE_CLASSES;
export const DELIVERY_PRICING_FORMULAS=Object.freeze(['base_plus_km','distance_weight_volume','tiered_distance']);
export const DELIVERY_ROUTE_PROFILES=Object.freeze([
  'bicycle_local','motorcycle_no_expressway','car_optional_tolls','light_commercial_optional_tolls'
]);
export const DELIVERY_STACKING_POLICIES=Object.freeze(['direct_only','explicit_shared']);
export const DELIVERY_PASS_THROUGH_POLICIES=Object.freeze(['pass_through','included','disabled']);
export const DELIVERY_PLATFORM_RATE_PCT=10;
export const DELIVERY_FEE_BASIS='verified_delivery_service_fare';

const vehicleRank=Object.freeze({
  bicycle:1,motorcycle:2,sedan:3,mpv_suv:4,pickup:5,l300_van:6
});
const defaultRouteProfile=Object.freeze({
  bicycle:'bicycle_local',
  motorcycle:'motorcycle_no_expressway',
  sedan:'car_optional_tolls',
  mpv_suv:'car_optional_tolls',
  pickup:'light_commercial_optional_tolls',
  l300_van:'light_commercial_optional_tolls'
});
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const clean=(v,max=120)=>String(v??'').trim().slice(0,max);

function nonNegative(v,label){
  const n=Number(v);
  if(!Number.isFinite(n)||n<0)throw Object.assign(new Error(label+' must be zero or greater'),{status:400});
  return n;
}
function optionalLimit(v,label){
  if(v==null||v==='')return null;
  return nonNegative(v,label);
}
function integerNonNegative(v,label){
  const n=Number(v);
  if(!Number.isInteger(n)||n<0)throw Object.assign(new Error(label+' must be a whole number zero or greater'),{status:400});
  return n;
}
function enumValue(value,allowed,label,fallback){
  const x=clean(value,80)||fallback;
  if(!allowed.includes(x))throw Object.assign(new Error('Unsupported '+label),{status:400});
  return x;
}

export function canonicalDeliveryVehicleClass(v){
  const raw=clean(v,40).toLowerCase().replace(/\s+/g,'_');
  const x=DELIVERY_VEHICLE_ALIASES[raw]||raw;
  if(!DELIVERY_CANONICAL_VEHICLE_CLASSES.includes(x)){
    throw Object.assign(new Error('Unsupported delivery vehicle class'),{status:400});
  }
  return x;
}

function formulaForClass(cls,formula){
  const requested=clean(formula,60);
  const f=requested||(
    cls==='bicycle'?'base_plus_km':'tiered_distance'
  );
  if(!DELIVERY_PRICING_FORMULAS.includes(f)){
    throw Object.assign(new Error('Unsupported delivery pricing formula'),{status:400});
  }
  if(cls==='bicycle'&&!['base_plus_km','tiered_distance'].includes(f)){
    throw Object.assign(new Error('Bicycle pricing must use base_plus_km or tiered_distance'),{status:400});
  }
  return f;
}

export function normalizeDistanceBands(input=[],{
  includedDistanceKm=0,
  maximumDistanceKm=null
}={}){
  const included=nonNegative(includedDistanceKm,'included_distance_km');
  const maximum=maximumDistanceKm==null?null:nonNegative(maximumDistanceKm,'maximum_distance_km');
  const raw=Array.isArray(input)?input:[];
  if(!raw.length)return[];
  const bands=[];
  let previous=included;
  let openEnded=false;
  for(let index=0;index<raw.length;index++){
    const item=raw[index]||{};
    const isLast=index===raw.length-1;
    const rawUpper=item.up_to_km??item.upToKm;
    const upper=rawUpper==null?null:Number(rawUpper);
    const rate=money(nonNegative(item.per_km??item.perKm,'distance band per_km'));
    if(openEnded)throw Object.assign(new Error('No distance band may follow an open-ended band'),{status:400});
    if(upper==null){
      if(!isLast)throw Object.assign(new Error('Only the final distance band may be open-ended'),{status:400});
      openEnded=true;
      bands.push({up_to_km:null,per_km:rate});
      continue;
    }
    if(!Number.isFinite(upper)||upper<=previous){
      throw Object.assign(new Error('Distance band thresholds must increase beyond the included distance'),{status:400});
    }
    bands.push({up_to_km:Math.round(upper*10000)/10000,per_km:rate});
    previous=upper;
  }
  if(maximum!=null){
    const last=bands.at(-1);
    if(last?.up_to_km!=null&&last.up_to_km<maximum){
      throw Object.assign(new Error('Distance bands must cover maximum_distance_km'),{status:400});
    }
  }else if(bands.at(-1)?.up_to_km!=null){
    throw Object.assign(new Error('Pricing without maximum_distance_km requires an open-ended final distance band'),{status:400});
  }
  return bands;
}

export function normalizeVehiclePricingRule(input={}){
  const cls=canonicalDeliveryVehicleClass(input.vehicle_class||input.vehicleClass);
  const formula=formulaForClass(cls,input.formula_type||input.formulaType);
  const maximumDistance=optionalLimit(input.maximum_distance_km??input.maximumDistanceKm,'maximum_distance_km');
  const includedDistance=nonNegative(input.included_distance_km??input.includedDistanceKm??0,'included_distance_km');
  if(maximumDistance!=null&&includedDistance>maximumDistance){
    throw Object.assign(new Error('included_distance_km cannot exceed maximum_distance_km'),{status:400});
  }
  const routeProfile=enumValue(
    input.route_profile??input.routeProfile,
    DELIVERY_ROUTE_PROFILES,
    'delivery route profile',
    defaultRouteProfile[cls]
  );
  if(cls==='motorcycle'&&routeProfile!=='motorcycle_no_expressway'){
    throw Object.assign(new Error('Motorcycle pricing must use the no-expressway route profile'),{status:400});
  }
  if(cls==='bicycle'&&routeProfile!=='bicycle_local'){
    throw Object.assign(new Error('Bicycle pricing must use the local bicycle route profile'),{status:400});
  }

  const rule={
    vehicle_class:cls,
    formula_type:formula,
    priority:Number.isInteger(Number(input.priority))?Number(input.priority):vehicleRank[cls],
    base_fee:money(nonNegative(input.base_fee??input.baseFee??0,'base_fee')),
    per_km:money(nonNegative(input.per_km??input.perKm??0,'per_km')),
    per_kg:money(nonNegative(input.per_kg??input.perKg??0,'per_kg')),
    per_liter:money(nonNegative(input.per_liter??input.perLiter??0,'per_liter')),
    minimum_fee:money(nonNegative(input.minimum_fee??input.minimumFee??0,'minimum_fee')),
    maximum_distance_km:maximumDistance,
    max_weight_kg:optionalLimit(input.max_weight_kg??input.maxWeightKg,'max_weight_kg'),
    max_volume_l:optionalLimit(input.max_volume_l??input.maxVolumeL,'max_volume_l'),
    included_distance_km:includedDistance,
    distance_bands:[],
    extra_stop_fee:money(nonNegative(input.extra_stop_fee??input.extraStopFee??0,'extra_stop_fee')),
    free_wait_minutes:integerNonNegative(input.free_wait_minutes??input.freeWaitMinutes??0,'free_wait_minutes'),
    waiting_fee_per_minute:money(nonNegative(input.waiting_fee_per_minute??input.waitingFeePerMinute??0,'waiting_fee_per_minute')),
    demand_adjustment_cap_pct:money(nonNegative(input.demand_adjustment_cap_pct??input.demandAdjustmentCapPct??0,'demand_adjustment_cap_pct')),
    route_profile:routeProfile,
    expressway_eligible:Boolean(input.expressway_eligible??input.expresswayEligible??!['bicycle','motorcycle'].includes(cls)),
    toll_policy:enumValue(input.toll_policy??input.tollPolicy,DELIVERY_PASS_THROUGH_POLICIES,'toll policy',['bicycle','motorcycle'].includes(cls)?'disabled':'pass_through'),
    parking_policy:enumValue(input.parking_policy??input.parkingPolicy,DELIVERY_PASS_THROUGH_POLICIES,'parking policy','pass_through'),
    stacking_policy:enumValue(input.stacking_policy??input.stackingPolicy,DELIVERY_STACKING_POLICIES,'stacking policy','direct_only')
  };
  if(rule.demand_adjustment_cap_pct>100){
    throw Object.assign(new Error('demand_adjustment_cap_pct cannot exceed 100'),{status:400});
  }
  if(['bicycle','motorcycle'].includes(cls))rule.expressway_eligible=false;
  if(formula==='tiered_distance'){
    rule.per_kg=0;
    rule.per_liter=0;
    rule.per_km=0;
    rule.distance_bands=normalizeDistanceBands(
      input.distance_bands??input.distanceBands,
      {includedDistanceKm:includedDistance,maximumDistanceKm:maximumDistance}
    );
    if(!rule.distance_bands.length){
      throw Object.assign(new Error('tiered_distance pricing requires distance_bands'),{status:400});
    }
  }else{
    rule.included_distance_km=0;
    rule.distance_bands=[];
    if(formula==='base_plus_km'){
      rule.per_kg=0;
      rule.per_liter=0;
    }
  }
  return rule;
}

export function deliveryVehicleRuleEligible(ruleInput,{distanceKm=0,weightKg=0,volumeL=0,minimumVehicleClass=null}={}){
  const rule=normalizeVehiclePricingRule(ruleInput);
  const distance=nonNegative(distanceKm,'distance_km');
  const weight=nonNegative(weightKg,'weight_kg');
  const volume=nonNegative(volumeL,'volume_l');
  if(minimumVehicleClass){
    const min=canonicalDeliveryVehicleClass(minimumVehicleClass);
    if(vehicleRank[rule.vehicle_class]<vehicleRank[min])return false;
  }
  if(rule.maximum_distance_km!=null&&distance>rule.maximum_distance_km)return false;
  if(rule.max_weight_kg!=null&&weight>rule.max_weight_kg)return false;
  if(rule.max_volume_l!=null&&volume>rule.max_volume_l)return false;
  return true;
}

function tieredDistanceComponents(rule,distance){
  if(distance<=rule.included_distance_km)return{amount:0,bands:[]};
  let previous=rule.included_distance_km;
  let amount=0;
  const bands=[];
  for(const band of rule.distance_bands){
    const upper=band.up_to_km==null?distance:Math.min(distance,band.up_to_km);
    const km=Math.max(0,upper-previous);
    if(km>0){
      const component=money(km*band.per_km);
      bands.push({
        from_km:Math.round(previous*10000)/10000,
        to_km:Math.round(upper*10000)/10000,
        km:Math.round(km*10000)/10000,
        per_km:band.per_km,
        amount:component
      });
      amount=money(amount+component);
    }
    if(band.up_to_km==null||distance<=band.up_to_km)break;
    previous=band.up_to_km;
  }
  const covered=bands.length?bands.at(-1).to_km:rule.included_distance_km;
  if(distance>covered+0.000001){
    throw Object.assign(new Error('Distance is outside configured tier coverage'),{status:409,code:'DELIVERY_DISTANCE_TIER_GAP'});
  }
  return{amount,bands};
}

export function calculateDeliveryPrice(ruleInput,{distanceKm=0,weightKg=0,volumeL=0}={}){
  const rule=normalizeVehiclePricingRule(ruleInput);
  const distance=nonNegative(distanceKm,'distance_km');
  const weight=nonNegative(weightKg,'weight_kg');
  const volume=nonNegative(volumeL,'volume_l');
  if(rule.maximum_distance_km!=null&&distance>rule.maximum_distance_km){
    throw Object.assign(new Error('Delivery distance exceeds this vehicle pricing rule'),{status:409,code:'DELIVERY_DISTANCE_EXCEEDED'});
  }
  let distanceComponent=0,bandComponents=[];
  if(rule.formula_type==='tiered_distance'){
    const tiered=tieredDistanceComponents(rule,distance);
    distanceComponent=tiered.amount;
    bandComponents=tiered.bands;
  }else{
    distanceComponent=money(distance*rule.per_km);
  }
  let raw=rule.base_fee+distanceComponent;
  let weightComponent=0,volumeComponent=0;
  if(rule.formula_type==='distance_weight_volume'){
    weightComponent=money(weight*rule.per_kg);
    volumeComponent=money(volume*rule.per_liter);
    raw+=weightComponent+volumeComponent;
  }
  const fee=money(Math.max(rule.minimum_fee,raw));
  return{
    vehicle_class:rule.vehicle_class,
    formula_type:rule.formula_type,
    distance_km:Math.round(distance*10000)/10000,
    weight_kg:Math.round(weight*10000)/10000,
    volume_l:Math.round(volume*10000)/10000,
    base_component:rule.base_fee,
    included_distance_km:rule.included_distance_km,
    distance_component:distanceComponent,
    distance_band_components:bandComponents,
    weight_component:weightComponent,
    volume_component:volumeComponent,
    minimum_fee:rule.minimum_fee,
    service_fare:fee,
    delivery_price:fee,
    rule
  };
}

export function calculateDeliveryQuoteTotal(ruleInput,shipment={},extras={}){
  const price=calculateDeliveryPrice(ruleInput,shipment);
  const rule=price.rule;
  const extraStops=integerNonNegative(extras.extra_stops??extras.extraStops??0,'extra_stops');
  const waitingMinutes=nonNegative(extras.waiting_minutes??extras.waitingMinutes??0,'waiting_minutes');
  const toll=money(nonNegative(extras.toll_amount??extras.tollAmount??0,'toll_amount'));
  const parking=money(nonNegative(extras.parking_amount??extras.parkingAmount??0,'parking_amount'));
  const specialHandling=money(nonNegative(extras.special_handling_amount??extras.specialHandlingAmount??0,'special_handling_amount'));
  const promotionDiscount=money(nonNegative(extras.promotion_discount??extras.promotionDiscount??0,'promotion_discount'));
  const demandPct=nonNegative(extras.demand_adjustment_pct??extras.demandAdjustmentPct??0,'demand_adjustment_pct');
  if(demandPct>rule.demand_adjustment_cap_pct){
    throw Object.assign(new Error('Demand adjustment exceeds the configured cap'),{status:400,code:'DELIVERY_DEMAND_CAP_EXCEEDED'});
  }
  if(toll>0&&rule.toll_policy==='disabled'){
    throw Object.assign(new Error('Toll is not allowed for this route profile'),{status:400,code:'DELIVERY_TOLL_NOT_ALLOWED'});
  }
  if(parking>0&&rule.parking_policy==='disabled'){
    throw Object.assign(new Error('Parking charge is not allowed for this pricing rule'),{status:400,code:'DELIVERY_PARKING_NOT_ALLOWED'});
  }

  const extraStopAmount=money(extraStops*rule.extra_stop_fee);
  const chargeableWaitingMinutes=Math.max(0,waitingMinutes-rule.free_wait_minutes);
  const waitingAmount=money(chargeableWaitingMinutes*rule.waiting_fee_per_minute);
  const serviceBeforeDemand=money(price.service_fare+extraStopAmount+waitingAmount+specialHandling);
  const demandAdjustment=money(serviceBeforeDemand*demandPct/100);
  const serviceBeforePromotion=money(serviceBeforeDemand+demandAdjustment);
  const discount=Math.min(promotionDiscount,serviceBeforePromotion);
  const platformFeeBasisAmount=money(serviceBeforePromotion-discount);
  const tollPassThrough=rule.toll_policy==='pass_through'?toll:0;
  const parkingPassThrough=rule.parking_policy==='pass_through'?parking:0;
  const passThroughAmount=money(tollPassThrough+parkingPassThrough);
  const customerTotal=money(platformFeeBasisAmount+passThroughAmount);

  return{
    ...price,
    service_fare:price.service_fare,
    extra_stops:extraStops,
    extra_stop_amount:extraStopAmount,
    waiting_minutes:waitingMinutes,
    free_wait_minutes:rule.free_wait_minutes,
    chargeable_waiting_minutes:Math.round(chargeableWaitingMinutes*100)/100,
    waiting_amount:waitingAmount,
    special_handling_amount:specialHandling,
    demand_adjustment_pct:money(demandPct),
    demand_adjustment_amount:demandAdjustment,
    promotion_discount:discount,
    toll_amount:tollPassThrough,
    parking_amount:parkingPassThrough,
    pass_through_amount:passThroughAmount,
    platform_fee_basis_amount:platformFeeBasisAmount,
    customer_delivery_total:customerTotal,
    delivery_price:customerTotal,
    route_policy:{
      route_profile:rule.route_profile,
      expressway_eligible:rule.expressway_eligible,
      toll_policy:rule.toll_policy,
      parking_policy:rule.parking_policy,
      stacking_policy:rule.stacking_policy
    }
  };
}

export function selectDeliveryVehicleQuote(rules=[],shipment={}){
  const normalized=(Array.isArray(rules)?rules:[]).map(normalizeVehiclePricingRule);
  const eligible=normalized
    .filter(r=>deliveryVehicleRuleEligible(r,shipment))
    .sort((a,b)=>a.priority-b.priority||vehicleRank[a.vehicle_class]-vehicleRank[b.vehicle_class]);
  if(!eligible.length){
    throw Object.assign(new Error('No configured vehicle class can carry this delivery within its limits'),{status:409,code:'DELIVERY_NO_ELIGIBLE_VEHICLE_CLASS'});
  }
  return calculateDeliveryPrice(eligible[0],shipment);
}

export function courierCanServeDelivery(courier={},delivery={}){
  const required=canonicalDeliveryVehicleClass(delivery.required_vehicle_class||delivery.requiredVehicleClass);
  const approvedRaw=clean(courier.approved_vehicle_class||courier.vehicle_type,40);
  if(!approvedRaw)return{allowed:false,reason:'VEHICLE_CLASS_MISMATCH'};
  const approved=canonicalDeliveryVehicleClass(approvedRaw);
  if(approved!==required)return{allowed:false,reason:'VEHICLE_CLASS_MISMATCH'};
  const weight=nonNegative(delivery.estimated_weight_kg??delivery.weightKg??0,'delivery weight');
  const volume=nonNegative(delivery.estimated_volume_l??delivery.volumeL??0,'delivery volume');
  const distance=nonNegative(delivery.route_distance_km??delivery.distanceKm??0,'delivery distance');
  const maxWeight=courier.max_weight_kg==null?null:Number(courier.max_weight_kg);
  const maxVolume=courier.max_volume_l==null?null:Number(courier.max_volume_l);
  const radius=courier.service_radius_km==null?null:Number(courier.service_radius_km);
  if(maxWeight!=null&&Number.isFinite(maxWeight)&&weight>maxWeight)return{allowed:false,reason:'COURIER_WEIGHT_CAPACITY_EXCEEDED'};
  if(maxVolume!=null&&Number.isFinite(maxVolume)&&volume>maxVolume)return{allowed:false,reason:'COURIER_VOLUME_CAPACITY_EXCEEDED'};
  if(radius!=null&&Number.isFinite(radius)&&distance>radius)return{allowed:false,reason:'COURIER_SERVICE_RADIUS_EXCEEDED'};
  return{allowed:true,reason:'READY'};
}

export function deliveryPriceSplit(deliveryPrice,{
  postPromo=false,
  platformRatePct=DELIVERY_PLATFORM_RATE_PCT,
  excludedPassThrough=0
}={}){
  const gross=money(nonNegative(deliveryPrice,'delivery price'));
  const excluded=money(nonNegative(excludedPassThrough,'excluded pass-through'));
  if(excluded>gross)throw Object.assign(new Error('excluded pass-through cannot exceed delivery price'),{status:400});
  const serviceFareBasis=money(gross-excluded);
  const rate=postPromo?nonNegative(platformRatePct,'platform rate'):0;
  if(rate>100)throw Object.assign(new Error('platform rate must be between 0 and 100'),{status:400});
  const platformFee=money(serviceFareBasis*rate/100);
  return{
    delivery_price:gross,
    fee_basis:DELIVERY_FEE_BASIS,
    platform_fee_basis_amount:serviceFareBasis,
    excluded_pass_through:excluded,
    post_promo:Boolean(postPromo),
    platform_rate_pct:rate,
    business_life_delivery_fee:platformFee,
    courier_gross_entitlement:money(serviceFareBasis-platformFee)
  };
}
