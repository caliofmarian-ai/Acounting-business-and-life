import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const runtime=readFileSync(new URL('../inventory-lot-runtime.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const sourcing=readFileSync(new URL('../server-supplier-sourcing-v4.js',import.meta.url),'utf8');
const today=readFileSync(new URL('../merchant-today-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('canonical availability separates physical usable blocked tracked and untracked quantities',()=>{
  assert.match(runtime,/physical_quantity/);
  assert.match(runtime,/tracked_quantity/);
  assert.match(runtime,/untracked_quantity/);
  assert.match(runtime,/usable_tracked_quantity/);
  assert.match(runtime,/usable_quantity/);
  assert.match(runtime,/blocked_quantity/);
  assert.match(runtime,/expires_at IS NULL OR expires_at>NOW\(\)/);
  assert.match(runtime,/lot_state','available'/);
});

test('Inventory API and legacy summary use usable stock for low-stock status',()=>{
  assert.match(accounting,/inventoryAvailabilityRows\(pool,\{businessId:business\.id\}\)/);
  assert.match(accounting,/usable_quantity\)<=Number\(a\.reorder_level\)/);
  assert.match(accounting,/availability\.filter\(x=>Number\(x\.usable_quantity\)<=Number\(x\.reorder_level\)\)/);
});

test('Supplier restock suggestions use usable rather than aggregate physical quantity',()=>{
  assert.match(sourcing,/inventoryAvailabilityRows\(pool,\{businessId:bid\}\)/);
  assert.match(sourcing,/usable_quantity:Number/);
  assert.match(sourcing,/filter\(x=>Number\(x\.usable_quantity\)<=Number\(x\.reorder_level\)\)/);
  assert.match(sourcing,/quantity:Number\(x\.usable_quantity\),reorderLevel:Number\(x\.reorder_level\)/);
});

test('Merchant Today low-stock attention is derived from usable quantity',()=>{
  assert.match(today,/inventoryAvailabilityRows\(pool,\{businessId:bid\}\)/);
  assert.match(today,/filter\(x=>Number\(x\.usable_quantity\)<=Number\(x\.reorder_level\)\)/);
  assert.match(today,/out_of_stock:lowRows\.filter\(x=>Number\(x\.usable_quantity\)<=0\)/);
});

test('Inventory and restock UI explain physical versus usable stock when blocked quantity exists',()=>{
  assert.match(ui,/usable .*physical .*blocked/s);
  assert.match(ui,/usable_quantity\?\?i\.quantity/);
  assert.match(ui,/physical_quantity\?\?i\.quantity/);
  assert.match(ui,/blocked_quantity/);
  assert.match(ui,/function restockNeedLabel/);
});
