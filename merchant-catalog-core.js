const MASS_UNITS=new Map([
  ['g',{unit:'g',factor:1}],['gram',{unit:'g',factor:1}],['grams',{unit:'g',factor:1}],
  ['kg',{unit:'kg',factor:1000}],['kilogram',{unit:'kg',factor:1000}],['kilograms',{unit:'kg',factor:1000}]
]);
const VOLUME_UNITS=new Map([
  ['ml',{unit:'ml',factor:1}],['milliliter',{unit:'ml',factor:1}],['milliliters',{unit:'ml',factor:1}],
  ['millilitre',{unit:'ml',factor:1}],['millilitres',{unit:'ml',factor:1}],
  ['l',{unit:'L',factor:1000}],['liter',{unit:'L',factor:1000}],['liters',{unit:'L',factor:1000}],
  ['litre',{unit:'L',factor:1000}],['litres',{unit:'L',factor:1000}]
]);
const COUNT_UNITS=new Map([
  ['unit',{unit:'unit',factor:1}],['units',{unit:'unit',factor:1}],['pc',{unit:'unit',factor:1}],
  ['pcs',{unit:'unit',factor:1}],['piece',{unit:'unit',factor:1}],['pieces',{unit:'unit',factor:1}],
  ['each',{unit:'unit',factor:1}]
]);

const PRODUCT_KINDS=new Set(['prepared_recipe','fresh_direct','packaged_resale','non_food_resale']);
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const finite=value=>Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;
const round=(value,decimals=6)=>{
  const p=10**decimals;
  return Math.round((Number(value)+Number.EPSILON)*p)/p;
};

export function measurementUnit(value){
  const raw=clean(value,40);
  const key=raw.toLowerCase();
  if(MASS_UNITS.has(key))return{family:'mass',base_unit:'g',...MASS_UNITS.get(key)};
  if(VOLUME_UNITS.has(key))return{family:'volume',base_unit:'ml',...VOLUME_UNITS.get(key)};
  if(COUNT_UNITS.has(key))return{family:'count',base_unit:'unit',...COUNT_UNITS.get(key)};
  return null;
}

export function toBaseQuantity(quantity,unit){
  if(!positive(quantity))throw new TypeError('Quantity must be greater than zero.');
  const meta=measurementUnit(unit);
  if(!meta)throw new TypeError('Use a supported unit: kg, g, L, ml or unit/piece.');
  return{
    family:meta.family,
    entered_unit:meta.unit,
    base_unit:meta.base_unit,
    entered_quantity:Number(quantity),
    base_quantity:round(Number(quantity)*meta.factor,6)
  };
}

export function deriveStockPurchase({
  purchase_quantity,purchase_unit,total_cost,reorder_quantity=0,reorder_unit=''
}={}){
  const q=toBaseQuantity(purchase_quantity,purchase_unit);
  if(!finite(total_cost)||Number(total_cost)<0)throw new TypeError('Total purchase cost must be zero or greater.');
  let reorderBase=0;
  if(Number(reorder_quantity)>0){
    const r=toBaseQuantity(reorder_quantity,reorder_unit||purchase_unit);
    if(r.family!==q.family)throw new TypeError('Reorder quantity must use the same measurement family as the stock item.');
    reorderBase=r.base_quantity;
  }
  return{
    measurement_family:q.family,
    base_unit:q.base_unit,
    purchase_quantity:Number(purchase_quantity),
    purchase_unit:q.entered_unit,
    base_quantity:q.base_quantity,
    total_cost:round(Number(total_cost),2),
    base_unit_cost:q.base_quantity>0?round(Number(total_cost)/q.base_quantity,8):0,
    reorder_base_quantity:reorderBase
  };
}

export function weightedAverageUnitCost({
  existing_quantity=0,existing_unit_cost=0,purchased_base_quantity,purchase_total_cost
}={}){
  const oldQty=Math.max(0,Number(existing_quantity)||0);
  const oldCost=Math.max(0,Number(existing_unit_cost)||0);
  const addQty=Number(purchased_base_quantity);
  const addCost=Number(purchase_total_cost);
  if(!positive(addQty)||!finite(addCost)||addCost<0)throw new TypeError('Invalid stock purchase for weighted-average costing.');
  const totalQty=oldQty+addQty;
  return round(((oldQty*oldCost)+addCost)/totalQty,8);
}

