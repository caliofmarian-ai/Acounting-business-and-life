/**
 * #853 — diagnostic ONLY for the legacy recipe batch + per-sale bridge.
 *
 * Read business-scoped Inventory and productsWithRecipes snapshots from an
 * independently authorized isolated QA session. This does no SQL/HTTP and
 * never authorizes seeding, replays, production changes or stock resets.
 */
import {computeRecipeBatch} from '../merchant-catalog-core.js';
import {buildRestaurantBacoorDryRunPlan} from './restaurant-bacoor-dry-run-853.js';
import {auditRestaurantBacoorInventorySnapshot} from './restaurant-bacoor-inventory-audit-853.js';

const refuse=reason=>{throw new TypeError('QA recipe batch audit refused: '+reason);};
function positiveId(raw,label){
  const text=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):
    typeof raw==='string'&&/^[1-9][0-9]*$/.test(raw)?raw:'';
  const id=Number(text);
  if(!text||!Number.isSafeInteger(id)||id<1)refuse('invalid '+label);
  return id;
}
function decimal(raw,label){
  if(typeof raw==='number'&&Number.isFinite(raw)&&raw>=0)return raw;
  if(typeof raw==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(raw)){
    const value=Number(raw);
    if(Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.trunc(value)))return value;
  }
  refuse('invalid '+label);
}
function sameNumber(actual,expected,label){
  const n=decimal(actual,label);
  // DB numeric columns have at most six decimals; avoid double-precision noise,
  // but a genuine 0.000001 quantity/cost change must not pass.
  if(Math.abs(n-expected)>0.00000051)refuse('quantity/cost drift: '+label);
}
function validRow(row,label){
  if(!row||typeof row!=='object'||Array.isArray(row))refuse('invalid '+label);
}
function sameId(actual,expected,label){
  if(positiveId(actual,label)!==expected)refuse('foreign or mismatched '+label);
}
function optionalId(actual,expected,label){
  if(actual!==undefined)sameId(actual,expected,label);
}
function batchFieldsMatch(row,expected,label){
  validRow(row,label);
  for(const key of ['yield_quantity','yield_base_quantity','selling_quantity',
    'selling_base_quantity','sale_units_per_batch']){
    sameNumber(row[key],expected[key],label+' '+key);
  }
  for(const key of ['yield_unit','yield_base_unit','selling_unit']){
    if(row[key]!==expected[key])refuse('batch unit drift: '+label+' '+key);
  }
}
function componentRowsMatch(rows,expected,inventoryById,productId,label){
  if(!Array.isArray(rows)||rows.length!==expected.length)
    refuse('partial or extra recipe batch components: '+label);
  const byId=new Map(expected.map(c=>[c.inventory_id,c]));
  const seen=new Set();
  for(const row of rows){
    validRow(row,label+' component');
    const id=positiveId(row.inventory_id,label+' ingredient link');
    if(!byId.has(id)||seen.has(id))refuse('missing, duplicate or foreign recipe ingredient: '+label);
    seen.add(id);
    optionalId(row.product_id,productId,label+' component product');
    const want=byId.get(id),item=inventoryById.get(id);
    if(!item)refuse('unscoped ingredient: '+label);
    for(const key of ['batch_quantity','base_quantity','per_sale_quantity']){
      sameNumber(row[key],want[key],label+' '+id+' '+key);
    }
    for(const key of ['batch_unit','base_unit']){
      if(row[key]!==want[key])refuse('ingredient unit drift: '+label+' '+id+' '+key);
    }
    if(row.item!==item.item||row.unit!==item.unit)
      refuse('ingredient identity drift: '+label+' '+id);
    sameNumber(row.unit_cost,decimal(item.unit_cost,'stock unit cost'),
      label+' '+id+' unit_cost');
    // productsWithRecipes computes this from the persisted base quantity.
    sameNumber(row.batch_cost,want.base_quantity*decimal(item.unit_cost,'stock unit cost'),
      label+' '+id+' batch_cost');
    if(want.percentage===null){
      if(row.percentage!==null)refuse('invalid percentage: '+label+' '+id);
    }else sameNumber(row.percentage,want.percentage,label+' '+id+' percentage');
  }
}
function legacyPerSaleMatches(rows,expected,inventoryById,productId,label){
  if(!Array.isArray(rows)||rows.length!==expected.length)
    refuse('partial or extra legacy recipe bridge: '+label);
  const byId=new Map(expected.map(c=>[c.inventory_id,c]));
  const seen=new Set();
  for(const row of rows){
    validRow(row,label+' legacy component');
    const id=positiveId(row.inventory_id,label+' legacy ingredient link');
    if(!byId.has(id)||seen.has(id))refuse('missing, duplicate or foreign legacy recipe link: '+label);
    seen.add(id);
    optionalId(row.product_id,productId,label+' legacy product');
    const inventory=inventoryById.get(id);
    if(row.item!==inventory.item||row.unit!==inventory.unit)
      refuse('legacy ingredient identity drift: '+label+' '+id);
    sameNumber(row.quantity,byId.get(id).per_sale_quantity,label+' '+id+' legacy quantity');
  }
}
/**
 * Accepts the exact shape returned by the existing productsWithRecipes()
 * read projection, plus all 37 scoped Inventory rows. IDs are READ inputs,
 * not synthesized or returned to callers. No result grants seed permission.
 */
