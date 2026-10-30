import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {computeRecipeBatch} from '../merchant-catalog-core.js';
import {buildRestaurantBacoorDryRunPlan} from '../qa/restaurant-bacoor-dry-run-853.js';
import {auditRestaurantBacoorRecipeBatchSnapshots as audit} from '../qa/restaurant-bacoor-recipe-audit-853.js';

// Synthetic read projections, never a QA/Production DB connection or seed.
const fixture=JSON.parse(readFileSync(
  new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url),'utf8'));
const plan=buildRestaurantBacoorDryRunPlan(fixture),B='987654321';
const family={g:'mass',ml:'volume',unit:'count'};
function snapshot(){
  const inventoryRows=plan.inventory.map((entry,i)=>{
    const x=entry.bodyTemplate;
    return {id:String(1001+i),business_id:B,item:x.item,unit:x.unit,base_unit:x.unit,
      measurement_family:family[x.unit],inventory_type:'ingredient',
      quantity:String(x.quantity),reorder_level:String(x.reorder_level),
      target_level:String(x.target_level),unit_cost:String(x.unit_cost)};
  });
  const stock=new Map(inventoryRows.map(row=>[row.item,row]));
  const recipeProducts=fixture.recipes.map((recipe,i)=>{
    const components=recipe.ingredients.map(part=>{
      const ingredient=fixture.inventory.find(x=>x.code===part.ingredientCode);
      return {inventory_id:Number(stock.get(ingredient.name).id),quantity:part.quantity,unit:part.unit};
    });
    const computed=computeRecipeBatch({
      yield_quantity:recipe.yieldServings,yield_unit:'unit',
      selling_quantity:1,selling_unit:'unit',components,inventory:inventoryRows
    });
    const byId=new Map(inventoryRows.map(row=>[Number(row.id),row]));
    return {id:String(2001+i),business_id:B,...plan.recipeProducts[i].bodyTemplate,
      recipe_batch:{
        yield_quantity:String(computed.yield_quantity),yield_unit:computed.yield_unit,
        yield_base_quantity:String(computed.yield_base_quantity),
        yield_base_unit:computed.yield_base_unit,
        selling_quantity:String(computed.selling_quantity),selling_unit:computed.selling_unit,
        selling_base_quantity:String(computed.selling_base_quantity),
        sale_units_per_batch:String(computed.sale_units_per_batch)
      },
      recipe_batch_components:computed.components.map(c=>{
        const inv=byId.get(c.inventory_id);
        return {inventory_id:String(c.inventory_id),item:inv.item,unit:inv.unit,
          batch_quantity:String(c.batch_quantity),batch_unit:c.batch_unit,
          base_quantity:String(c.base_quantity),base_unit:c.base_unit,
          per_sale_quantity:String(c.per_sale_quantity),
          percentage:c.percentage===null?null:String(c.percentage),
          unit_cost:String(inv.unit_cost),
          batch_cost:c.base_quantity*Number(inv.unit_cost)};
      }),
      recipe:computed.components.map(c=>{
        const inv=byId.get(c.inventory_id);
        return {inventory_id:String(c.inventory_id),item:inv.item,unit:inv.unit,
          quantity:String(c.per_sale_quantity)};
      })
    };
  });
  return {targetBusinessId:B,inventoryRows,recipeProducts};
}
const run=x=>audit(fixture,x);
function rejected(change){
  const data=snapshot();change(data);
  assert.throws(()=>run(data),/QA (recipe batch|inventory) audit refused/);
}
test('10 canonical batches, real per-sale bridge and all ingredient links are read-only',()=>{
  const a=snapshot(),before=structuredClone(a),result=run(a);
  assert.equal(result.status,'EXACT_PRIVATE_RECIPE_BATCH_SNAPSHOTS_ONLY');
  assert.equal(result.executable,false);
  assert.equal(result.recipeBatches,10);
  assert.equal(result.componentLinks,fixture.recipes.reduce((n,x)=>n+x.ingredients.length,0));
  assert.match(result.gate,/NO WRITES/);
  assert.doesNotMatch(JSON.stringify(result),/"inventory_id"|"business_id"|"product_id"/);
  assert.deepEqual(a,before);
  assert.deepEqual(run({...a,inventoryRows:[...a.inventoryRows].reverse(),
    recipeProducts:[...a.recipeProducts].reverse()}),result);
});
test('empty product projection remains blocked, not permission to create or replace batches',()=>{
  const x=snapshot();x.recipeProducts=[];
  const result=run(x);
  assert.equal(result.status,'EMPTY_UNAPPROVED');
  assert.equal(result.executable,false);
  assert.match(result.gate,/NO WRITES/);
});
test('partial products, tenant swaps and product identity drift fail closed',()=>{
  rejected(x=>{x.recipeProducts.pop();});
  rejected(x=>{x.recipeProducts.push(structuredClone(x.recipeProducts[0]));});
  rejected(x=>{x.recipeProducts[0].business_id='2';});
  rejected(x=>{x.recipeProducts[0].id=x.recipeProducts[1].id;});
  rejected(x=>{x.recipeProducts[0].name='Unrelated business dish';});
  rejected(x=>{x.recipeProducts[0].active=true;});
  rejected(x=>{x.recipeProducts[0].selling_price='0';});
  rejected(x=>{x.recipeProducts[0].product_kind='fresh_direct';});
  rejected(x=>{delete x.targetBusinessId;});
});
test('persisted batch yield, sales conversion and units must match canonical recipe',()=>{
  rejected(x=>{x.recipeProducts[0].recipe_batch=null;});
  rejected(x=>{x.recipeProducts[0].recipe_batch.yield_quantity='3';});
  rejected(x=>{x.recipeProducts[0].recipe_batch.selling_unit='g';});
  rejected(x=>{x.recipeProducts[0].recipe_batch.sale_units_per_batch='5';});
  rejected(x=>{delete x.recipeProducts[0].recipe_batch.selling_base_quantity;});
});
test('persisted component quantities, costs and links cannot silently drift',()=>{
  rejected(x=>{x.recipeProducts[0].recipe_batch_components.pop();});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].inventory_id='999999';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].inventory_id=
    x.recipeProducts[0].recipe_batch_components[1].inventory_id;});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].batch_quantity='1.9';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].unit_cost='0';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].batch_cost='0';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].item='Other item';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].base_unit='mlzzz';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].percentage='1.5';});
});
test('the legacy per-sale recipe stock bridge must match every batch component',()=>{
  rejected(x=>{x.recipeProducts[0].recipe=[];});
  rejected(x=>{x.recipeProducts[0].recipe[0].quantity='0.000001';});
  rejected(x=>{x.recipeProducts[0].recipe[0].inventory_id='99999';});
  rejected(x=>{x.recipeProducts[0].recipe[0].inventory_id=
    x.recipeProducts[0].recipe[1].inventory_id;});
  rejected(x=>{x.recipeProducts[0].recipe[0].item='Wrong ingredient';});
});
test('Inventory cost/stock drift, missing scoped IDs and malformed DB decimals are rejected',()=>{
  rejected(x=>{x.inventoryRows[0].unit_cost='999.0';});
  rejected(x=>{x.inventoryRows[0].quantity='0';});
  rejected(x=>{x.inventoryRows[0].business_id='1';});
  rejected(x=>{x.inventoryRows[0].id=x.inventoryRows[1].id;});
  rejected(x=>{x.recipeProducts[0].recipe[0].quantity='NaN';});
  rejected(x=>{x.recipeProducts[0].recipe_batch_components[0].base_quantity='1e6';});
});

