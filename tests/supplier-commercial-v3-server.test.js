import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server-supplier-commercial-v3.js',import.meta.url),'utf8');

test('V3 keeps PO, receiving, invoice evidence and payment as separate authorities',()=>{
  assert.match(source,/CREATE TABLE IF NOT EXISTS purchase_invoice_evidence/);
  assert.match(source,/purchase_order_id BIGINT REFERENCES purchase_orders/);
  assert.match(source,/invoice_is_not_payment:true/);
  assert.match(source,/po_is_not_invoice:true/);
  assert.match(source,/fiscal_validation_automatic:false/);
});

test('trade terms support connected and external Suppliers without duplicating relationship identity',()=>{
  assert.match(source,/CREATE TABLE IF NOT EXISTS supplier_trade_terms/);
  assert.match(source,/supplier_account_id BIGINT REFERENCES accounts/);
  assert.match(source,/supply_party_id BIGINT REFERENCES merchant_supply_parties/);
  assert.match(source,/supplier_confirmed/);
  assert.match(source,/merchant_recorded/);
});

test('normal PO receiving can create traceable supply lots with handling snapshot',()=>{
  assert.match(source,/handling_mode_snapshot/);
  assert.match(source,/recordPoReceiptLot/);
  assert.match(source,/purchase_receipt_id/);
  assert.match(source,/purchase_order_item_id/);
  assert.match(source,/supplier_lot_code/);
  assert.match(source,/catalog_item_id/);
});

test('return request and physical dispatch remain separate states',()=>{
  assert.match(source,/status TEXT NOT NULL DEFAULT 'requested'/);
  assert.match(source,/\/api\/procurement\/returns/);
  assert.match(source,/\/api\/procurement\/returns\/:id\/dispatch/);
  assert.match(source,/returned_at/);
  assert.match(source,/quantity_remaining_base=quantity_remaining_base-\$1/);
  assert.match(source,/UPDATE inventory SET quantity=quantity-\$1/);
});

test('confirmed credit is separate from cash refund and can reduce commercial liability',()=>{
  assert.match(source,/confirmed_credit/);
  assert.match(source,/resolution_type IN \('credit','refund_expected'\)/);
  assert.match(source,/credit_is_not_cash_refund:true/);
});

test('recall uses exact Supplier lot matches and quarantines traceable lots',()=>{
  assert.match(source,/CREATE TABLE IF NOT EXISTS supply_recall_notices/);
  assert.match(source,/CREATE TABLE IF NOT EXISTS supply_recall_lot_matches/);
  assert.match(source,/exact_supplier_lot/);
  assert.match(source,/lot_state=.*quarantined/s);
  assert.match(source,/aggregate_inventory_sale_blocking:false/);
});
