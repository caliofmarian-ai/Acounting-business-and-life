import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const sourcing=readFileSync(new URL('../server-supplier-sourcing-v4.js',import.meta.url),'utf8');

test('Inventory low-stock control uses clear notification copy',()=>{
  assert.match(html,/Notify me when stock falls below/);
  assert.doesNotMatch(html,/Reorder when below/);
});

test('Inventory renders a complete restock list and supplier action',()=>{
  assert.match(html,/id="restockList"/);
  assert.match(html,/Ask Supplier to prepare|restock list/i);
  assert.match(ui,/\/api\/procurement\/reorder-suggestions/);
  assert.match(ui,/function renderRestockList/);
  assert.match(ui,/source_status==='PREFERRED_SOURCE'/);
});

test('Supplier prepare action creates an RFQ without recording purchase or receipt',()=>{
  assert.match(ui,/\/api\/procurement\/sourcing\/rfqs/);
  assert.match(ui,/substitution_policy:'approval_required'/);
  assert.match(ui,/supplier_business_ids:\[Number\(x\.supplier_business_id\)\]/);
  assert.match(html,/Sending a request does not record a purchase, payment or received stock/);
});

test('Reorder suggestions expose the connected Supplier business target',()=>{
  assert.match(sourcing,/spi\.business_id supplier_business_id/);
  assert.match(sourcing,/src\.supplier_business_id/);
});
