import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server-supplier-sourcing-v4.js',import.meta.url),'utf8');

test('Supplier discovery is opt-in and private by default',()=>{
  assert.match(source,/visibility TEXT NOT NULL DEFAULT 'private'/);
  assert.match(source,/visibility IN \('private','directory','rfq_only'\)/);
  assert.match(source,/ss\.visibility IN \('directory','rfq_only'\)/);
  assert.match(source,/p\.role='supplier' AND p\.enabled=TRUE/);
});

test('directory uses explicitly published catalog items and does not expose contact fields',()=>{
  assert.match(source,/supplier_sourcing_published_items/);
  assert.match(source,/published_catalog/);
  assert.doesNotMatch(source,/sp\.email/);
  assert.doesNotMatch(source,/sp\.phone/);
});

test('RFQs target at most five eligible Suppliers and create no order',()=>{
  assert.match(source,/RFQ requires 1–5 Supplier targets/);
  assert.match(source,/One or more Supplier targets do not accept sourcing requests/);
  assert.match(source,/INSERT INTO supplier_rfqs/);
  assert.match(source,/INSERT INTO supplier_rfq_targets/);
});

test('connected and external quotes remain distinct evidence sources',()=>{
  assert.match(source,/source_type IN \('connected_supplier','external'\)/);
  assert.match(source,/supplier_quotes_connected_unique/);
  assert.match(source,/supplier_quotes_external_unique/);
  assert.match(source,/External Supplier quote cannot create an in-app PO/);
});

test('preferred reorder sources require accepted relationships and explicit rank',()=>{
  assert.match(source,/merchant_inventory_supplier_sources/);
  assert.match(source,/Preferred reorder sources require accepted Supplier relationships/);
  assert.match(source,/preference_rank/);
});

test('quote to PO requires explicit Merchant call and snapshots source quote',()=>{
  assert.match(source,/\/api\/procurement\/sourcing\/quotes\/:quoteId\/create-po/);
  assert.match(source,/Accepted Supplier relationship required before creating a PO/);
  assert.match(source,/source_quote_id/);
  assert.match(source,/price_per_pack_snapshot/);
  assert.match(source,/handling_mode_snapshot/);
  assert.match(source,/status='converted'/);
});
