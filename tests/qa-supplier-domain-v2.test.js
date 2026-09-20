import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier Domain V2 acceptance wave is registered',()=>{
  assert.match(source,/SUPPLIER_DOMAIN_V2_WAVE='supplier_domain_v2'/);
  assert.match(source,/runSupplierDomainV2Acceptance/);
  assert.match(source,/config\.wave===SUPPLIER_DOMAIN_V2_WAVE/);
});

test('Supplier Domain V2 acceptance preserves V1 as a prerequisite',()=>{
  assert.match(source,/runSupplierExperienceAcceptance\(\{pool,base,secret\}\)/);
  assert.match(source,/Supplier V1 prerequisite did not pass/);
});

test('Supplier Domain V2 acceptance covers external supplier, tier PO and repack lineage',()=>{
  assert.match(source,/\/api\/procurement\/supply-parties/);
  assert.match(source,/\/api\/supplier\/catalog\/\$\{Number\(tierItem\.id\)\}\/v2/);
  assert.match(source,/tier_price_snapshot:true/);
  assert.match(source,/\/api\/procurement\/supply-lots\/\$\{Number\(sourceLot\.json\.id\)\}\/repack/);
  assert.match(source,/quantity_conservation:true/);
  assert.match(source,/expiry_lineage:true/);
  assert.match(source,/output_inventory_quantity:49000/);
});
