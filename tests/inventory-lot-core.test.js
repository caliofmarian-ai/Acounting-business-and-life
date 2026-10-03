import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryLotExpiryStatus,planFefoAllocation,planPhysicalStockReduction,sortFefoLots} from '../inventory-lot-core.js';

const now=Date.parse('2026-10-02T00:00:00Z');

test('expiry status distinguishes expired soon dated and undated lots',()=>{
  assert.equal(inventoryLotExpiryStatus(null,{now}),'no_expiry');
  assert.equal(inventoryLotExpiryStatus('2026-10-01T23:59:59Z',{now}),'expired');
  assert.equal(inventoryLotExpiryStatus('2026-10-04T00:00:00Z',{now,soonDays:3}),'expiring_soon');
  assert.equal(inventoryLotExpiryStatus('2026-10-10T00:00:00Z',{now,soonDays:3}),'ok');
});

test('FEFO sorts dated lots before undated stock and earliest expiry first',()=>{
  const rows=sortFefoLots([
    {id:3,expires_at:null,received_at:'2026-09-01T00:00:00Z'},
    {id:2,expires_at:'2026-10-08T00:00:00Z'},
    {id:1,expires_at:'2026-10-04T00:00:00Z'}
  ]);
  assert.deepEqual(rows.map(x=>x.id),[1,2,3]);
});

test('FEFO allocation skips expired and quarantined lots',()=>{
  const plan=planFefoAllocation({
    quantityNeeded:4,
    inventoryQuantity:10,
    now,
    lots:[
      {id:1,quantity_remaining_base:4,expires_at:'2026-10-01T00:00:00Z',lot_state:'available'},
      {id:2,quantity_remaining_base:3,expires_at:'2026-10-03T00:00:00Z',lot_state:'quarantined'},
      {id:3,quantity_remaining_base:5,expires_at:'2026-10-04T00:00:00Z',lot_state:'available'}
    ]
  });
  assert.equal(plan.ok,true);
  assert.deepEqual(plan.allocations.map(x=>[x.lot_id,x.quantity]),[[3,4]]);
});

test('legacy untracked inventory remains usable after tracked lots are accounted for',()=>{
  const plan=planFefoAllocation({
    quantityNeeded:7,
    inventoryQuantity:10,
    now,
    lots:[{id:1,quantity_remaining_base:3,expires_at:'2026-10-01T00:00:00Z',lot_state:'available'}]
  });
  assert.equal(plan.ok,true);
  assert.equal(plan.untracked_used,7);
});

test('expired tracked stock can make aggregate inventory unusable',()=>{
  const plan=planFefoAllocation({
    quantityNeeded:6,
    inventoryQuantity:10,
    now,
    lots:[{id:1,quantity_remaining_base:10,expires_at:'2026-10-01T00:00:00Z',lot_state:'available'}]
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.usable_quantity,0);
  assert.equal(plan.blocked_quantity,6);
});


test('physical waste defaults to FEFO across tracked lots',()=>{
  const plan=planPhysicalStockReduction({
    quantityToRemove:4,
    inventoryQuantity:10,
    now,
    lots:[
      {id:2,quantity_remaining_base:5,expires_at:'2026-10-08T00:00:00Z',lot_state:'available'},
      {id:1,quantity_remaining_base:5,expires_at:'2026-10-04T00:00:00Z',lot_state:'available'}
    ]
  });
  assert.equal(plan.ok,true);
  assert.deepEqual(plan.allocations.map(x=>[x.lot_id,x.quantity]),[[1,4]]);
  assert.equal(plan.untracked_used,0);
});

test('physical count reduces legacy untracked balance before exact lots',()=>{
  const plan=planPhysicalStockReduction({
    quantityToRemove:3,
    inventoryQuantity:10,
    now,
    mode:'count',
    lots:[{id:1,quantity_remaining_base:6,expires_at:'2026-10-04T00:00:00Z',lot_state:'available'}]
  });
  assert.equal(plan.ok,true);
  assert.equal(plan.untracked_used,3);
  assert.deepEqual(plan.allocations,[]);
});

test('expired disposal never consumes a fresh tracked lot automatically',()=>{
  const plan=planPhysicalStockReduction({
    quantityToRemove:4,
    inventoryQuantity:8,
    now,
    expiredOnly:true,
    lots:[
      {id:1,quantity_remaining_base:2,expires_at:'2026-10-01T00:00:00Z',lot_state:'available'},
      {id:2,quantity_remaining_base:5,expires_at:'2026-10-10T00:00:00Z',lot_state:'available'}
    ]
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.reason,'expired_stock_shortage');
});

test('explicit expired disposal rejects a non-expired lot',()=>{
  const plan=planPhysicalStockReduction({
    quantityToRemove:1,
    inventoryQuantity:5,
    now,
    expiredOnly:true,
    explicitLotId:2,
    lots:[{id:2,quantity_remaining_base:5,expires_at:'2026-10-10T00:00:00Z',lot_state:'available'}]
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.reason,'lot_not_expired');
});