import {auditRestaurantBacoorCompleteSnapshots as auditAll}
  from '../qa/restaurant-bacoor-composite-audit-853.js';

function completeSnapshot(){
  const data=snapshot();
  data.catalogProducts=plan.privateCatalog.map((entry,i)=>({
    id:String(3001+i),business_id:B,...entry.bodyTemplate,
    active:true,inventory_id:null,stock_tracked:false,stock_quantity:null
  }));
  return data;
}
test('cross-store diagnostic accepts only complete private 37+10+10 and 10 linked batches',()=>{
  const data=completeSnapshot(),original=structuredClone(data);
  const got=auditAll(fixture,data);
  assert.equal(got.status,'EXACT_PRIVATE_CROSS_STORE_SNAPSHOTS_ONLY');
  assert.equal(got.executable,false);
  assert.deepEqual([got.inventory,got.recipeProducts,got.catalogProducts,
    got.recipeBatches,got.componentLinks],[37,10,10,10,97]);
  assert.match(got.gate,/NO WRITES/);
  assert.doesNotMatch(JSON.stringify(got),/"business_id"|"inventory_id"|"product_id"|"accountId"/);
  assert.deepEqual(data,original);
  assert.deepEqual(auditAll(fixture,{...data,
    inventoryRows:[...data.inventoryRows].reverse(),
    recipeProducts:[...data.recipeProducts].reverse(),
    catalogProducts:[...data.catalogProducts].reverse()}),got);
});
test('all three stores empty means unapproved, not permission to provision',()=>{
  const data=completeSnapshot();
  data.inventoryRows=[];data.recipeProducts=[];data.catalogProducts=[];
  const got=auditAll(fixture,data);
  assert.equal(got.status,'ALL_STORES_EMPTY_UNAPPROVED');
  assert.equal(got.executable,false);
  assert.match(got.gate,/NO WRITES/);
});
test('partial or drifted stores cannot masquerade as an empty QA restaurant',()=>{
  const cases=[
    x=>{x.inventoryRows=[];},
    x=>{x.recipeProducts=[];x.catalogProducts=[];},
    x=>{x.recipeProducts=[];},
    x=>{x.catalogProducts=[];},
    x=>{x.catalogProducts.pop();},
    x=>{x.inventoryRows[0].quantity='0';},
    x=>{x.catalogProducts[0].published=true;},
    x=>{x.catalogProducts[0].business_id='99';},
    x=>{x.recipeProducts[0].recipe_batch_components[0].batch_quantity='999';},
    x=>{delete x.targetBusinessId;},
    x=>{delete x.catalogProducts;}
  ];
  for(const change of cases){
    const data=completeSnapshot();change(data);
    assert.throws(()=>auditAll(fixture,data),/QA (cross-store|inventory|product|recipe batch) audit refused/);
  }
});
