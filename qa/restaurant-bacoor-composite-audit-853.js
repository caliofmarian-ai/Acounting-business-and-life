/**
 * #853 — single read-only reconciliation across Inventory, both private
 * product stores and the legacy recipe-batch/per-sale bridge.
 *
 * Caller MUST independently verify an authorized company-test Merchant,
 * exact business and isolated QA database, and provide rows read from one
 * consistent, scoped snapshot. This function proves none of those facts.
 * It never connects, seeds, authorizes a write or returns record IDs.
 */
import {buildRestaurantBacoorDryRunPlan} from './restaurant-bacoor-dry-run-853.js';
import {auditRestaurantBacoorInventorySnapshot} from './restaurant-bacoor-inventory-audit-853.js';
import {auditRestaurantBacoorProductSnapshots} from './restaurant-bacoor-product-audit-853.js';
import {auditRestaurantBacoorRecipeBatchSnapshots} from './restaurant-bacoor-recipe-audit-853.js';

function refuse(message){
  throw new TypeError('QA cross-store audit refused: '+message);
}

/**
 * Diagnostic only: all three stores empty, or every store fully consistent.
 * A partial restaurant MUST NOT be presented as an empty/restorable fixture.
 */
export function auditRestaurantBacoorCompleteSnapshots(fixture,{
  targetBusinessId,inventoryRows,recipeProducts,catalogProducts
}={}){
  if(!Array.isArray(inventoryRows)||!Array.isArray(recipeProducts)||
     !Array.isArray(catalogProducts)){
    refuse('all scoped Inventory, recipe-product and private catalog arrays required');
  }
  const plan=buildRestaurantBacoorDryRunPlan(fixture);
  const inventory=auditRestaurantBacoorInventorySnapshot(fixture,{
    targetBusinessId,rows:inventoryRows
  });
  const products=auditRestaurantBacoorProductSnapshots(plan,{
    targetBusinessId,recipeProducts,catalogProducts
  });
  const inventoryEmpty=inventory.status==='EMPTY_UNAPPROVED';
  const productsEmpty=products.status==='EMPTY_UNAPPROVED';
  if(inventoryEmpty&&productsEmpty){
    return {status:'ALL_STORES_EMPTY_UNAPPROVED',executable:false,
      inventory:0,recipeProducts:0,catalogProducts:0,recipeBatches:0,componentLinks:0,
      gate:'NO WRITES: separately authorize the isolated QA identity, business and locked seeder'};
  }
  if(inventoryEmpty||productsEmpty){
    refuse('partial restaurant: inventory and both product stores must agree');
  }
  const recipes=auditRestaurantBacoorRecipeBatchSnapshots(fixture,{
    targetBusinessId,inventoryRows,recipeProducts
  });
  if(recipes.status!=='EXACT_PRIVATE_RECIPE_BATCH_SNAPSHOTS_ONLY'||
     recipes.recipeBatches!==plan.recipeBatches.length||
     recipes.componentLinks!==fixture.recipes.reduce((n,recipe)=>n+recipe.ingredients.length,0)){
    refuse('incomplete recipe batches or ingredient links');
  }
  return {status:'EXACT_PRIVATE_CROSS_STORE_SNAPSHOTS_ONLY',executable:false,
    inventory:inventory.count,recipeProducts:products.recipeProducts,
    catalogProducts:products.catalogProducts,recipeBatches:recipes.recipeBatches,
    componentLinks:recipes.componentLinks,
    gate:'NO WRITES: source reads do not prove QA authorization, transaction consistency or seeding approval'};
}
