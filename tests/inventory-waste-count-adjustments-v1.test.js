import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Inventory adjustment ledger supports waste spoilage expiry damage and stock counts',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS inventory_adjustments/);
  assert.match(server,/waste/);
  assert.match(server,/spoilage/);
  assert.match(server,/expired/);
  assert.match(server,/damaged/);
  assert.match(server,/count_correction/);
  assert.match(server,/estimated_value_delta/);
});

test('Inventory adjustments change stock but never create fake cash movement',()=>{
  assert.match(server,/accounting_effect:'inventory_only_no_cash_movement'/);
  assert.match(server,/UPDATE inventory SET quantity=\$1,updated_at=NOW\(\)/);
  const block=server.slice(server.indexOf("app.post('/api/inventory/adjustments'"),server.indexOf("app.get('/api/inventory/consumable-rules'"));
  assert.doesNotMatch(block,/INSERT INTO transactions/);
});

test('Loss cannot exceed available stock and physical count can reconcile either direction',()=>{
  assert.match(server,/Adjustment cannot remove more stock than is currently available/);
  assert.match(server,/kind==='count_correction'\?entered:before-entered/);
});

test('Merchant Inventory exposes waste and physical count UI with audit history',()=>{
  assert.match(html,/id="stockAdjustmentForm"/);
  assert.match(html,/Waste & stock count/);
  assert.match(html,/Recent adjustments/);
  assert.match(ui,/\/api\/inventory\/adjustments/);
  assert.match(ui,/function loadStockAdjustments/);
  assert.match(ui,/estimated stock-value change/);
});
