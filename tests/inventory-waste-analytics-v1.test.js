import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('waste analytics endpoint is Merchant scoped and supports 7 or 30 days',()=>{
  assert.match(server,/app\.get\('\/api\/inventory\/waste-analytics'/);
  assert.match(server,/ctx\.role!=='merchant'/);
  assert.match(server,/Number\(req\.query\.days\)===30\?30:7/);
  assert.match(server,/a\.business_id=\$1/);
});

test('waste analytics reconciles only true loss adjustment kinds from inventory_adjustments',()=>{
  assert.match(server,/FROM inventory_adjustments a/);
  assert.match(server,/a\.adjustment_kind IN \('waste','spoilage','expired','damaged','other_loss'\)/);
  assert.match(server,/a\.quantity_delta<0/);
  assert.match(server,/estimated_value_delta/);
  const route=server.slice(server.indexOf("app.get('/api/inventory/waste-analytics'"),server.indexOf("app.get('/api/inventory/adjustments'"));
  assert.doesNotMatch(route,/count_correction/);
});

test('comparison evidence uses recorded purchases and recorded order plus Quick Sale usage',()=>{
  assert.match(server,/FROM inventory_purchases/);
  assert.match(server,/FROM order_stock_consumptions osc/);
  assert.match(server,/FROM product_sale_ingredients psi/);
  assert.match(server,/JOIN product_sales ps/);
  assert.match(server,/osc\.reversed_at IS NULL/);
});

test('analytics declares adjustment-time cost snapshot as the value basis',()=>{
  assert.match(server,/value_basis:'adjustment_time_unit_cost_snapshot'/);
  assert.match(server,/source:'inventory_adjustments'/);
});

test('mobile UI has 7/30-day summary, reason breakdown, top items and loss drill-down',()=>{
  assert.match(html,/id="wasteAnalyticsCard"/);
  assert.match(html,/id="wastePeriod7"/);
  assert.match(html,/id="wastePeriod30"/);
  assert.match(html,/id="wasteReasonList"/);
  assert.match(html,/id="wasteTopItems"/);
  assert.match(html,/id="wasteDetailList"/);
  assert.match(ui,/\/api\/inventory\/waste-analytics\?days=/);
  assert.match(ui,/function renderWasteAnalytics/);
  assert.match(ui,/recorded purchases/);
  assert.match(ui,/recorded usage/);
});

test('UI explicitly refuses to invent a waste percentage without complete denominator evidence',()=>{
  assert.match(html,/does not calculate a waste percentage unless denominator completeness can be proven/);
  assert.match(ui,/no waste rate is invented without a complete denominator/);
});
