export const DELIVERY_VEHICLE_CLASSES=Object.freeze(['bicycle','car','van']);
export const DELIVERY_PRICING_FORMULAS=Object.freeze(['base_plus_km','distance_weight_volume']);
export const DELIVERY_PLATFORM_RATE_PCT=10;
export const DELIVERY_FEE_BASIS='verified_delivery_price';

const vehicleRank=Object.freeze({bicycle:1,car:2,van:3});
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
function vehicleClass(v){
  const x=clean(v,40).toLowerCase();
  if(!DELIVERY_VEHICLE_CLASSES.includes(x))throw Object.assign(new Error('Unsupported delivery vehicle class'),{status:400});
  return x;
}
function formulaForClass(cls,formula){
  const f=clean(formula,60)|| (cls==='bicycle'?'base_plus_km':'distance_weight_volume');
  if(!DELIVERY_PRICING_FORMULAS.includes(f))throw Object.assign(new Error('Unsupported delivery pricing formula'),{status:400});
  if(cls==='bicycle'&&f!=='base_plus_km')throw Object.assign(new Error('Bicycle pricing must use base_plus_km'),{status:400});
  if(['car','van'].includes(cls)&&f!=='distance_weight_volume')throw Object.assign(new Error('Car and Van pricing must use distance_weight_volume'),{status:400});
  return f;
}

export function normalizeVehiclePricingRule(input={}){
  const cls=vehicleClass(input.vehicle_class||input.vehicleClass);
  const formula=formulaForClass(cls,input.formula_type||input.formulaType);
  const rule={
    vehicle_class:cls,
    formula_type:formula,
    priority:Number.isInteger(Number(input.priority))?Number(input.priority):vehicleRank[cls],
    base_fee:money(nonNegative(input.base_fee??input.baseFee,'base_fee')),
    per_km:money(nonNegative(input.per_km??input.perKm,'per_km')),
    per_kg:money(nonNegative(input.per_kg??input.perKg??0,'per_kg')),
    per_liter:money(nonNegative(input.per_liter??input.perLiter??0,'per_liter')),
    minimum_fee:money(nonNegative(input.minimum_fee??input.minimumFee??0,'minimum_fee')),
    maximum_distance_km:optionalLimit(input.maximum_distance_km??input.maximumDistanceKm,'maximum_distance_km'),
    max_weight_kg:optionalLimit(input.max_weight_kg??input.maxWeightKg,'max_weight_kg'),
    max_volume_l:optionalLimit(input.max_volume_l??input.maxVolumeL,'max_volume_l')
  };
  if(cls==='bicycle'){
    rule.per_kg=0;
    rule.per_liter=0;
  }
  return rule;
}

export function deliveryVehicleRuleEligible(ruleInput,{distanceKm=0,weightKg=0,volumeL=0,minimumVehicleClass=null}={}){
  const rule=normalizeVehiclePricingRule(ruleInput);
  const distance=nonNegative(distanceKm,'distance_km');
  const weight=nonNegative(weightKg,'weight_kg');
  const volume=nonNegative(volumeL,'volume_l');
  if(minimumVehicleClass){
    const min=vehicleClass(minimumVehicleClass);
    if(vehicleRank[rule.vehicle_class]<vehicleRank[min])return false;
  }
  if(rule.maximum_distance_km!=null&&distance>rule.maximum_distance_km)return false;
  if(rule.max_weight_kg!=null&&weight>rule.max_weight_kg)return false;
  if(rule.max_volume_l!=null&&volume>rule.max_volume_l)return false;
  return true;
}

export function calculateDeliveryPrice(ruleInput,{distanceKm=0,weightKg=0,volumeL=0}={}){
  const rule=normalizeVehiclePricingRule(ruleInput);
  const distance=nonNegative(distanceKm,'distance_km');
  const weight=nonNegative(weightKg,'weight_kg');
  const volume=nonNegative(volumeL,'volume_l');
  let raw=rule.base_fee+distance*rule.per_km;
  if(rule.formula_type==='distance_weight_volume'){
    raw+=weight*rule.per_kg+volume*rule.per_liter;
  }
  const fee=money(Math.max(rule.minimum_fee,raw));
  return{
    vehicle_class:rule.vehicle_class,
    formula_type:rule.formula_type,
    distance_km:Math.round(distance*10000)/10000,
    weight_kg:Math.round(weight*10000)/10000,
    volume_l:Math.round(volume*10000)/10000,
    base_component:rule.base_fee,
    distance_component:money(distance*rule.per_km),
    weight_component:rule.formula_type==='distance_weight_volume'?money(weight*rule.per_kg):0,
    volume_component:rule.formula_type==='distance_weight_volume'?money(volume*rule.per_liter):0,
    minimum_fee:rule.minimum_fee,
    delivery_price:fee,
    rule
  };
}

export function selectDeliveryVehicleQuote(rules=[],shipment={}){
  const normalized=(Array.isArray(rules)?rules:[]).map(normalizeVehiclePricingRule);
  const eligible=normalized
    .filter(r=>deliveryVehicleRuleEligible(r,shipment))
    .sort((a,b)=>a.priority-b.priority||vehicleRank[a.vehicle_class]-vehicleRank[b.vehicle_class]);
  if(!eligible.length)throw Object.assign(new Error('No configured vehicle class can carry this delivery within its limits'),{status:409,code:'DELIVERY_NO_ELIGIBLE_VEHICLE_CLASS'});
  return calculateDeliveryPrice(eligible[0],shipment);
}

export function courierCanServeDelivery(courier={},delivery={}){
  const required=vehicleClass(delivery.required_vehicle_class||delivery.requiredVehicleClass);
  const approved=clean(courier.approved_vehicle_class||courier.vehicle_type,40).toLowerCase();
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

export function deliveryPriceSplit(deliveryPrice,{postPromo=false,platformRatePct=DELIVERY_PLATFORM_RATE_PCT}={}){
  const gross=money(nonNegative(deliveryPrice,'delivery price'));
  const rate=postPromo?nonNegative(platformRatePct,'platform rate'):0;
  if(rate>100)throw Object.assign(new Error('platform rate must be between 0 and 100'),{status:400});
  const platformFee=money(gross*rate/100);
  return{
    delivery_price:gross,
    fee_basis:DELIVERY_FEE_BASIS,
    post_promo:Boolean(postPromo),
    platform_rate_pct:rate,
    business_life_delivery_fee:platformFee,
    courier_gross_entitlement:money(gross-platformFee)
  };
}
