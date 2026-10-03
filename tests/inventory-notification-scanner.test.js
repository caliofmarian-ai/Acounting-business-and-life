import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAttentionSignals} from '../inventory-notification-scanner.js';

const now=Date.parse('2026-10-03T00:00:00Z');

test('Inventory attention emits out-of-stock instead of duplicate low-stock for zero usable stock',()=>{
  const signals=inventoryAttentionSignals({
    businessId:7,
    now,
    inventoryRows:[
      {id:1,item:'Rice',usable_quantity:0,physical_quantity:5,blocked_quantity:5,reorder_level:2,unit:'kg'},
      {id:2,item:'Oil',usable_quantity:1,physical_quantity:1,blocked_quantity:0,reorder_level:2,unit:'L'}
    ]
  });
  const rice=signals.filter(x=>x.entity_id===1);
  assert.deepEqual(rice.map(x=>x.signal_code),['out_of_stock']);
  assert.equal(rice[0].data.physical_quantity,5);
  assert.equal(rice[0].data.blocked_quantity,5);
  const oil=signals.find(x=>x.entity_id===2);
  assert.equal(oil.signal_code,'low_stock');
});

test('Lot attention prioritizes held state over expiry state',()=>{
  const signals=inventoryAttentionSignals({
    businessId:7,
    now,
    lotRows:[
      {id:10,inventory_id:1,item_name:'Chicken',quantity_remaining_base:2,base_unit:'kg',lot_state:'quarantined',expires_at:'2026-10-02T00:00:00Z',supplier_lot_code:'C-10'}
    ]
  });
  assert.equal(signals.length,1);
  assert.equal(signals[0].signal_code,'held');
  assert.equal(signals[0].data.lot_code,'C-10');
});

test('Available lots distinguish expiring-soon and expired transitions',()=>{
  const signals=inventoryAttentionSignals({
    businessId:8,
    now,
    lotRows:[
      {id:20,inventory_id:2,item_name:'Milk',quantity_remaining_base:1,base_unit:'L',lot_state:'available',expires_at:'2026-10-05T00:00:00Z'},
      {id:21,inventory_id:2,item_name:'Milk',quantity_remaining_base:1,base_unit:'L',lot_state:'available',expires_at:'2026-10-02T00:00:00Z'}
    ]
  });
  assert.equal(signals.find(x=>x.entity_id===20).signal_code,'expiring_soon');
  assert.equal(signals.find(x=>x.entity_id===21).signal_code,'expired');
});
