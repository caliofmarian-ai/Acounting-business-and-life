import test from 'node:test';
import assert from 'node:assert/strict';
import {
  measurementUnit,toBaseQuantity,deriveStockPurchase,weightedAverageUnitCost,
  computeRecipeBatch,normalizedProductKind,marketplaceKindForProductKind
} from '../merchant-catalog-core.js';

test('kg/g and L/ml normalize deterministically',()=>{
  assert.deepEqual(toBaseQuantity(1,'kg'),{family:'mass',entered_unit:'kg',base_unit:'g',entered_quantity:1,base_quantity:1000});
  assert.deepEqual(toBaseQuantity(1,'L'),{family:'volume',entered_unit:'L',base_unit:'ml',entered_quantity:1,base_quantity:1000});
  assert.equal(measurementUnit('pcs').base_unit,'unit');
  assert.throws(()=>toBaseQuantity(1,'cup'),/supported unit/i);
});

test('stock purchase derives the unit cost instead of asking Merchant to calculate it',()=>{
  const p=deriveStockPurchase({
    purchase_quantity:1,purchase_unit:'kg',total_cost:80,
    reorder_quantity:250,reorder_unit:'g'
  });
  assert.equal(p.base_quantity,1000);
  assert.equal(p.base_unit,'g');
  assert.equal(p.base_unit_cost,0.08);
  assert.equal(p.reorder_base_quantity,250);
  assert.equal(weightedAverageUnitCost({
    existing_quantity:1000,existing_unit_cost:0.08,
    purchased_base_quantity:1000,purchase_total_cost:100
  }),0.09);
});

test('fish-soup batch compiles into per-sale recipe quantities and costs',()=>{
  const inventory=[
    {id:1,item:'Water',unit:'ml',base_unit:'ml',measurement_family:'volume',unit_cost:0.005},
    {id:2,item:'Fish',unit:'g',base_unit:'g',measurement_family:'mass',unit_cost:0.18},
    {id:3,item:'Carrot',unit:'g',base_unit:'g',measurement_family:'mass',unit_cost:0.08},
    {id:4,item:'Parsley',unit:'g',base_unit:'g',measurement_family:'mass',unit_cost:0.3}
  ];
  const batch=computeRecipeBatch({
    yield_quantity:1,yield_unit:'L',
    selling_quantity:250,selling_unit:'ml',
    components:[
      {inventory_id:1,quantity:800,unit:'ml'},
      {inventory_id:2,quantity:250,unit:'g'},
      {inventory_id:3,quantity:100,unit:'g'},
      {inventory_id:4,quantity:10,unit:'g'}
    ],
    inventory
  });
  assert.equal(batch.sale_units_per_batch,4);
  assert.equal(batch.components.find(x=>x.inventory_id===1).per_sale_quantity,200);
  assert.equal(batch.components.find(x=>x.inventory_id===2).per_sale_quantity,62.5);
  assert.equal(batch.components.find(x=>x.inventory_id===1).percentage,80);
  assert.equal(batch.components.find(x=>x.inventory_id===2).percentage,null);
  assert.equal(batch.batch_cost,60);
  assert.equal(batch.cost_per_sale_unit,15);
});

test('recipe batch rejects incompatible yield/sale measurements and ingredient families',()=>{
  assert.throws(()=>computeRecipeBatch({
    yield_quantity:1,yield_unit:'L',selling_quantity:250,selling_unit:'g',
    components:[{inventory_id:1,quantity:1,unit:'g'}],
    inventory:[{id:1,item:'x',unit:'g',measurement_family:'mass',base_unit:'g',unit_cost:1}]
  }),/compatible units/i);
  assert.throws(()=>computeRecipeBatch({
    yield_quantity:1,yield_unit:'unit',selling_quantity:1,selling_unit:'unit',
    components:[{inventory_id:1,quantity:100,unit:'ml'}],
    inventory:[{id:1,item:'Carrot',unit:'g',measurement_family:'mass',base_unit:'g',unit_cost:1}]
  }),/different measurement family/i);
});

test('catalog product kinds keep recipe and resale behavior explicit',()=>{
  assert.equal(normalizedProductKind('prepared_recipe','food'),'prepared_recipe');
  assert.equal(normalizedProductKind('bad','non_food'),'non_food_resale');
  assert.equal(marketplaceKindForProductKind('fresh_direct'),'fresh_direct');
  assert.equal(marketplaceKindForProductKind('packaged_resale'),'packaged_resale');
});
