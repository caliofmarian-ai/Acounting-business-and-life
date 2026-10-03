export const STORAGE_CONDITIONS=Object.freeze(['ambient','dry','chilled','frozen','other']);
export const STORAGE_AREA_TYPES=Object.freeze(['pantry','fridge','freezer','prep_station','chemical_storage','service_storage','other']);

const FOOD_STORAGE_AREAS=new Set(['pantry','fridge','freezer','prep_station']);
const FOOD_CONTACT_TYPES=new Set(['ingredient','packaging','kitchen_consumable','hygiene']);
const clean=(value,max=120)=>String(value??'').trim().slice(0,max);

export function inventoryStorageDefaults(inventoryType='ingredient'){
  const type=clean(inventoryType,40)||'ingredient';
  if(type==='cleaning_sanitation')return{
    storage_condition:'ambient',
    storage_area_type:'chemical_storage',
    storage_location_label:'Chemical storage',
    storage_segregated:true
  };
  if(type==='operational_supply')return{
    storage_condition:'dry',
    storage_area_type:'service_storage',
    storage_location_label:'',
    storage_segregated:false
  };
  if(['packaging','kitchen_consumable','hygiene'].includes(type))return{
    storage_condition:'dry',
    storage_area_type:'service_storage',
    storage_location_label:'',
    storage_segregated:false
  };
  return{
    storage_condition:'other',
    storage_area_type:'other',
    storage_location_label:'',
    storage_segregated:false
  };
}

export function validateInventoryStorage({
  inventoryType='ingredient',
  storageCondition='other',
  storageAreaType='other',
  storageLocationLabel='',
  storageSegregated=false
}={}){
  const type=clean(inventoryType,40)||'ingredient';
  const condition=clean(storageCondition,30)||'other';
  const area=clean(storageAreaType,40)||'other';
  const label=clean(storageLocationLabel,120);
  const segregated=Boolean(storageSegregated);
  const errors=[];

  if(!STORAGE_CONDITIONS.includes(condition))errors.push('Choose a valid storage condition.');
  if(!STORAGE_AREA_TYPES.includes(area))errors.push('Choose a valid storage area.');

  if(type==='cleaning_sanitation'){
    if(FOOD_STORAGE_AREAS.has(area))errors.push('Cleaning & sanitation stock must be stored separately from food.');
    if(area==='chemical_storage'&&!segregated)errors.push('Chemical storage must be marked as segregated from food.');
    if(['service_storage','other'].includes(area)&&(!segregated||!label)){
      errors.push('Cleaning & sanitation stock needs an explicit segregated storage location.');
    }
  }

  if(FOOD_CONTACT_TYPES.has(type)&&area==='chemical_storage'){
    errors.push('Food, packaging and food-handling stock cannot be stored in chemical storage.');
  }

  if(area==='fridge'&&condition!=='chilled')errors.push('Fridge storage must use the Chilled condition.');
  if(area==='freezer'&&condition!=='frozen')errors.push('Freezer storage must use the Frozen condition.');
  if(condition==='chilled'&&!['fridge','other'].includes(area))errors.push('Chilled stock must be assigned to a fridge or a labelled custom cold-storage area.');
  if(condition==='frozen'&&!['freezer','other'].includes(area))errors.push('Frozen stock must be assigned to a freezer or a labelled custom frozen-storage area.');
  if(['chilled','frozen'].includes(condition)&&area==='other'&&!label)errors.push('Custom chilled or frozen storage needs a location label.');

  return{
    ok:errors.length===0,
    errors,
    storage_condition:STORAGE_CONDITIONS.includes(condition)?condition:'other',
    storage_area_type:STORAGE_AREA_TYPES.includes(area)?area:'other',
    storage_location_label:label,
    storage_segregated:segregated
  };
}

export function requireValidInventoryStorage(input={}){
  const result=validateInventoryStorage(input);
  if(!result.ok){
    const error=new Error(result.errors[0]||'Inventory storage settings are invalid.');
    error.status=409;
    error.code='INVENTORY_STORAGE_INVALID';
    error.storage_errors=result.errors;
    throw error;
  }
  return result;
}

export function inventoryStorageLabel(row={}){
  const area=clean(row.storage_area_type||'other',40).replaceAll('_',' ');
  const condition=clean(row.storage_condition||'other',30);
  const label=clean(row.storage_location_label,120);
  return [condition,area,label].filter(Boolean).join(' · ');
}
