import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-supplier-domain-v2.js',import.meta.url),'utf8');

test('Supplier V2 schema keeps operational activities business-scoped',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS supplier_business_activities/);
  assert.match(server,/business_id BIGINT NOT NULL REFERENCES businesses/);
  for(const code of ['producer','repacker','importer','wholesaler','retailer']){
    assert.match(server,new RegExp("'"+code+"'"));
  }
});

test('external suppliers can exist before a connected Supplier account',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS merchant_supply_parties/);
  assert.match(server,/source_type TEXT NOT NULL DEFAULT 'external'/);
  assert.match(server,/supplier_account_id BIGINT REFERENCES accounts/);
  assert.match(server,/app\.post\('\/api\/procurement\/supply-parties'/);
  assert.match(server,/Accepted Supplier relationship required before connecting this record/);
  assert.match(server,/UPDATE supply_lots SET supply_party_id=/);
});

test('catalog V2 stores handling mode package hierarchy and quantity price tiers',()=>{
  assert.match(server,/ADD COLUMN IF NOT EXISTS handling_mode/);
  assert.match(server,/supplier_catalog_price_tiers/);
  assert.match(server,/supplier_catalog_package_levels/);
  assert.match(server,/minimum_quantity NUMERIC/);
  assert.match(server,/base_units_per_level NUMERIC/);
  assert.match(server,/app\.put\('\/api\/supplier\/catalog\/:id\/v2'/);
});

test('lots preserve source, quantity, unit cost and expiry evidence',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS supply_lots/);
  assert.match(server,/supplier_lot_code/);
  assert.match(server,/quantity_remaining_base/);
  assert.match(server,/unit_cost_base/);
  assert.match(server,/expires_at/);
  assert.match(server,/internal_lot_code/);
});

test('repack path locks the source lot and records a child lot plus operation',()=>{
  assert.match(server,/FOR UPDATE/);
  assert.match(server,/computeRepackPlan/);
  assert.match(server,/parent_lot_id/);
  assert.match(server,/handling_mode.*repacked/s);
  assert.match(server,/CREATE TABLE IF NOT EXISTS supply_repack_operations/);
  assert.match(server,/quantity_remaining_base=quantity_remaining_base-\$1/);
  assert.match(server,/inheritedExpiry/);
});

test('Supplier V2 reads exact active profile-business bindings rather than guessing ownership',()=>{
  assert.match(server,/FROM profile_business_bindings pb/);
  assert.match(server,/pb\.account_id=\$1/);
  assert.match(server,/pb\.role=\$2/);
  assert.match(server,/pb\.status='active'/);
  assert.match(server,/business_memberships bm/);
});
