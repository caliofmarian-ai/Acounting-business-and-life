import test from 'node:test';
import assert from 'node:assert/strict';
import {directFoodCostRole,directConsumableRuleCost,directProductCostEstimate,summarizeOrderConsumptionCosts} from '../food-cost-core.js';

test('direct food cost classifies ingredients and configured direct consumables separately from overhead',()=>{
  assert.equal(directFoodCostRole('ingredient'),'ingredient');
  assert.equal(directFoodCostRole('packaging'),'direct_consumable');
  assert.equal(directFoodCostRole('kitchen_consumable'),'direct_consumable');
  assert.equal(directFoodCostRole('hygiene'),'direct_consumable');
  assert.equal(directFoodCostRole('cleaning_sanitation'),'overhead_or_indirect');
  assert.equal(directFoodCostRole('operational_supply'),'overhead_or_indirect');
});

test('pickup and delivery rules can produce different direct consumable costs',()=>{
  const rules=[
    {inventory_type:'packaging',fulfilment_scope:'all',usage_basis:'per_item',quantity_used:1,unit_cost:2},
    {inventory_type:'packaging',fulfilment_scope:'delivery',usage_basis:'per_item',quantity_used:1,unit_cost:3},
    {inventory_type:'kitchen_consumable',fulfilment_scope:'pickup',usage_basis:'per_order',quantity_used:2,unit_cost:1.5}
  ];
  const pickup=directConsumableRuleCost(rules,'pickup');
  const delivery=directConsumableRuleCost(rules,'delivery');
  assert.equal(pickup.direct_consumable_per_item,2);
  assert.equal(pickup.direct_consumable_per_order,3);
  assert.equal(delivery.direct_consumable_per_item,5);
  assert.equal(delivery.direct_consumable_per_order,0);
});

test('cleaning and general operational supplies never enter direct food cost even when a rule exists',()=>{
  const cost=directConsumableRuleCost([
    {inventory_type:'cleaning_sanitation',fulfilment_scope:'all',usage_basis:'per_order',quantity_used:1,unit_cost:10},
    {inventory_type:'operational_supply',fulfilment_scope:'all',usage_basis:'per_item',quantity_used:1,unit_cost:4},
    {inventory_type:'packaging',fulfilment_scope:'all',usage_basis:'per_item',quantity_used:1,unit_cost:2}
  ],'delivery');
  assert.equal(cost.direct_consumable_per_item,2);
  assert.equal(cost.direct_consumable_per_order,0);
  assert.equal(cost.excluded_overhead_rule_cost,14);
});

test('product estimate keeps ingredient cost visible and adds fulfilment-specific direct cost',()=>{
  const estimate=directProductCostEstimate({
    ingredientCost:58.49,
    rules:[
      {inventory_type:'packaging',fulfilment_scope:'pickup',usage_basis:'per_item',quantity_used:1,unit_cost:5},
      {inventory_type:'packaging',fulfilment_scope:'delivery',usage_basis:'per_item',quantity_used:1,unit_cost:9}
    ]
  });
  assert.equal(estimate.ingredient_cost_per_item,58.49);
  assert.equal(estimate.pickup.direct_food_cost_per_item,63.49);
  assert.equal(estimate.delivery.direct_food_cost_per_item,67.49);
});

test('actual order consumption summary reconciles ingredients plus direct consumables and excludes overhead',()=>{
  const summary=summarizeOrderConsumptionCosts([
    {inventory_type_snapshot:'ingredient',cost_snapshot:100},
    {inventory_type_snapshot:'packaging',cost_snapshot:20},
    {inventory_type_snapshot:'hygiene',cost_snapshot:5},
    {inventory_type_snapshot:'cleaning_sanitation',cost_snapshot:7}
  ]);
  assert.deepEqual(summary,{
    ingredient_cost:100,
    direct_consumable_cost:25,
    direct_food_cost:125,
    excluded_overhead_cost:7
  });
});
