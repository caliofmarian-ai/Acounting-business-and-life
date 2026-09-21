import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/suppliers-ui.js',import.meta.url);
const shellUrl=new URL('../public/shell.js',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');
const shell=readFileSync(shellUrl,'utf8');

for(const [label,url] of [['Supplier UI',uiUrl],['Shell',shellUrl]]){
  test(label+' has valid JavaScript syntax',()=>{
    const r=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr||r.stdout);
  });
}

test('Supplier hub is simplified to Today Catalog Orders Money',()=>{
  assert.match(shell,/\['☀️','Today','What needs your attention now','Today'\]/);
  assert.match(shell,/\['📦','Catalog','Products, pricing and availability','Catalog'\]/);
  assert.match(shell,/\['📥','Orders','New, preparing and fulfilment orders','Orders'\]/);
  assert.match(shell,/\['💰','Money','Receivables and recorded payments','Money'\]/);
});

test('Supplier workspace opens Today by default while legacy sections remain supported',()=>{
  assert.match(ui,/Today:\['Today','What needs your attention now'\]/);
  assert.match(ui,/async function openSupplierWorkspace\(section='Today'\)/);
  assert.match(ui,/Procurement:\['Incoming Orders'/);
  assert.match(ui,/ETA:\['ETA & Readiness'/);
  assert.match(ui,/Fulfilment:\['Fulfilment'/);
});

test('Today shows daily action buckets and factual money due',()=>{
  assert.match(ui,/New orders/);
  assert.match(ui,/Prepare next/);
  assert.match(ui,/Ready \/ delivery/);
  assert.match(ui,/Money due/);
  assert.match(ui,/Other attention/);
  assert.match(ui,/supplierTodayPanel/);
});

test('Money panel shows operational receivables without treating unreceived PO as money due',()=>{
  assert.match(ui,/Receivables use invoice evidence when present, otherwise received value/);
  assert.match(ui,/confirmed credits and recorded payments are subtracted/);
  assert.match(ui,/An unreceived PO is not money due/);
  assert.match(ui,/Money due by order/);
});

test('availability UI explicitly says it is not exact warehouse stock',()=>{
  assert.match(ui,/This is availability evidence, not an exact warehouse stock count/);
  assert.match(ui,/Expected restock/);
  assert.match(ui,/Availability updated/);
  assert.match(ui,/data-v5-availability/);
});
