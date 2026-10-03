import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeInventoryCountScope} from '../inventory-count-sessions.js';
import {createInventoryLocationUi} from '../public/inventory-location-ui.js';

const locations=readFileSync(new URL('../inventory-locations.js',import.meta.url),'utf8');
const counts=readFileSync(new URL('../inventory-count-sessions.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const countUi=readFileSync(new URL('../public/inventory-count-ui.js',import.meta.url),'utf8');

test('multi-location schema separates business total from internal location balances',()=>{
  assert.match(locations,/CREATE TABLE IF NOT EXISTS inventory_storage_locations/);
  assert.match(locations,/CREATE TABLE IF NOT EXISTS inventory_location_balances/);
  assert.match(locations,/CREATE TABLE IF NOT EXISTS inventory_lot_location_balances/);
  assert.match(locations,/CREATE TABLE IF NOT EXISTS inventory_location_transfers/);
  assert.match(locations,/CREATE TABLE IF NOT EXISTS inventory_location_transfer_lots/);
  assert.match(locations,/actor_account_id BIGINT REFERENCES accounts/);
  assert.match(locations,/source_location_id BIGINT NOT NULL/);
  assert.match(locations,/destination_location_id BIGINT NOT NULL/);
  assert.match(locations,/created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
});

test('internal transfer conserves canonical business stock and never creates financial movement',()=>{
  const start=locations.indexOf("app.post('/api/inventory/transfers'");
  const end=locations.indexOf("app.post('/api/inventory/transfers/:id/reverse'",start);
  assert.ok(start>=0&&end>start);
  const block=locations.slice(start,end);
  assert.match(block,/UPDATE inventory_location_balances SET quantity=quantity-\$1/);
  assert.match(block,/inventory_location_balances\.quantity\+EXCLUDED\.quantity/);
  assert.match(block,/Internal transfer would violate business-total stock conservation/);
  assert.match(block,/business_total/);
  assert.match(block,/location_total/);
  assert.match(block,/internal_stock_location_only_no_purchase_sale_or_cash_movement/);
  assert.doesNotMatch(block,/UPDATE inventory SET/);
  assert.doesNotMatch(block,/INSERT INTO transactions/);
  assert.doesNotMatch(block,/inventory_purchases/);
});

test('transfer preserves lot lineage and uses safe FEFO allocation',()=>{
  assert.match(locations,/function planTransferLots/);
  assert.match(locations,/inventoryLotExpiryStatus/);
  assert.match(locations,/inventory_lot_location_balances/);
  assert.match(locations,/INSERT INTO inventory_location_transfer_lots/);
  assert.match(locations,/expires_at_snapshot/);
  assert.match(locations,/Not enough safe FEFO or untracked stock is available in the source location/);
});

test('transfer reversal is linked, exact and cannot be applied twice',()=>{
  const start=locations.indexOf("app.post('/api/inventory/transfers/:id/reverse'");
  assert.ok(start>=0);
  const block=locations.slice(start);
  assert.match(block,/reversal_of_transfer_id/);
  assert.match(block,/This transfer has already been reversed/);
  assert.match(block,/Destination lot balance changed and this transfer can no longer be reversed exactly/);
  assert.match(block,/inventory_location_transfer_lots/);
  assert.match(block,/internal_stock_location_only_no_purchase_sale_or_cash_movement/);
  assert.doesNotMatch(block,/INSERT INTO transactions/);
});

test('location reconciliation makes legacy and newly received stock allocatable without changing canonical total',()=>{
  assert.match(locations,/reconcileInventoryLocationBalance/);
  assert.match(locations,/canonical-allocated/);
  assert.match(locations,/ensureDefaultInventoryLocation/);
  assert.match(locations,/reconcileLotLocationBalance/);
  assert.match(server,/reconcileInventoryLocationBalance\(client/);
  assert.match(server,/reconcileLotLocationBalance\(client/);
});

test('guided cycle count accepts an exact internal location scope',()=>{
  const scope=normalizeInventoryCountScope({
    count_type:'cycle',
    scope_type:'location_id',
    scope_value:'42'
  },new Set(['ingredient']));
  assert.deepEqual(scope,{
    count_type:'cycle',
    scope_type:'location_id',
    scope_value:'42',
    location_id:42
  });
  assert.throws(()=>normalizeInventoryCountScope({
    count_type:'cycle',
    scope_type:'location_id',
    scope_value:'nope'
  },new Set(['ingredient'])),/valid internal storage location/);
  assert.match(counts,/location_id BIGINT REFERENCES inventory_storage_locations/);
  assert.match(counts,/FROM inventory_location_balances b/);
  assert.match(counts,/b\.location_id=\$3/);
});

test('location count posts only the real variance into canonical Inventory and selected location',()=>{
  const start=counts.indexOf("app.post('/api/inventory/count-sessions/:id/post'");
  const block=counts.slice(start);
  assert.ok(start>=0);
  assert.match(block,/canonicalAfter=locationId==null\?countAfter:canonicalBefore\+delta/);
  assert.match(block,/planLocationStockReduction/);
  assert.match(block,/applyLocationLotReductions/);
  assert.match(block,/UPDATE inventory_location_balances/);
  assert.match(block,/Location count posting must conserve business-total stock across locations/);
  assert.match(block,/count_correction/);
  assert.match(block,/Inventory location count session/);
});

test('Merchant mobile UI exposes locations, transfers, reversal and location counts',()=>{
  assert.equal(typeof createInventoryLocationUi,'function');
  for(const id of [
    'inventoryLocationsCard','inventoryLocationForm','inventoryLocationBalanceList',
    'inventoryTransferForm','inventoryTransferItem','inventoryTransferSource',
    'inventoryTransferDestination','inventoryTransferQuantity','inventoryTransferList'
  ])assert.match(html,new RegExp('id=["\\']'+id+'["\\']'));
  assert.match(html,/value="location_id">Storage location/);
  assert.match(ui,/createInventoryLocationUi/);
  assert.match(ui,/inventoryLocationUi\.load\(\)/);
  assert.match(ui,/getLocations:\(\)=>inventoryLocationUi\.getLocations\(\)/);
  assert.match(countUi,/scopeType\.value==='location_id'/);
  assert.match(countUi,/Location · /);
});
