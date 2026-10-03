import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const costCore=readFileSync(new URL('../food-cost-core.js',import.meta.url),'utf8');
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const reservation=readFileSync(new URL('../order-stock-reservation.js',import.meta.url),'utf8');
const finance=readFileSync(new URL('../business-finance-view-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const financeUi=readFileSync(new URL('../public/business-accounting-ui.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('order consumption snapshots Inventory type for historical direct-cost reconciliation',()=>{
  assert.match(orders,/inventory_type_snapshot TEXT/);
  assert.match(orders,/ALTER TABLE order_stock_consumptions ADD COLUMN IF NOT EXISTS inventory_type_snapshot TEXT/);
  assert.match(reservation,/SELECT id,item,quantity,unit_cost,inventory_type FROM inventory/);
  assert.match(reservation,/INSERT INTO order_stock_consumptions\(order_id,inventory_id,item_name_snapshot,inventory_type_snapshot/);
  assert.match(reservation,/inv\.rows\[0\]\.inventory_type\|\|'ingredient'/);
});

test('prepared product estimates expose pickup and delivery direct food cost without rewriting ingredient cost history',()=>{
  assert.match(accounting,/directProductCostEstimate/);
  assert.match(accounting,/estimated_unit_cost:money\(unitCost\)/);
  assert.match(accounting,/estimated_direct_food_cost_pickup/);
  assert.match(accounting,/estimated_direct_food_cost_delivery/);
  assert.match(costCore,/direct_consumable_per_order/);
});

test('completed order profitability is reconciled from actual stock consumption evidence',()=>{
  assert.match(accounting,/completed_order_direct_cost/);
  assert.match(accounting,/LEFT JOIN order_stock_consumptions osc/);
  assert.match(accounting,/osc\.reversed_at IS NULL/);
  assert.match(accounting,/ingredient_cost/);
  assert.match(accounting,/direct_consumable_cost/);
  assert.match(accounting,/direct_food_cost/);
  assert.match(accounting,/excluded_overhead_cost/);
});

test('direct food cost excludes cleaning and operational supplies while including packaging kitchen consumables and hygiene',()=>{
  assert.match(accounting,/IN \('packaging','kitchen_consumable','hygiene'\)/);
  assert.match(accounting,/IN \('cleaning_sanitation','operational_supply'\)/);
});

test('Merchant finance exposes actual direct food cost separately from legacy estimated COGS',()=>{
  assert.match(finance,/actual_ingredient_consumption_cost/);
  assert.match(finance,/actual_direct_consumable_cost/);
  assert.match(finance,/actual_direct_food_cost/);
  assert.match(finance,/estimated_cogs:cogs/);
  assert.match(financeUi,/Direct food cost/);
  assert.match(financeUi,/Packaging \/ direct consumables/);
});

test('Menu UI clearly separates quick-sale ingredient history from completed-order direct cost',()=>{
  assert.match(html,/Product & order profitability/);
  assert.match(html,/Direct food cost = ingredients \+ configured packaging \/ direct consumables/);
  assert.match(ui,/Quick sale history/);
  assert.match(ui,/packaging\/direct consumables/);
  assert.match(ui,/Pickup direct cost/);
  assert.match(ui,/Delivery direct cost/);
});
