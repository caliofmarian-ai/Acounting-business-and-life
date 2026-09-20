import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier Commercial V3 acceptance wave is registered after Supplier V2',()=>{
  assert.match(source,/SUPPLIER_COMMERCIAL_V3_WAVE='supplier_commercial_v3'/);
  assert.match(source,/runSupplierCommercialV3Acceptance/);
  assert.match(source,/runSupplierDomainV2Acceptance\(\{pool,base,secret\}\)/);
  assert.match(source,/config\.wave===SUPPLIER_COMMERCIAL_V3_WAVE/);
});

test('Supplier Commercial V3 acceptance covers terms invoice return credit payment guard and recall',()=>{
  assert.match(source,/paymentTermCode:'net_30'/);
  assert.match(source,/supplier_lot_code:supplierLotCode/);
  assert.match(source,/invoice_evidence_separate:true/);
  assert.match(source,/return_request_stock_unchanged:true/);
  assert.match(source,/return_inventory_reduction:true/);
  assert.match(source,/confirmed_credit:true/);
  assert.match(source,/excessive_payment_blocked:true/);
  assert.match(source,/recall_exact_lot:true/);
  assert.match(source,/aggregate_inventory_sale_blocking:false/);
});
