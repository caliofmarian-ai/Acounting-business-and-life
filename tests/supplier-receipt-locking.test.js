import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const suppliers=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');

test('Supplier PO receipt locks only the purchase-order item across both receipt routes',()=>{
  const safe=/LEFT JOIN merchant_supplier_item_links[\s\S]{0,500}WHERE i\.id=\$2 AND i\.purchase_order_id=\$3 FOR UPDATE OF i/;
  assert.match(accounting,safe);
  assert.match(suppliers,safe);
  assert.doesNotMatch(accounting,/WHERE i\.id=\$2 AND i\.purchase_order_id=\$3 FOR UPDATE(?! OF i)/);
  assert.doesNotMatch(suppliers,/WHERE i\.id=\$2 AND i\.purchase_order_id=\$3 FOR UPDATE(?! OF i)/);
});
