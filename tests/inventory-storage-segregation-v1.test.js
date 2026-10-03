import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const supplier=readFileSync(new URL('../server-supplier-commercial-v3.js',import.meta.url),'utf8');
const supplierDomain=readFileSync(new URL('../server-supplier-domain-v2.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/v03.css',import.meta.url),'utf8');

test('Inventory schema stores storage condition area location and segregation',()=>{
  assert.match(server,/storage_condition TEXT NOT NULL DEFAULT 'other'/);
  assert.match(server,/storage_area_type TEXT NOT NULL DEFAULT 'other'/);
  assert.match(server,/storage_location_label TEXT NOT NULL DEFAULT ''/);
  assert.match(server,/storage_segregated BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(server,/inventory_storage_condition_check/);
  assert.match(server,/inventory_storage_area_type_check/);
});

test('purchase and maintenance routes validate storage before saving',()=>{
  assert.match(server,/requireValidInventoryStorage\(/);
  assert.match(server,/app\.put\('\/api\/inventory\/:id\/storage'/);
  assert.match(server,/storage_condition=\$6/);
  assert.match(server,/storage_area_type=\$7/);
});

test('new purchase lots inherit a storage snapshot from the Inventory item',()=>{
  assert.match(server,/storage_condition_snapshot,storage_area_type_snapshot,storage_location_label_snapshot,storage_segregated_snapshot/);
  assert.match(server,/inventoryRow\.storage_condition/);
  assert.match(server,/inventoryRow\.storage_area_type/);
  assert.match(server,/inventoryRow\.storage_segregated/);
});

test('Supplier receiving validates linked Inventory storage and snapshots it on the canonical lot',()=>{
  assert.match(supplier,/requireValidInventoryStorage/);
  assert.match(supplier,/FROM inventory WHERE id=\$1 AND business_id=\$2/);
  assert.match(supplier,/storage\.storage_condition,storage\.storage_area_type,storage\.storage_location_label,storage\.storage_segregated/);
  assert.match(supplierDomain,/storage_condition_snapshot TEXT NOT NULL DEFAULT 'other'/);
  assert.match(supplierDomain,/storage_area_type_snapshot TEXT NOT NULL DEFAULT 'other'/);
});

test('Inventory lot API exposes receiving-time storage snapshot and current storage context',()=>{
  assert.match(server,/l\.storage_condition_snapshot/);
  assert.match(server,/l\.storage_area_type_snapshot/);
  assert.match(server,/current_storage_condition/);
  assert.match(server,/current_storage_area_type/);
});

test('mobile Inventory UI keeps storage details collapsible and provides a separate editor',()=>{
  assert.match(html,/id="stockStorageDetails"/);
  assert.match(html,/Storage & food safety/);
  assert.match(html,/id="storageForm"/);
  assert.match(html,/Chemical storage/);
  assert.match(html,/Segregated from food/);
  assert.match(css,/\.stockStorageDetails/);
});

test('category picker suggests storage and purchase payload sends storage facts',()=>{
  assert.match(ui,/storage:\{condition:'chilled',area:'fridge'/);
  assert.match(ui,/storage:\{condition:'ambient',area:'chemical_storage',label:'Chemical storage',segregated:true\}/);
  assert.match(ui,/storage_condition:\$\('stockStorageCondition'\)\.value/);
  assert.match(ui,/storage_area_type:\$\('stockStorageArea'\)\.value/);
  assert.match(ui,/storage_segregated:\$\('stockStorageSegregated'\)\.checked/);
});

test('UI shows storage context on both Inventory rows and lot rows',()=>{
  assert.match(ui,/storage \$\{esc\(condition\)\}/);
  assert.match(ui,/storage_condition_snapshot/);
  assert.match(ui,/storage_area_type_snapshot/);
  assert.match(ui,/storage_segregated_snapshot/);
});
