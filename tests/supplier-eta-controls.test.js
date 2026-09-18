import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/suppliers-ui.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');

test('Supplier PO response captures both readiness and delivery ETA',()=>{
  assert.match(ui,/id="supReady"/);
  assert.match(ui,/id="supDeliveryEta"/);
  assert.match(ui,/supplier_ready_at:pmanilaIso\(document\.getElementById\('supReady'\)\.value\)/);
  assert.match(ui,/supplier_delivery_eta:pmanilaIso\(document\.getElementById\('supDeliveryEta'\)\.value\)/);
  assert.match(server,/supplier_ready_at=\$3,supplier_delivery_eta=\$4/);
});

test('accepted purchase orders can reopen the existing response editor to update ETA',()=>{
  assert.match(ui,/\['accepted','partially_accepted'\]\.includes\(p\.status\).*Update ETA/);
  assert.match(ui,/data-sup-respond/);
  assert.match(server,/\['sent','supplier_received','accepted','partially_accepted'\]/);
});

test('existing Supplier ETA values are retained when reopening the response form',()=>{
  assert.match(ui,/pmanilaInput\(p\.supplier_ready_at\)/);
  assert.match(ui,/pmanilaInput\(p\.supplier_delivery_eta\)/);
  assert.match(ui,/p\.supplier_note\|\|''/);
});

test('Supplier ETA uses explicit Philippines local time conversion',()=>{
  assert.match(ui,/timeZone:'Asia\/Manila'/);
  assert.match(ui,/new Date\(raw\+':00\+08:00'\)/);
  assert.match(ui,/toISOString\(\)/);
});