function normalizeInventoryMeta(item){
  const base=measurementUnit(item?.base_unit||item?.unit||'');
  const family=clean(item?.measurement_family,20)||base?.family||'';
  const baseUnit=clean(item?.base_unit,20)||base?.base_unit||clean(item?.unit,20);
  return{family,baseUnit};
}

export function computeRecipeBatch({
  yield_quantity,yield_unit,selling_quantity,selling_unit,components=[],inventory=[]
}={}){
  const yieldMeta=toBaseQuantity(yield_quantity,yield_unit);
  const sellingMeta=toBaseQuantity(selling_quantity,selling_unit);
  if(yieldMeta.family!==sellingMeta.family)throw new TypeError('Finished batch and selling quantity must use compatible units.');
  if(sellingMeta.base_quantity>yieldMeta.base_quantity+1e-9)throw new TypeError('Selling quantity cannot exceed the finished batch yield.');

  const saleUnits=yieldMeta.base_quantity/sellingMeta.base_quantity;
  if(!Number.isFinite(saleUnits)||saleUnits<=0)throw new TypeError('Recipe yield could not be converted into sellable units.');

  const byId=new Map((inventory||[]).map(x=>[Number(x.id),x]));
  const seen=new Set();
  const normalized=[];
  let batchCost=0;

  for(const raw of Array.isArray(components)?components:[]){
    const inventoryId=Number(raw?.inventory_id);
    if(!Number.isInteger(inventoryId)||inventoryId<1)throw new TypeError('Every recipe ingredient needs a valid inventory item.');
    if(seen.has(inventoryId))throw new TypeError('The same ingredient cannot appear twice in one recipe.');
    seen.add(inventoryId);

    const item=byId.get(inventoryId);
    if(!item)throw new TypeError('One or more recipe ingredients are not available in this business.');
    const qty=toBaseQuantity(raw?.quantity,raw?.unit||item.base_unit||item.unit);
    const invMeta=normalizeInventoryMeta(item);
    if(invMeta.family&&qty.family!==invMeta.family)throw new TypeError(`${clean(item.item,100)||'Ingredient'} uses a different measurement family.`);

    const unitCost=Math.max(0,Number(item.unit_cost)||0);
    const componentCost=round(qty.base_quantity*unitCost,6);
    batchCost+=componentCost;
    normalized.push({
      inventory_id:inventoryId,
      item:clean(item.item,100),
      measurement_family:qty.family,
      batch_quantity:Number(raw.quantity),
      batch_unit:qty.entered_unit,
      base_quantity:qty.base_quantity,
      base_unit:qty.base_unit,
      per_sale_quantity:round(qty.base_quantity/saleUnits,6),
      percentage:qty.family===yieldMeta.family?round((qty.base_quantity/yieldMeta.base_quantity)*100,2):null,
      unit_cost:unitCost,
      batch_cost:componentCost
    });
  }

  if(!normalized.length)throw new TypeError('Add at least one ingredient to the recipe.');

  return{
    yield_quantity:Number(yield_quantity),
    yield_unit:yieldMeta.entered_unit,
    yield_base_quantity:yieldMeta.base_quantity,
    yield_base_unit:yieldMeta.base_unit,
    selling_quantity:Number(selling_quantity),
    selling_unit:sellingMeta.entered_unit,
    selling_base_quantity:sellingMeta.base_quantity,
    sale_units_per_batch:round(saleUnits,6),
    batch_cost:round(batchCost,4),
    cost_per_sale_unit:round(batchCost/saleUnits,4),
    components:normalized
  };
}

export function normalizedProductKind(value,domain='food'){
  const raw=clean(value,40);
  if(PRODUCT_KINDS.has(raw))return raw;
  return domain==='non_food'?'non_food_resale':'prepared_recipe';
}

export function marketplaceKindForProductKind(kind){
  return ({
    prepared_recipe:'prepared_food',
    fresh_direct:'fresh_direct',
    packaged_resale:'packaged_resale',
    non_food_resale:'non_food_resale'
  })[kind]||'prepared_food';
}

export function productKindForMarketplaceKind(kind,domain='food'){
  return ({
    prepared_food:'prepared_recipe',
    fresh_direct:'fresh_direct',
    packaged_resale:'packaged_resale',
    non_food_resale:'non_food_resale'
  })[kind]||(domain==='non_food'?'non_food_resale':'prepared_recipe');
}

export { PRODUCT_KINDS };
