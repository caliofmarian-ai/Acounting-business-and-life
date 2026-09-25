import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');
const daily=readFileSync(new URL('../server-supplier-daily-v5.js',import.meta.url),'utf8');
const exceptions=readFileSync(new URL('../server-supplier-exceptions-v5.js',import.meta.url),'utf8');

test('Supplier server initializes and registers V5 exception routes',()=>{
  assert.match(server,/ensureSupplierExceptionsV5Schema/);
  assert.match(server,/registerSupplierExceptionsV5Routes/);
  assert.ok(server.indexOf('ensureSupplierExceptionsV5Schema(pool)')>0);
  assert.ok(server.indexOf('registerSupplierExceptionsV5Routes({app,pool,body,identity})')<server.indexOf('app.use(proxy)'));
});

test('Today reads only accepted exceptions that require Supplier action',()=>{
  assert.match(daily,/FROM supplier_backorders b/);
  assert.match(daily,/b\.state='merchant_accepted'/);
  assert.match(daily,/FROM supplier_substitution_proposals s/);
  assert.match(daily,/s\.state='merchant_accepted'/);
  assert.match(daily,/backorders:backorderCount/);
  assert.match(daily,/substitutions:substitutionCount/);
  assert.match(daily,/COUNT\(\*\) OVER\(\)::int queue_total/);
});

test('Merchant decisions are evidence-only for proposed backorder and substitution',()=>{
  assert.match(exceptions,/po_quantities_changed:false,inventory_changed:false,money_changed:false/);
  assert.match(exceptions,/po_mutated:false,inventory_changed:false,money_changed:false/);
});

test('backorder fulfilment changes confirmed packs but not ordered packs Inventory or money',()=>{
  assert.match(exceptions,/UPDATE purchase_order_items SET confirmed_packs=\$1/);
  assert.match(exceptions,/ordered_packs_unchanged:true/);
  assert.match(exceptions,/inventory_changed:false/);
  assert.match(exceptions,/money_changed:false/);
});
