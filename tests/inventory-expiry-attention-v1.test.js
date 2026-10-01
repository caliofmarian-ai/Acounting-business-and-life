import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {merchantTodayViewModel} from '../merchant-today-core.js';

const core=readFileSync(new URL('../merchant-today-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('Merchant Today includes low stock and lot expiry signals in Inventory attention',()=>{
  const vm=merchantTodayViewModel({
    business:{id:1,name:'Kitchen'},
    presentation:{merchant_domain:'food'},
    inventoryRow:{low_stock:2,out_of_stock:1,expiring_soon:3,expired_lots:1,held_lots:2},
    expiryItems:[{id:8,item_name:'Chicken',supplier_lot_code:'LOT-8',lot_state:'available',quantity_remaining_base:4,base_unit:'kg',expires_at:'2026-10-03T12:00:00Z',expiry_status:'expiring_soon'}]
  });
  assert.equal(vm.inventory.low_stock,2);
  assert.equal(vm.inventory.expiring_soon,3);
  assert.equal(vm.inventory.expired_lots,1);
  assert.equal(vm.inventory.held_lots,2);
  assert.equal(vm.inventory.attention_total,8);
  assert.equal(vm.inventory.expiry_items[0].lot_code,'LOT-8');
});

test('Today lot query separates expired, soon and held lots',()=>{
  assert.match(core,/FROM supply_lots/);
  assert.match(core,/expires_at<=NOW\(\)/);
  assert.match(core,/NOW\(\)\+INTERVAL '3 days'/);
  assert.match(core,/lot_state NOT IN \('available','depleted'\)/);
  assert.match(core,/expiry_status/);
});

test('Today Inventory prioritizes food-safety expiry attention in the UI',()=>{
  assert.match(ui,/Expired stock needs action/);
  assert.match(ui,/Held stock needs review/);
  assert.match(ui,/Stock is expiring soon/);
  assert.match(ui,/EXPIRING SOON/);
  assert.match(ui,/lot attention signal/);
});
