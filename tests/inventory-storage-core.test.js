import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryStorageDefaults,validateInventoryStorage,requireValidInventoryStorage} from '../inventory-storage-core.js';

test('cleaning and sanitation defaults to explicit segregated chemical storage',()=>{
  const d=inventoryStorageDefaults('cleaning_sanitation');
  assert.equal(d.storage_condition,'ambient');
  assert.equal(d.storage_area_type,'chemical_storage');
  assert.equal(d.storage_segregated,true);
  assert.equal(validateInventoryStorage({
    inventoryType:'cleaning_sanitation',
    storageCondition:d.storage_condition,
    storageAreaType:d.storage_area_type,
    storageLocationLabel:d.storage_location_label,
    storageSegregated:d.storage_segregated
  }).ok,true);
});

test('cleaning chemicals cannot be assigned to food storage areas',()=>{
  for(const area of ['pantry','fridge','freezer','prep_station']){
    const r=validateInventoryStorage({
      inventoryType:'cleaning_sanitation',
      storageCondition:area==='fridge'?'chilled':area==='freezer'?'frozen':'ambient',
      storageAreaType:area,
      storageSegregated:true
    });
    assert.equal(r.ok,false,area);
    assert.match(r.errors.join(' '),/separately from food/i);
  }
});

test('custom cleaning storage requires both segregation and an explicit label',()=>{
  assert.equal(validateInventoryStorage({
    inventoryType:'cleaning_sanitation',storageCondition:'ambient',storageAreaType:'other',
    storageLocationLabel:'',storageSegregated:true
  }).ok,false);
  assert.equal(validateInventoryStorage({
    inventoryType:'cleaning_sanitation',storageCondition:'ambient',storageAreaType:'other',
    storageLocationLabel:'Locked utility cabinet',storageSegregated:true
  }).ok,true);
});

test('food and food-contact stock cannot be assigned to chemical storage',()=>{
  for(const type of ['ingredient','packaging','kitchen_consumable','hygiene']){
    const r=validateInventoryStorage({
      inventoryType:type,storageCondition:'ambient',storageAreaType:'chemical_storage',storageSegregated:true
    });
    assert.equal(r.ok,false,type);
  }
});

test('fridge and freezer enforce the matching temperature condition',()=>{
  assert.equal(validateInventoryStorage({inventoryType:'ingredient',storageCondition:'ambient',storageAreaType:'fridge'}).ok,false);
  assert.equal(validateInventoryStorage({inventoryType:'ingredient',storageCondition:'chilled',storageAreaType:'fridge'}).ok,true);
  assert.equal(validateInventoryStorage({inventoryType:'ingredient',storageCondition:'chilled',storageAreaType:'freezer'}).ok,false);
  assert.equal(validateInventoryStorage({inventoryType:'ingredient',storageCondition:'frozen',storageAreaType:'freezer'}).ok,true);
});

test('labelled custom cold storage is allowed and unlabelled custom cold storage is rejected',()=>{
  assert.equal(validateInventoryStorage({
    inventoryType:'ingredient',storageCondition:'chilled',storageAreaType:'other',storageLocationLabel:''
  }).ok,false);
  assert.equal(validateInventoryStorage({
    inventoryType:'ingredient',storageCondition:'chilled',storageAreaType:'other',storageLocationLabel:'Cold room 1'
  }).ok,true);
});

test('requireValidInventoryStorage fails closed with storage evidence',()=>{
  assert.throws(()=>requireValidInventoryStorage({
    inventoryType:'ingredient',storageCondition:'dry',storageAreaType:'chemical_storage'
  }),error=>error?.code==='INVENTORY_STORAGE_INVALID'&&Array.isArray(error.storage_errors));
});
