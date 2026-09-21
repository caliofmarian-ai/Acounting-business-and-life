import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier Sourcing V4 acceptance wave is registered after V3',()=>{
  assert.match(source,/SUPPLIER_SOURCING_V4_WAVE='supplier_sourcing_v4'/);
  assert.match(source,/runSupplierSourcingV4Acceptance/);
  assert.match(source,/runSupplierCommercialV3Acceptance\(\{pool,base,secret\}\)/);
  assert.match(source,/config\.wave===SUPPLIER_SOURCING_V4_WAVE/);
});

test('Supplier Sourcing V4 acceptance checks privacy, RFQ, comparison, preference and explicit PO',()=>{
  assert.match(source,/visibility:'private'/);
  assert.match(source,/Private Supplier leaked into controlled sourcing directory/);
  assert.match(source,/Supplier Sourcing V4 RFQ created a purchase order automatically/);
  assert.match(source,/comparison_status!=='NOT_COMPARABLE'/);
  assert.match(source,/reorder_preferred_source:true/);
  assert.match(source,/no_auto_po:true/);
  assert.match(source,/explicit_quote_to_po:true/);
  assert.match(source,/source_quote_snapshot:true/);
});

test('Supplier Sourcing V4 acceptance exercises non-initial Merchant business',()=>{
  assert.match(source,/merchant_business_id:merchantBusinessId/);
  assert.match(source,/reorder_business_id:merchantBusinessId/);
  assert.match(source,/business_id=\$1/);
});
