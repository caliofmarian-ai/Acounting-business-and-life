import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Merchant can configure non-ingredient consumables by fulfilment and basis',()=>{
  assert.match(accounting,/CREATE TABLE IF NOT EXISTS merchant_order_consumable_rules/);
  assert.match(accounting,/fulfilment_scope IN \('all','pickup','delivery'\)/);
  assert.match(accounting,/usage_basis IN \('per_order','per_item'\)/);
  assert.match(accounting,/Recipe ingredients cannot be configured as order consumables/);
  assert.match(html,/id="consumableRuleForm"/);
  assert.match(ui,/\/api\/inventory\/consumable-rules/);
});

test('Order preparation consumes matching operational rules',()=>{
  assert.match(orders,/FROM merchant_order_consumable_rules r/);
  assert.match(orders,/r\.fulfilment_scope='all' OR r\.fulfilment_scope=\$2/);
  assert.match(orders,/r\.usage_basis==='per_item'\?itemCount:1/);
  assert.match(orders,/order_stock_consumptions/);
});

test('Cancellation reversal remains shared for recipe and consumable stock',()=>{
  assert.match(orders,/async function reverseStock/);
  assert.match(orders,/SELECT \* FROM order_stock_consumptions WHERE order_id=\$1 AND reversed_at IS NULL FOR UPDATE/);
  assert.match(orders,/UPDATE inventory SET quantity=quantity\+\$1/);
});
