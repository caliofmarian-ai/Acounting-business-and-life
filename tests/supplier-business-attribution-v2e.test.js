import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const suppliers=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');
const sourcing=readFileSync(new URL('../server-supplier-sourcing-v4.js',import.meta.url),'utf8');
const daily=readFileSync(new URL('../server-supplier-daily-v5.js',import.meta.url),'utf8');
const exceptions=readFileSync(new URL('../server-supplier-exceptions-v5.js',import.meta.url),'utf8');
const finance=readFileSync(new URL('../business-finance-view-core.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const documents=readFileSync(new URL('../financial-document-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/suppliers-ui.js',import.meta.url),'utf8');

test('purchase orders persist the exact Supplier economic workspace',()=>{
  assert.match(sourcing,/ADD COLUMN IF NOT EXISTS supplier_business_id BIGINT REFERENCES businesses/);
  assert.match(sourcing,/purchase_orders_supplier_business_idx/);
  assert.match(sourcing,/q\.supplier_business_id/);
  assert.match(sourcing,/supplier_business_id,q?\.?supplier_business_id|quote\.supplier_business_id/);
  assert.match(suppliers,/supplier_business_id,status,fulfilment_mode/);
});

test('historical PO migration is deterministic and leaves ambiguous multi-business history unassigned',()=>{
  assert.match(sourcing,/q\.supplier_business_id IS NOT NULL/);
  assert.match(sourcing,/HAVING COUNT\(\*\)=1/);
  assert.match(finance,/supplier_business_id IS NULL/);
  assert.match(finance,/historical_unassigned/);
  assert.match(finance,/SUPPLIER_HISTORICAL_PO_ATTRIBUTION_REVIEW_REQUIRED/);
  assert.doesNotMatch(sourcing,/HAVING COUNT\(\*\)>1/);
  assert.match(sourcing,/to_regclass\('public\.profile_business_bindings'\)/);
  assert.match(suppliers,/to_regclass\('public\.profile_business_bindings'\)/);
});

test('Merchant Supplier relationship resolves a concrete Supplier business before ordering',()=>{
  assert.match(suppliers,/supplier_relationships[\s\S]*supplier_business_id BIGINT REFERENCES businesses/);
  assert.match(suppliers,/supplier_business_name/);
  assert.match(suppliers,/allowActivePreference:true/);
  assert.match(suppliers,/Purchase order must use the Supplier business bound to this relationship/);
  assert.match(sourcing,/supplier_business_id=\$3/);
  assert.match(ui,/Each accepted relationship belongs to one Supplier business/);
});

test('multi-business direct catalog orders fail closed without catalog ownership evidence',()=>{
  assert.match(suppliers,/SUPPLIER_CATALOG_BUSINESS_ATTRIBUTION_REQUIRED/);
  assert.match(suppliers,/supplier_sourcing_published_items/);
  assert.match(daily,/supplier_sourcing_published_items/);
  assert.match(daily,/This catalog item is not associated with the selected Supplier business/);
});

test('Supplier payment evidence is written once to the exact shared business ledger',()=>{
  assert.match(suppliers,/supplier_receipt_tx_unique/);
  assert.match(suppliers,/business_id,type,category,amount,payment_method,account,note,source,source_id/);
  assert.match(suppliers,/'supplier_receipt'/);
  assert.match(suppliers,/po\.supplier_business_id/);
  assert.match(suppliers,/ON CONFLICT \(source,source_id\) WHERE source='supplier_receipt' DO UPDATE SET business_id=EXCLUDED\.business_id/);
  assert.match(suppliers,/t\.note=\('Receipt for '\|\|p\.po_number\)/);
  assert.match(suppliers,/t\.business_id IS DISTINCT FROM p\.supplier_business_id/);
  assert.doesNotMatch(finance,/CREATE TABLE/);
});

test('Supplier Finance, summaries and financial fee evidence are scoped by supplier_business_id',()=>{
  assert.match(finance,/p\.supplier_business_id=\$2/);
  assert.match(finance,/po\.supplier_business_id=\$3/);
  assert.match(finance,/po\.supplier_business_id=\$2/);
  assert.match(accounting,/supplier_business_id=\$2/);
  assert.match(accounting,/specificBusiness\(req,requested\)/);
  assert.match(documents,/po\.supplier_business_id=\$1/);
  assert.match(finance,/SUPPLIER_BUSINESS_ATTRIBUTED/);
});

test('general Supplier order operations are isolated to the active Supplier business',()=>{
  assert.match(suppliers,/WHERE p\.supplier_account_id=\$1 AND p\.supplier_business_id=\$2 ORDER BY p\.created_at DESC/);
  assert.match(suppliers,/supplier_business_id=\$3 FOR UPDATE/);
  assert.match(suppliers,/supplier_business_id=\$5 AND status NOT IN/);
  assert.match(suppliers,/Number\(po\.supplier_business_id\)===Number\(supplierBusinessId\)/);
});

test('Supplier Today and exception workflows use the selected Supplier business',()=>{
  assert.match(daily,/supplierTodayOrders\(pool,scope\)/);
  assert.match(daily,/supplierTodayMoney\(pool,scope\)/);
  assert.match(daily,/p\.supplier_business_id=\$2/);
  assert.match(daily,/SUPPLIER_BUSINESS_ATTRIBUTED/);
  assert.match(exceptions,/po\.supplier_business_id\?\?po\.quote_supplier_business_id/);
  assert.match(exceptions,/Historical purchase order Supplier-business attribution is ambiguous and requires review/);
});
