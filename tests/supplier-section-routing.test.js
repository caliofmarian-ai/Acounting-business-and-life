import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const ui=read('public/suppliers-ui.js');

test('Supplier shell exposes simplified daily destinations while retaining legacy operational routes',()=>{
  for(const feature of ['Today','Catalog','Orders','Money']){
    assert.match(shell,new RegExp("['\\"]"+feature+"['\\"]"));
    assert.match(ui,new RegExp(feature));
  }
  for(const legacy of ['Procurement','ETA','Fulfilment']){
    assert.match(ui,new RegExp(legacy));
  }
  assert.match(ui,/openSupplierWorkspace\(b\.dataset\.hubFeature\)/);
  assert.doesNotMatch(ui,/b\.onclick=openSupplierWorkspace/);
});

test('Supplier workspace renders section-specific content',()=>{
  assert.match(ui,/SUPPLIER_SECTION_META/);
  assert.match(ui,/supplierCatalogPanel/);
  assert.match(ui,/supplierRelationshipsPanel/);
  assert.match(ui,/supplierOrdersPanel/);
  assert.match(ui,/supSupplierSection=normalized/);
});

test('Supplier procurement, ETA and fulfilment use real PO lifecycle states',()=>{
  assert.match(ui,/SUPPLIER_PROCUREMENT_STATES=new Set\(\['sent','supplier_received'\]\)/);
  assert.match(ui,/SUPPLIER_ETA_STATES=new Set\(\['accepted','partially_accepted','preparing'\]\)/);
  assert.match(ui,/SUPPLIER_FULFILMENT_STATES=new Set\(\['ready_for_pickup','out_for_delivery','delivered','partially_received','received'\]\)/);
  assert.match(ui,/supplier_ready_at/);
  assert.match(ui,/supplier_delivery_eta/);
});

test('Supplier actions return to the correct workflow section',()=>{
  assert.match(ui,/renderSupplierWorkspace\('Procurement'\)/);
  assert.match(ui,/renderSupplierWorkspace\('ETA'\)/);
  assert.match(ui,/renderSupplierWorkspace\(\['ready_for_pickup','out_for_delivery','delivered'\]\.includes\(status\)\?'Fulfilment':'ETA'\)/);
});
