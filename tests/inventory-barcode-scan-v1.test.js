import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeInternalSku,
  normalizeBarcode,
  rankInventoryLookup
} from '../inventory-identifiers.js';

const runtime=readFileSync(new URL('../inventory-identifiers.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/inventory-scan-ui.js',import.meta.url),'utf8');
const merchant=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const countUi=readFileSync(new URL('../public/inventory-count-ui.js',import.meta.url),'utf8');

test('Inventory SKU and barcode normalization is stable and optional',()=>{
  assert.equal(normalizeInternalSku('  cm-coco  400 '),'CM-COCO 400');
  assert.equal(normalizeInternalSku(''),'');
  assert.equal(normalizeBarcode(' 4800 3614 12345 '),'4800361412345');
  assert.equal(normalizeBarcode(''),'');
});

test('Inventory lookup prioritizes exact barcode, SKU and item matches',()=>{
  const rows=[
    {id:1,item:'Coconut milk 400 ml',internal_sku:'CM-COCO-400',barcode:'4800361412345'},
    {id:2,item:'Coconut milk bulk',internal_sku:'COCO-BULK',barcode:''}
  ];
  assert.equal(rankInventoryLookup(rows,{barcode:'4800361412345'})[0].id,1);
  assert.equal(rankInventoryLookup(rows,{sku:'cm-coco-400'})[0].id,1);
  assert.equal(rankInventoryLookup(rows,{q:'coconut milk 400 ml'})[0].id,1);
  assert.deepEqual(rankInventoryLookup(rows,{barcode:'999'}),[]);
});

test('Inventory schema has per-business optional unique SKU and barcode identifiers',()=>{
  assert.match(runtime,/ADD COLUMN IF NOT EXISTS internal_sku TEXT NOT NULL DEFAULT ''/);
  assert.match(runtime,/ADD COLUMN IF NOT EXISTS barcode TEXT NOT NULL DEFAULT ''/);
  assert.match(runtime,/inventory_business_internal_sku_unique/);
  assert.match(runtime,/ON inventory\(business_id,LOWER\(internal_sku\)\)/);
  assert.match(runtime,/inventory_business_barcode_unique/);
  assert.match(runtime,/ON inventory\(business_id,barcode\)/);
  assert.match(runtime,/WHERE barcode<>''/);
});

test('Duplicate identifier conflicts are explicit and never silently reassigned',()=>{
  assert.match(runtime,/inventory_identifier_conflict/);
  assert.match(runtime,/is already assigned to/);
  assert.match(runtime,/conflicting_inventory_id/);
  assert.match(runtime,/conflicting_item/);
  assert.match(runtime,/error\?\.code!=='23505'/);
});

test('Lookup API supports barcode, SKU and manual item search',()=>{
  assert.match(runtime,/app\.get\('\/api\/inventory\/lookup'/);
  assert.match(runtime,/req\.query\?\.barcode/);
  assert.match(runtime,/req\.query\?\.sku/);
  assert.match(runtime,/req\.query\?\.q/);
  assert.match(runtime,/rankInventoryLookup/);
  assert.match(runtime,/Enter an item name, SKU or barcode to search Inventory/);
});

test('Identifier updates stay optional for fresh ingredients',()=>{
  assert.match(runtime,/app\.patch\('\/api\/inventory\/:id\/identifiers'/);
  assert.doesNotMatch(runtime,/barcode.*required/i);
  assert.doesNotMatch(runtime,/internal_sku.*required/i);
});

test('Accounting runtime initializes identifiers and exact scanned receiving',()=>{
  assert.match(server,/ensureInventoryIdentifierSchema\(pool\)/);
  assert.match(server,/registerInventoryIdentifierRoutes\(app/);
  assert.match(server,/requestedInventoryId/);
  assert.match(server,/SELECT \* FROM inventory WHERE business_id=\$1 AND id=\$2 FOR UPDATE/);
  assert.match(server,/Inventory item not found/);
});

test('Merchant Inventory keeps manual search when camera scanning is unavailable',()=>{
  assert.match(html,/id="inventoryLookupForm"/);
  assert.match(html,/Item name, SKU or barcode/);
  assert.match(html,/id="inventoryScanStart"/);
  assert.match(html,/id="inventoryScanVideo"/);
  assert.match(ui,/window\.BarcodeDetector/);
  assert.match(ui,/navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(ui,/Inventory remains fully usable without scanning/);
  assert.match(ui,/Camera permission was denied\. Use manual search instead/);
  assert.match(ui,/No image is uploaded or stored/);
});

test('Scanner handoff integrates receiving and guided count without replacing manual controls',()=>{
  assert.match(merchant,/createInventoryScanUi/);
  assert.match(merchant,/onReceiveItem:useInventoryForReceiving/);
  assert.match(merchant,/onCountItem:item=>inventoryCountUi\.selectItem/);
  assert.match(merchant,/inventory_id:\$\('stockInventoryId'\)/);
  assert.match(countUi,/function selectItem\(inventoryId\)/);
  assert.match(countUi,/countSessionItemPicker/);
  assert.match(ui,/Receive purchase/);
  assert.match(ui,/Count item/);
  assert.match(ui,/Identifiers/);
});