export function auditRestaurantBacoorRecipeBatchSnapshots(fixture,{
  targetBusinessId,inventoryRows,recipeProducts
}={}){
  const plan=buildRestaurantBacoorDryRunPlan(fixture);
  const businessId=positiveId(targetBusinessId,'business ID');
  auditRestaurantBacoorInventorySnapshot(fixture,{targetBusinessId,rows:inventoryRows});
  if(!Array.isArray(recipeProducts))refuse('business-scoped recipe products required');
  if(recipeProducts.length===0)return{
    status:'EMPTY_UNAPPROVED',executable:false,recipeBatches:0,componentLinks:0,
    gate:'NO WRITES: approve isolated QA source, scoped identities and locked transaction'
  };
  if(recipeProducts.length!==plan.recipeBatches.length)
    refuse('partial or extra recipe products');
  const byInventoryName=new Map(inventoryRows.map(row=>[row.item,row]));
  const inventoryById=new Map();
  for(const row of inventoryRows)inventoryById.set(positiveId(row.id,'inventory row ID'),row);
  const expectedByName=new Map(fixture.recipes.map((r,i)=>[r.name,{
    recipe:r,template:plan.recipeProducts[i].bodyTemplate
  }]));
  const seenNames=new Set(),seenProductIds=new Set();
  let links=0;
  for(const row of recipeProducts){
    validRow(row,'recipe product');
    sameId(row.business_id,businessId,'recipe business');
    const id=positiveId(row.id,'recipe product ID');
    if(seenProductIds.has(id))refuse('duplicate recipe product ID');
    seenProductIds.add(id);
    const expected=expectedByName.get(row.name);
    if(!expected||seenNames.has(row.name))refuse('unknown or duplicate recipe product');
    seenNames.add(row.name);
    const {recipe,template}=expected;
    if(row.category!==template.category||row.product_kind!=='prepared_recipe'||
      row.active!==false)refuse('recipe product identity/state drift: '+row.name);
    sameNumber(row.selling_price,template.selling_price,row.name+' selling_price');
    const ingredients=recipe.ingredients.map(part=>{
      const item=byInventoryName.get(fixture.inventory.find(v=>v.code===part.ingredientCode)?.name);
      if(!item)refuse('missing scoped stock for '+part.ingredientCode);
      return {inventory_id:positiveId(item.id,'ingredient ID'),quantity:part.quantity,unit:part.unit};
    });
    const computed=computeRecipeBatch({
      yield_quantity:recipe.yieldServings,yield_unit:'unit',
      selling_quantity:1,selling_unit:'unit',components:ingredients,inventory:inventoryRows
    });
    batchFieldsMatch(row.recipe_batch,computed,row.name);
    componentRowsMatch(row.recipe_batch_components,computed.components,inventoryById,id,row.name);
    legacyPerSaleMatches(row.recipe,computed.components,inventoryById,id,row.name);
    links+=computed.components.length;
  }
  if(seenNames.size!==expectedByName.size)refuse('missing recipe product');
  return{
    status:'EXACT_PRIVATE_RECIPE_BATCH_SNAPSHOTS_ONLY',executable:false,
    recipeBatches:seenNames.size,componentLinks:links,
    gate:'NO WRITES: repeat under reviewed isolated-QA lock and independently verify catalog identity'
  };
}
