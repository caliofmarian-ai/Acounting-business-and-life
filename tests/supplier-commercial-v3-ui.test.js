import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/suppliers-ui.js',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');
const css=readFileSync(new URL('../public/suppliers.css',import.meta.url),'utf8');

test('Supplier Commercial V3 UI remains valid browser JavaScript',()=>{
  const r=spawnSync(process.execPath,['--check',fileURLToPath(uiUrl)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('Merchant Supplier UI keeps invoice payment return and recall concepts distinct',()=>{
  assert.match(ui,/A purchase order is a commitment, receiving is physical stock, an invoice is supplier evidence, and payment is real money movement/);
  assert.match(ui,/Record Supplier invoice evidence/);
  assert.match(ui,/Creating a return request does not change stock yet/);
  assert.match(ui,/A credit is not cash received/);
  assert.match(ui,/aggregate Inventory is not yet fully lot-allocated for every sale/);
});

test('PO receiving exposes optional lot and expiry traceability without forcing advanced fields',()=>{
  assert.match(ui,/Lot \/ expiry/);
  assert.match(ui,/data-lot-code/);
  assert.match(ui,/data-lot-expiry/);
  assert.match(ui,/expires_at/);
});

test('Supplier side exposes terms returns and exact lot recall progressively',()=>{
  assert.match(ui,/Commercial terms, returns & recall/);
  assert.match(ui,/Merchant payment terms/);
  assert.match(ui,/Resolve Merchant return/);
  assert.match(ui,/Issue lot\/batch recall/);
  assert.match(css,/\.supAlert/);
});
