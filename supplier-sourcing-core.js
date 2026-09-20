import {toBaseQuantity} from './merchant-catalog-core.js';

export const SUPPLIER_DISCOVERY_VISIBILITY=Object.freeze(['private','directory','rfq_only']);
export const SOURCING_CATEGORY_CODES=Object.freeze([
  'fresh_produce','meat_poultry','fish_seafood','rice_grains','beverages','packaged_foods',
  'frozen_foods','bakery','household_fmcg','personal_care','packaging','cleaning_supplies',
  'lpg_fuel','equipment','services','other'
]);

const VISIBILITY=new Set(SUPPLIER_DISCOVERY_VISIBILITY);
const CATEGORY=new Set(SOURCING_CATEGORY_CODES);
const finite=(v,l)=>{const n=Number(v);if(!Number.isFinite(n))throw new TypeError(`${l} must be finite`);return n};
const positive=(v,l)=>{const n=finite(v,l);if(n<=0)throw new RangeError(`${l} must be greater than zero`);return n};
const nonNegative=(v,l)=>{const n=finite(v,l);if(n<0)throw new RangeError(`${l} cannot be negative`);return n};
const roundMoney=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;

export function normalizeDiscoverySettings({visibility='private',acceptsRfqs=false,categories=[]}={}){
  const v=String(visibility||'private').trim().toLowerCase();
  if(!VISIBILITY.has(v))throw new RangeError(`Unsupported discovery visibility: ${visibility}`);
  const input=Array.isArray(categories)?categories:[categories];
  const normalized=[];
  for(const value of input){
    const code=String(value??'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    if(!code)continue;
    if(!CATEGORY.has(code))throw new RangeError(`Unsupported sourcing category: ${value}`);
    if(!normalized.includes(code))normalized.push(code);
  }
  return{visibility:v,accepts_rfqs:Boolean(acceptsRfqs),categories:normalized};
}

export function normalizeRfq({
  itemSpecification,quantity,unit,fulfilmentMode='either',
  substitutionPolicy='approval_required',targetBudget=null,currencyCode='PHP'
}={}){
  const item=String(itemSpecification??'').trim();
  if(!item)throw new RangeError('itemSpecification is required');
  const qty=positive(quantity,'quantity');
  const u=String(unit??'').trim();
  if(!u)throw new RangeError('unit is required');
  const fulfil=String(fulfilmentMode||'either').trim().toLowerCase();
  if(!['delivery','pickup','either'].includes(fulfil))throw new RangeError('Unsupported fulfilment mode');
  const substitution=String(substitutionPolicy||'approval_required').trim().toLowerCase();
  if(!['allowed','approval_required','no_substitution'].includes(substitution))throw new RangeError('Unsupported substitution policy');
  const budget=targetBudget==null||targetBudget===''?null:nonNegative(targetBudget,'targetBudget');
  const currency=String(currencyCode||'PHP').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw new RangeError('currencyCode must be a three-letter code');
  return{
    item_specification:item,
    requested_quantity:qty,
    requested_unit:u,
    fulfilment_mode:fulfil,
    substitution_policy:substitution,
    target_budget:budget,
    currency_code:currency
  };
}

function normalizedQuantity(quantity,unit){
  try{
    const q=toBaseQuantity(Number(quantity),String(unit));
    return{ok:true,family:q.family,base_unit:q.base_unit,base_quantity:Number(q.base_quantity)};
  }catch{
    return{ok:false,family:null,base_unit:String(unit||''),base_quantity:Number(quantity)};
  }
}

export function quoteEconomics({
  quotedPacks,pricePerPack,deliveryFee=0,baseUnitsPerPack,baseUnit,
  requestedQuantity=null,requestedUnit=null
}={}){
  const packs=positive(quotedPacks,'quotedPacks');
  const price=nonNegative(pricePerPack,'pricePerPack');
  const delivery=nonNegative(deliveryFee,'deliveryFee');
  const perPack=positive(baseUnitsPerPack,'baseUnitsPerPack');
  const subtotal=roundMoney(packs*price);
  const landed=roundMoney(subtotal+delivery);
  const offeredBaseQty=packs*perPack;
  const offered=normalizedQuantity(offeredBaseQty,baseUnit);
  let comparable=true,comparison_status='COMPARABLE',coverage_ratio=null,normalized_landed_cost=null;
  if(requestedQuantity!=null&&requestedUnit){
    const requested=normalizedQuantity(requestedQuantity,requestedUnit);
    comparable=offered.ok&&requested.ok&&offered.family===requested.family&&offered.base_unit===requested.base_unit;
    if(comparable){
      coverage_ratio=offered.base_quantity/requested.base_quantity;
      normalized_landed_cost=landed/offered.base_quantity;
    }else{
      comparison_status='NOT_COMPARABLE';
    }
  }else if(offered.ok){
    normalized_landed_cost=landed/offered.base_quantity;
  }else{
    comparable=false;comparison_status='NOT_COMPARABLE';
  }
  return{
    quoted_packs:packs,
    subtotal,
    delivery_fee:roundMoney(delivery),
    landed_total:landed,
    offered_base_quantity:offeredBaseQty,
    offered_base_unit:String(baseUnit||''),
    comparable,
    comparison_status,
    normalized_base_unit:comparable?offered.base_unit:null,
    normalized_landed_cost:normalized_landed_cost==null?null:Number(normalized_landed_cost.toFixed(6)),
    coverage_ratio:coverage_ratio==null?null:Number(coverage_ratio.toFixed(6))
  };
}

export function compareQuotes({rfq,quotes=[]}={}){
  if(!rfq)throw new TypeError('rfq is required');
  const rows=(quotes||[]).map(q=>{
    const econ=quoteEconomics({
      quotedPacks:q.quoted_packs,
      pricePerPack:q.price_per_pack,
      deliveryFee:q.delivery_fee,
      baseUnitsPerPack:q.base_units_per_pack,
      baseUnit:q.base_unit,
      requestedQuantity:rfq.requested_quantity,
      requestedUnit:rfq.requested_unit
    });
    return{...q,...econ};
  });
  const comparable=rows.filter(x=>x.comparable&&x.status==='active');
  const valid=rows.filter(x=>x.status==='active');
  let lowest=null,earliest=null;
  if(comparable.length){
    lowest=[...comparable].sort((a,b)=>a.normalized_landed_cost-b.normalized_landed_cost||Number(a.id)-Number(b.id))[0];
  }
  const dated=valid.filter(x=>x.earliest_fulfilment_date);
  if(dated.length){
    earliest=[...dated].sort((a,b)=>String(a.earliest_fulfilment_date).localeCompare(String(b.earliest_fulfilment_date))||Number(a.id)-Number(b.id))[0];
  }
  return{
    quotes:rows,
    factual_highlights:{
      lowest_normalized_landed_cost_quote_id:lowest?Number(lowest.id):null,
      earliest_fulfilment_quote_id:earliest?Number(earliest.id):null
    },
    auto_selected_quote_id:null
  };
}

export function validatePreferenceRanks(sources=[]){
  if(!Array.isArray(sources))throw new TypeError('sources must be an array');
  const ranks=new Set(),catalog=new Set();
  return sources.map((s,index)=>{
    const rank=Math.trunc(positive(s.preference_rank??s.rank??index+1,'preference_rank'));
    const catalogId=Number(s.catalog_item_id);
    if(!Number.isInteger(catalogId)||catalogId<=0)throw new RangeError('catalog_item_id is required');
    if(ranks.has(rank))throw new RangeError(`Duplicate preference rank: ${rank}`);
    if(catalog.has(catalogId))throw new RangeError(`Duplicate catalog source: ${catalogId}`);
    ranks.add(rank);catalog.add(catalogId);
    return{catalog_item_id:catalogId,preference_rank:rank,note:String(s.note??'').trim().slice(0,500)};
  }).sort((a,b)=>a.preference_rank-b.preference_rank);
}
