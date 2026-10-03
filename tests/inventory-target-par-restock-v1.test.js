import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveStockPurchase} from '../merchant-catalog-core.js';
import {reorderPackSuggestion} from '../supplier-sourcing-core.js';

const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const sourcing=readFileSync(new URL('../server-supplier-sourcing-v4.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('stock purchase normalizes Target Par level in the same measurement family',()=>{
  const p=deriveStockPurchase({
    purchase_quantity:1,purchase_unit:'kg',total_cost:80,
    reorder_quantity:300,reorder_unit:'g',
    target_quantity:2,target_unit:'kg'
  });
  assert.equal(p.reorder_base_quantity,300);
  assert.equal(p.target_base_quantity,2000);
});

test('Target Par cannot be below the low-stock alert',()=>{
  assert.throws(()=>deriveStockPurchase({
    purchase_quantity:1,purchase_unit:'kg',total_cost:80,
    reorder_quantity:3,reorder_unit:'kg',
    target_quantity:2,target_unit:'kg'
  }),/Target stock must be equal to or higher/);
  assert.throws(()=>reorderPackSuggestion({
    quantity:2,reorderLevel:3,targetLevel:2,inventoryUnit:'kg',
    baseUnitsPerPack:1,supplierBaseUnit:'kg',minimumPacks:1
  }),/targetLevel must be equal to or higher/);
});

test('reorder suggestion triggers on alert but replenishes to target',()=>{
  const suggestion=reorderPackSuggestion({
    quantity:2,reorderLevel:3,targetLevel:10,inventoryUnit:'kg',
    baseUnitsPerPack:1,supplierBaseUnit:'kg',minimumPacks:1
  });
  assert.equal(suggestion.status,'COMPARABLE');
  assert.equal(suggestion.suggested_packs,8);
  assert.equal(suggestion.target_deficit,8);
});

test('Inventory schema and APIs persist threshold and Target Par independently',()=>{
  assert.match(accounting,/target_level NUMERIC\(14,4\) NOT NULL DEFAULT 0/);
  assert.match(accounting,/target_level=CASE WHEN \$11>0 THEN \$11 ELSE target_level END/);
  assert.match(accounting,/app\.put\('\/api\/inventory\/:id\/reorder-settings'/);
  assert.match(accounting,/Restock target must be equal to or higher than the low-stock alert level/);
});

test('Supplier suggestions trigger from usable low stock and calculate toward effective target',()=>{
  assert.match(sourcing,/i\.reorder_level,i\.target_level/);
  assert.match(sourcing,/filter\(x=>Number\(x\.usable_quantity\)<=Number\(x\.reorder_level\)\)/);
  assert.match(sourcing,/effectiveTarget=Number\(x\.target_level\)>0\?Number\(x\.target_level\):Number\(x\.reorder_level\)/);
  assert.match(sourcing,/targetLevel:effectiveTarget/);
  assert.match(sourcing,/suggested_base_quantity/);
});

test('grouped restock request has one Supplier parent with multiple child lines and RFQs',()=>{
  assert.match(sourcing,/CREATE TABLE IF NOT EXISTS merchant_restock_requests/);
  assert.match(sourcing,/CREATE TABLE IF NOT EXISTS merchant_restock_request_items/);
  assert.match(sourcing,/app\.post\('\/api\/procurement\/restock-requests'/);
  assert.match(sourcing,/All items in one restock request must belong to the same preferred Supplier/);
  assert.match(sourcing,/for\(const item of normalized\)/);
  assert.match(sourcing,/INSERT INTO supplier_rfqs/);
  assert.match(sourcing,/INSERT INTO merchant_restock_request_items/);
  assert.match(sourcing,/commercial_effect:'sourcing_request_only_no_purchase_payment_or_receipt'/);
});

test('grouped restock endpoint never records purchase payment or receiving evidence',()=>{
  const start=sourcing.indexOf("app.post('/api/procurement/restock-requests'");
  const end=sourcing.indexOf("app.get('/api/procurement/restock-requests'",start);
  const block=sourcing.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(block,/INSERT INTO purchase_orders/);
  assert.doesNotMatch(block,/INSERT INTO order_payments/);
  assert.doesNotMatch(block,/INSERT INTO inventory_purchases/);
  assert.doesNotMatch(block,/UPDATE inventory SET quantity/);
});

test('Merchant UI supports Target Par editing and Supplier-group review',()=>{
  assert.match(html,/id="stockTargetQty"/);
  assert.match(html,/id="restockSettingsForm"/);
  assert.match(html,/Restock up to/);
  assert.match(ui,/function fillRestockSettingsEditor/);
  assert.match(ui,/function restockSupplierGroup/);
  assert.match(ui,/data-restock-inventory/);
  assert.match(ui,/\/api\/procurement\/restock-requests/);
  assert.match(ui,/Prepare Supplier request/);
  assert.match(html,/One grouped Supplier request can contain several items/);
});
