import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  INVENTORY_UNAVAILABLE_REASONS,
  normalizeUnavailableAllocation,
  ensureInventoryStateSchema
} from '../inventory-state-core.js';
import {planInventoryReservationAllocation} from '../order-stock-reservation.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const stateCore=read('inventory-state-core.js');
const lotRuntime=read('inventory-lot-runtime.js');
const accounting=read('server-business-accounting.js');
const reservation=read('order-stock-reservation.js');
const pkg=read('package.json');

test('Universal Inventory unavailable reasons are explicit and auditable',()=>{
  assert.deepEqual([...INVENTORY_UNAVAILABLE_REASONS],[
    'damaged','quality_control','safety_stock','return_pending','quarantine','other'
  ]);
  assert.deepEqual(
    normalizeUnavailableAllocation({reason:'damaged',quantity:2,note:'Box crushed'}),
    {reason:'damaged',quantity:2,location_id:null,note:'Box crushed'}
  );
  assert.throws(()=>normalizeUnavailableAllocation({reason:'mystery',quantity:1}),/valid unavailable-stock reason/);
  assert.throws(()=>normalizeUnavailableAllocation({reason:'damaged',quantity:0}),/greater than zero/);
});

test('Unavailable stock schema is business-scoped and releaseable without deleting evidence',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureInventoryStateSchema(db);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS inventory_unavailable_allocations/);
  assert.match(calls[0].sql,/business_id BIGINT NOT NULL REFERENCES businesses/);
  assert.match(calls[0].sql,/inventory_id BIGINT NOT NULL REFERENCES inventory/);
  assert.match(calls[0].sql,/location_id BIGINT REFERENCES inventory_storage_locations/);
  assert.match(calls[0].sql,/state IN \('active','released'\)/);
  assert.match(calls[0].sql,/released_at TIMESTAMPTZ/);
});

test('stock-state read model exposes On hand Reserved Unavailable Available while preserving Food lot blocking',()=>{
  assert.match(lotRuntime,/on_hand_quantity/);
  assert.match(lotRuntime,/reserved_quantity/);
  assert.match(lotRuntime,/manual_unavailable_quantity/);
  assert.match(lotRuntime,/unavailable_quantity/);
  assert.match(lotRuntime,/available_quantity/);
  assert.match(lotRuntime,/lot_blocked_quantity/);
  assert.match(lotRuntime,/activeInventoryUnavailableMap/);
});

test('new order reservations cannot consume active unavailable quantity',()=>{
  const plan=planInventoryReservationAllocation({
    quantityNeeded:4,
    physicalQuantity:10,
    unavailableQuantity:4,
    lots:[{id:1,quantity_remaining_base:10,lot_state:'available',expires_at:null}]
  });
  assert.equal(plan.ok,true);
  assert.equal(plan.available,6);
  assert.equal(plan.unavailableQuantity,4);

  const blocked=planInventoryReservationAllocation({
    quantityNeeded:7,
    physicalQuantity:10,
    unavailableQuantity:4,
    lots:[{id:1,quantity_remaining_base:10,lot_state:'available',expires_at:null}]
  });
  assert.equal(blocked.ok,false);
  assert.equal(blocked.available,6);
  assert.equal(blocked.short,1);
});

test('reservation runtime reads unavailable stock under the same Inventory lock path',()=>{
  assert.match(reservation,/activeInventoryUnavailableMap/);
  assert.match(reservation,/unavailableQuantity/);
  assert.match(reservation,/totalBeforeUnavailable-unavailable/);
  assert.match(reservation,/SELECT id,item,quantity,unit,unit_cost FROM inventory[\s\S]*FOR UPDATE/);
});

test('Incoming stock is derived from open Supplier purchase-order evidence rather than added to sellable quantity',()=>{
  assert.match(stateCore,/function incomingQuantityInInventoryUnit/);
  assert.match(stateCore,/FROM purchase_order_items poi/);
  assert.match(stateCore,/JOIN purchase_orders p/);
  assert.match(stateCore,/JOIN merchant_supplier_item_links l/);
  assert.match(stateCore,/received_packs\+0\.000001<COALESCE\(poi\.confirmed_packs,poi\.ordered_packs\)/);
  assert.match(stateCore,/incoming_quantity/);
  assert.doesNotMatch(lotRuntime,/incoming_quantity/);
});

test('Merchant Inventory API creates and releases holds without fabricating accounting transactions',()=>{
  assert.match(accounting,/app\.post\('\/api\/inventory\/:id\/unavailable'/);
  assert.match(accounting,/INVENTORY_UNAVAILABLE_EXCEEDS_AVAILABLE/);
  assert.match(accounting,/createInventoryUnavailableAllocation/);
  assert.match(accounting,/app\.post\('\/api\/inventory\/:id\/unavailable\/:allocationId\/release'/);
  assert.match(accounting,/releaseInventoryUnavailableAllocation/);
  const start=accounting.indexOf("app.post('/api/inventory/:id/unavailable'");
  const end=accounting.indexOf("app.post('/api/inventory',jsonBody",start);
  const block=accounting.slice(start,end);
  assert.doesNotMatch(block,/INSERT INTO transactions/);
  assert.doesNotMatch(block,/business_expense/);
});

test('Inventory API projects Incoming alongside canonical state quantities',()=>{
  const start=accounting.indexOf("app.get('/api/inventory'");
  const end=accounting.indexOf('registerInventoryLocationRoutes',start);
  const block=accounting.slice(start,end);
  assert.match(block,/incomingInventoryMap/);
  assert.match(block,/incoming_quantity/);
  assert.match(block,/incoming_unresolved_lines/);
});

test('package syntax contract includes Universal Inventory V2B files',()=>{
  assert.match(pkg,/node --check inventory-state-core\.js/);
  assert.match(pkg,/node --check tests\/universal-inventory-v2b\.test\.js/);
});
