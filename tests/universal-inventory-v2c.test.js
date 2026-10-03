import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  STORAGE_AREA_TYPES,
  inventoryStorageDefaults,
  validateInventoryStorage
} from '../inventory-storage-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('server-business-accounting.js');
const locations=read('inventory-locations.js');
const ui=read('public/v03.js');
const html=read('public/index.html');
const css=read('public/v03.css');
const pkg=read('package.json');

test('Retail and operations storage areas extend Food storage without removing existing choices',()=>{
  for(const area of ['pantry','fridge','freezer','prep_station','chemical_storage','service_storage'])assert.ok(STORAGE_AREA_TYPES.includes(area),area);
  for(const area of ['sales_floor','stock_room','shelf_bin','warehouse','secure_storage','returns_inspection','general_supply'])assert.ok(STORAGE_AREA_TYPES.includes(area),area);
});

test('Retail defaults use retail storage rather than Pantry or Fridge',()=>{
  const resale=inventoryStorageDefaults({
    inventoryType:'resale_item',inventoryDomain:'non_food',stockRole:'direct_resale'
  });
  assert.equal(resale.storage_condition,'dry');
  assert.equal(resale.storage_area_type,'stock_room');

  const material=inventoryStorageDefaults({
    inventoryType:'production_material',inventoryDomain:'non_food',stockRole:'production_material'
  });
  assert.equal(material.storage_area_type,'warehouse');
});

test('Operations defaults stay separate from retail merchandising areas',()=>{
  const packaging=inventoryStorageDefaults({
    inventoryType:'packaging',inventoryDomain:'operations',stockRole:'packaging'
  });
  assert.equal(packaging.storage_area_type,'general_supply');

  const chemical=inventoryStorageDefaults({
    inventoryType:'cleaning_sanitation',inventoryDomain:'operations',stockRole:'operational_supply'
  });
  assert.equal(chemical.storage_area_type,'chemical_storage');
  assert.equal(chemical.storage_segregated,true);
});

test('Retail can use sales floor or stock room while ambiguous Food-area reuse needs a label',()=>{
  assert.equal(validateInventoryStorage({
    inventoryType:'resale_item',inventoryDomain:'non_food',stockRole:'direct_resale',
    storageCondition:'dry',storageAreaType:'sales_floor'
  }).ok,true);
  assert.equal(validateInventoryStorage({
    inventoryType:'resale_item',inventoryDomain:'non_food',stockRole:'direct_resale',
    storageCondition:'dry',storageAreaType:'pantry',storageLocationLabel:''
  }).ok,false);
  assert.equal(validateInventoryStorage({
    inventoryType:'resale_item',inventoryDomain:'non_food',stockRole:'direct_resale',
    storageCondition:'dry',storageAreaType:'pantry',storageLocationLabel:'Retail shelf inside shared dry room'
  }).ok,true);
});

test('cleaning stock remains segregated even when universal retail locations exist',()=>{
  assert.equal(validateInventoryStorage({
    inventoryType:'cleaning_sanitation',inventoryDomain:'operations',stockRole:'operational_supply',
    storageCondition:'ambient',storageAreaType:'stock_room',storageSegregated:false
  }).ok,false);
  assert.equal(validateInventoryStorage({
    inventoryType:'cleaning_sanitation',inventoryDomain:'operations',stockRole:'operational_supply',
    storageCondition:'ambient',storageAreaType:'stock_room',storageSegregated:true,storageLocationLabel:'Locked chemical cabinet'
  }).ok,true);
});

test('database storage constraints and location names support Retail areas',()=>{
  assert.match(server,/inventory_storage_area_type_check/);
  assert.match(server,/sales_floor/);
  assert.match(server,/stock_room/);
  assert.match(server,/returns_inspection/);
  assert.match(locations,/storage_area_type IN \([^)]*sales_floor[^)]*stock_room[^)]*warehouse[^)]*returns_inspection/s);
  assert.match(locations,/sales_floor:'Sales floor'/);
  assert.match(locations,/stock_room:'Stock room'/);
});

test('Android Inventory creation exposes universal area and stock role but keeps legacy compatibility details',()=>{
  assert.match(html,/id="stockInventoryDomain"/);
  assert.match(html,/value="non_food">Retail \/ non-food/);
  assert.match(html,/id="stockStockRole"/);
  assert.match(html,/id="stockLegacyTypeDetails"/);
  assert.match(html,/id="stockInventoryType"/);
  assert.match(html,/value="resale_item"/);
  assert.match(html,/value="production_material"/);
  assert.match(ui,/inventory_domain:\$\('stockInventoryDomain'\)\.value/);
  assert.match(ui,/stock_role:\$\('stockStockRole'\)\.value/);
});

test('Inventory workspace filters Food Retail and Operations without separate stock engines',()=>{
  assert.match(html,/id="inventoryDomainFilters"/);
  assert.match(html,/data-inventory-domain="food"/);
  assert.match(html,/data-inventory-domain="non_food"/);
  assert.match(html,/data-inventory-domain="operations"/);
  assert.match(ui,/inventoryDomainFilter/);
  assert.match(ui,/inventoryDomainOf/);
  assert.match(ui,/renderInventoryList/);
  assert.match(css,/\.inventoryDomainFilters/);
  assert.match(css,/@media\(max-width:520px\)/);
});

test('Retail Inventory cards use universal stock state language and identifiers',()=>{
  assert.match(ui,/on hand .*available .*reserved .*unavailable .*incoming/s);
  assert.match(ui,/INVENTORY_DOMAIN_LABELS/);
  assert.match(ui,/INVENTORY_ROLE_LABELS/);
  assert.match(ui,/SKU /);
  assert.match(ui,/GTIN /);
});

test('Unavailable stock is a first-class Android action with restore',()=>{
  assert.match(html,/id="inventoryUnavailableForm"/);
  assert.match(html,/value="quality_control"/);
  assert.match(html,/value="return_pending"/);
  assert.match(ui,/wireInventoryUnavailableUi/);
  assert.match(ui,/loadInventoryUnavailableAllocations/);
  assert.match(ui,/data-release-unavailable/);
});

test('package syntax contract includes Universal Inventory V2C regression test',()=>{
  assert.match(pkg,/node --check tests\/universal-inventory-v2c\.test\.js/);
});
