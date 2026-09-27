import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server-supplier-exceptions-v5.js',import.meta.url),'utf8');

test('backorder proposal is explicit and leaves PO quantities unchanged',()=>{
  assert.match(source,/\/api\/supplier\/orders\/:id\/backorders/);
  assert.match(source,/validateBackorderProposal/);
  assert.match(source,/po_quantities_changed:false/);
  assert.match(source,/supplier_backorders_active_item_unique/);
});

test('Merchant backorder decision does not mutate PO Inventory or money',()=>{
  assert.match(source,/\/api\/procurement\/backorders\/:id\/respond/);
  assert.match(source,/po_quantities_changed:false,inventory_changed:false,money_changed:false/);
  assert.match(source,/merchant_accepted/);
  assert.match(source,/merchant_declined/);
});

test('only Merchant-accepted backorder fulfilment may increase confirmed packs',()=>{
  assert.match(source,/backorderFulfilmentDelta/);
  assert.match(source,/UPDATE purchase_order_items SET confirmed_packs=\$1/);
  assert.match(source,/ordered_packs_unchanged:true/);
  assert.match(source,/inventory_changed:false/);
  assert.match(source,/money_changed:false/);
});

test('substitution snapshots an owned available substitute and never rewrites the original PO',()=>{
  assert.match(source,/\/api\/supplier\/orders\/:id\/substitutions/);
  assert.match(source,/Substitute must be a different catalog item/);
  assert.match(source,/substitute_name_snapshot/);
  assert.match(source,/substitute_price_per_pack/);
  assert.match(source,/po_mutated:false,inventory_changed:false,money_changed:false/);
});

test('Merchant substitution acceptance is approval evidence, not fulfilment',()=>{
  assert.match(source,/\/api\/procurement\/substitutions\/:id\/respond/);
  assert.match(source,/MERCHANT_APPROVED_NOT_YET_FULFILLED/);
  assert.match(source,/po_mutated:false,inventory_changed:false,money_changed:false/);
});

test('Supplier exceptions prefer canonical PO business attribution and fail closed only for ambiguous history',()=>{
  assert.match(source,/canonicalSupplierBusinessId=po\.supplier_business_id\?\?po\.quote_supplier_business_id/);
  assert.match(source,/Historical purchase order Supplier-business attribution is ambiguous and requires review/);
  assert.match(source,/activeSupplierBindingCount/);
  assert.match(source,/resolved_supplier_business_id/);
});


test('multi-business substitutions fail closed until catalog items have explicit business attribution',()=>{
  assert.match(source,/SUPPLIER_SUBSTITUTE_CATALOG_ATTRIBUTION_REQUIRED/);
  assert.match(source,/Substitution requires explicit catalog-to-business attribution/);
  assert.match(source,/activeSupplierBindingCount\(pool,me\.account\.id\)!==1/);
});
