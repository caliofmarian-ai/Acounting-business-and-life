/**
 * #853 — two-store, read-only product snapshot reconciliation for isolated QA.
 * This accepts a plan previously produced by buildRestaurantBacoorDryRunPlan.
 * It does NOT query a database, establish authorization or authorize writes.
 */
function refuse(reason){throw new TypeError('QA product audit refused: '+reason);}
function identity(value,label){
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
  if(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value))return value;
  refuse('invalid '+label);
}
function numeric(value,label){
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;
  if(typeof value==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)){
    const parsed=Number(value);
    if(Number.isFinite(parsed)&&Number.isSafeInteger(Math.trunc(parsed)))return parsed;
  }
  refuse('invalid '+label);
}
const normalizedName=name=>typeof name==='string'?name.trim().toLocaleLowerCase('en-PH'):'';
function auditStore(rows,expected,kind,business){
  if(rows.length!==expected.length)refuse(kind+' partial or extra rows');
  const seenIds=new Set(),seenNames=new Set();
  const byName=new Map(expected.map(entry=>[normalizedName(entry.bodyTemplate.name),entry.bodyTemplate]));
  if(byName.size!==expected.length)refuse(kind+' duplicate expected names');
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))refuse(kind+' malformed row');
    if(identity(row.business_id,kind+' row business')!==business)refuse(kind+' foreign business');
    const id=identity(row.id,kind+' row ID');
    if(seenIds.has(id))refuse(kind+' duplicate ID');
    seenIds.add(id);
    const name=normalizedName(row.name),target=byName.get(name);
    if(!name||!target)refuse(kind+' unknown name');
    if(seenNames.has(name))refuse(kind+' duplicate name');
    seenNames.add(name);
    if(row.name!==target.name||row.category!==target.category||
       row.product_kind!==target.product_kind||
       numeric(row.selling_price,kind+' price')!==target.selling_price){
      refuse(kind+' identity/category/price drift: '+name);
    }
    if(kind==='recipe'){
      if(row.active!==false)refuse('recipe product became active: '+name);
    }else{
      if(row.description!==target.description||
         row.published!==false||row.active!==true||
         row.price_comparison_override!==false||
         row.unit_code!==target.unit_code||
         numeric(row.quantity_per_unit,'catalog quantity per unit')!==target.quantity_per_unit||
         row.inventory_id!=null||row.stock_tracked!==false||row.stock_quantity!=null){
        refuse('catalog visibility or product drift: '+name);
      }
    }
  }
  if(seenNames.size!==byName.size)refuse(kind+' missing rows');
}
/**
 * Diagnostic ONLY. The snapshot must be separately obtained from an authorized,
 * isolated, business-scoped read. Do not use this result as a seed permission:
 * locks, account/business provenance and separate approval are still required.
 */
export function auditRestaurantBacoorProductSnapshots(plan,{targetBusinessId,recipeProducts,catalogProducts}={}){
  if(!plan||plan.mode!=='DRY_RUN_ONLY'||plan.executable!==false||
     plan.sourceOnly!==true||plan.fixtureKey!=='qa-ph-restaurant-bacoor'||
     !/^[a-f0-9]{64}$/.test(plan.manifestSha256||'')||
     plan.target?.businessId!==null||plan.target?.accountId!==null||
     !Array.isArray(plan.recipeProducts)||plan.recipeProducts.length!==10||
     !Array.isArray(plan.privateCatalog)||plan.privateCatalog.length!==10){
    refuse('validated 10+10 non-executable V1 plan required');
  }
  const business=identity(targetBusinessId,'business ID');
  if(!Array.isArray(recipeProducts)||!Array.isArray(catalogProducts))
    refuse('both business-scoped product snapshots required');
  if(recipeProducts.length===0&&catalogProducts.length===0){
    return {status:'EMPTY_UNAPPROVED',executable:false,recipeProducts:0,catalogProducts:0,
      gate:'NO WRITES: separately verify isolated QA authority and lock both stores'};
  }
  // Never accept one populated store and one empty/partial store as a safe replay.
  auditStore(recipeProducts,plan.recipeProducts,'recipe',business);
  auditStore(catalogProducts,plan.privateCatalog,'catalog',business);
  return {status:'EXACT_PRIVATE_PRODUCT_SNAPSHOTS_ONLY',executable:false,
    recipeProducts:10,catalogProducts:10,
    gate:'NO WRITES: repeat checks under reviewed isolated-QA transaction and verify recipe batch links'};
}
