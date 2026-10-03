import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../inventory-lot-runtime.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('adjustment evidence records exact lot reductions and legacy/untracked delta',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS inventory_adjustment_lot_allocations/);
  assert.match(server,/untracked_quantity_delta NUMERIC/);
  assert.match(server,/lot_code_snapshot/);
  assert.match(server,/expires_at_snapshot/);
});

test('loss adjustments reconcile physical lots before aggregate Inventory commits',()=>{
  const start=server.indexOf("app.post('/api/inventory/adjustments'");
  const end=server.indexOf("app.get('/api/inventory/consumable-rules'",start);
  const block=server.slice(start,end);
  assert.match(block,/inventoryLotRows\(client/);
  assert.match(block,/planPhysicalStockReduction/);
  assert.match(block,/applyPhysicalLotReductions/);
  assert.match(block,/trackedAfter>safeAfter/);
  assert.match(block,/expiredOnly:kind==='expired'/);
  assert.match(block,/mode:kind==='count_correction'\?'count':'loss'/);
});

test('physical lot reduction can consume expired or held stock and marks empty lots depleted',()=>{
  assert.match(runtime,/export async function applyPhysicalLotReductions/);
  assert.doesNotMatch(runtime.slice(runtime.indexOf('export async function applyPhysicalLotReductions')),/lot_state='available' AND quantity_remaining_base/);
  assert.match(runtime,/THEN 'depleted' ELSE lot_state END/);
});

test('Merchant can select an exact lot while count correction stays whole-item',()=>{
  assert.match(html,/id="stockAdjustmentLot"/);
  assert.match(ui,/function loadStockAdjustmentLots/);
  assert.match(ui,/Auto — earliest-expiry lot first/);
  assert.match(ui,/Auto — expired lot\(s\) first/);
  assert.match(ui,/Whole-item reconciliation — no single lot/);
  assert.match(ui,/lot_id:\$\('stockAdjustmentLot'\)\.value/);
});

test('adjustment history returns and displays lot allocation evidence',()=>{
  assert.match(server,/lot_allocations:byAdjustment/);
  assert.match(ui,/lots .*quantity_removed/s);
  assert.match(ui,/legacy\/untracked/);
});
