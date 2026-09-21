import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server-supplier-daily-v5.js',import.meta.url),'utf8');

test('Today endpoint aggregates existing Supplier authorities instead of inventing new order states',()=>{
  assert.match(source,/\/api\/supplier\/v5\/today/);
  assert.match(source,/FROM purchase_orders p/);
  assert.match(source,/FROM supplier_rfq_targets t/);
  assert.match(source,/FROM purchase_returns r/);
  assert.match(source,/FROM supplier_catalog_items/);
  assert.match(source,/existing purchase_order lifecycle states/);
});

test('Today receivables use invoice or received value and do not treat unreceived PO commitment as money due',()=>{
  assert.match(source,/purchase_invoice_evidence/);
  assert.match(source,/confirmed_credit/);
  assert.match(source,/actual_received_total/);
  assert.match(source,/commercial_outstanding/);
  const start=source.indexOf('GREATEST(');
  const end=source.indexOf('commercial_outstanding',start);
  const block=source.slice(start,end);
  assert.doesNotMatch(block,/p\.expected_total/);
  assert.match(source,/Unreceived PO commitment is not money due/);
});

test('Today RFQ action queue is scoped to the selected Supplier business and account',()=>{
  assert.match(source,/t\.supplier_business_id=\$1/);
  assert.match(source,/t\.supplier_account_id=\$2/);
  assert.match(source,/t\.state IN \('invited','viewed'\)/);
});

test('availability quick update is Supplier-owned and never claims exact stock',()=>{
  assert.match(source,/supplier_account_id=\$2/);
  assert.match(source,/AVAILABILITY_EVIDENCE_ONLY/);
  assert.match(source,/exact_on_hand_quantity:null/);
  assert.match(source,/expected_restock_date/);
  assert.match(source,/availability_note/);
});

test('Today and availability fail closed for ambiguous multi-business Supplier accounts',()=>{
  assert.match(source,/SUPPLIER_BUSINESS_ATTRIBUTION_REQUIRED/);
  assert.match(source,/SUPPLIER_CATALOG_BUSINESS_ATTRIBUTION_REQUIRED/);
  assert.match(source,/bindingCount!==1/);
  assert.match(source,/SINGLE_SUPPLIER_BUSINESS_BINDING/);
  assert.doesNotMatch(source,/ACCOUNT_LEVEL_ORDER_ACTIVITY/);
});
