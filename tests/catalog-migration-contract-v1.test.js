import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CATALOG_MIGRATION_CONTRACT_VERSION,
  legacyCatalogCategory,
  catalogCompatibilityProjection,
  ensureCatalogMigrationContract,
  catalogMigrationEvidence
} from '../catalog-migration-contract-core.js';
import {CATALOG_V3_SCHEMA_VERSION} from '../catalog-v3-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('legacy product mapping is deterministic without rewriting legacy classification',()=>{
  assert.equal(legacyCatalogCategory({product_domain:'food',product_kind:'prepared_food'}),'prepared_food');
  assert.equal(legacyCatalogCategory({product_domain:'food',product_kind:'fresh_direct'}),'fresh_food');
  assert.equal(legacyCatalogCategory({product_domain:'food',product_kind:'packaged_resale'}),'packaged_food_drink');
  assert.equal(legacyCatalogCategory({product_domain:'non_food',product_kind:'non_food_resale'}),'general_retail');
  assert.equal(legacyCatalogCategory({product_domain:'food',product_kind:'unknown'}),null);
});

test('compatibility projection adds V3 metadata while preserving canonical IDs and legacy fields',()=>{
  const legacy={
    id:91,business_id:4,legacy_product_id:13,inventory_id:77,
    name:'Legacy product',category:'Old shelf',selling_price:'199.00',
    product_domain:'non_food',product_kind:'non_food_resale',published:true,active:true,
    catalog_category_code:null,catalog_schema_version:''
  };
  const projected=catalogCompatibilityProjection(legacy);
  assert.equal(projected.id,91);
  assert.equal(projected.business_id,4);
  assert.equal(projected.legacy_product_id,13);
  assert.equal(projected.inventory_id,77);
  assert.equal(projected.name,'Legacy product');
  assert.equal(projected.category,'Old shelf');
  assert.equal(projected.selling_price,'199.00');
  assert.equal(projected.published,true);
  assert.equal(projected.catalog_category_code,'general_retail');
  assert.equal(projected.catalog_schema_version,CATALOG_V3_SCHEMA_VERSION);
});

test('migration is additive, idempotent and writes marker only after backfill statements',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureCatalogMigrationContract(db);

  assert.equal(CATALOG_MIGRATION_CONTRACT_VERSION,'catalog-migration-contract-v1-2026-10-03');
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS catalog_migration_versions/);

  const categoryIndex=calls.findIndex(x=>/UPDATE marketplace_products[\s\S]*catalog_category_code=CASE/.test(x.sql));
  const schemaIndex=calls.findIndex(x=>/UPDATE marketplace_products[\s\S]*catalog_schema_version=\$1/.test(x.sql));
  const markerIndex=calls.findIndex(x=>/INSERT INTO catalog_migration_versions/.test(x.sql));
  assert.ok(categoryIndex>0);
  assert.ok(schemaIndex>categoryIndex);
  assert.ok(markerIndex>schemaIndex);

  const allSql=calls.map(x=>x.sql).join('\n');
  assert.doesNotMatch(allSql,/\bDELETE\s+FROM\s+marketplace_products\b/i);
  assert.doesNotMatch(allSql,/\bTRUNCATE\b/i);
  assert.doesNotMatch(allSql,/DROP\s+TABLE\s+marketplace_products/i);
  assert.doesNotMatch(allSql,/SET\s+(id|legacy_product_id|inventory_id|selling_price|published)\s*=/i);
  assert.match(allSql,/updated_at=updated_at/);
  assert.match(allSql,/ON CONFLICT\(version\) DO NOTHING/);
});

test('migration evidence is explicit and detects ownership/snapshot regressions',async()=>{
  const queries=[];
  const db={query:async(sql,args=[])=>{
    const s=String(sql);queries.push({sql:s,args});
    if(/COUNT\(DISTINCT id\)/.test(s))return{rows:[{
      total_products:5,distinct_product_ids:5,food_products:3,non_food_products:2,
      unmapped_products:0,unversioned_products:0,legacy_linked_products:2,inventory_linked_products:3
    }],rowCount:1};
    if(/marketplace_order_items_missing_core_snapshot/.test(s))return{rows:[{
      marketplace_order_items:8,marketplace_order_items_missing_core_snapshot:0
    }],rowCount:1};
    if(/inventory_business_mismatches/.test(s))return{rows:[{
      inventory_business_mismatches:0,legacy_product_business_mismatches:0
    }],rowCount:1};
    if(/orphan_marketplace_media_rows/.test(s))return{rows:[{
      marketplace_media_rows:4,orphan_marketplace_media_rows:0
    }],rowCount:1};
    if(/FROM catalog_migration_versions/.test(s))return{rows:[{
      version:CATALOG_MIGRATION_CONTRACT_VERSION,schema_version:CATALOG_V3_SCHEMA_VERSION,applied_at:'2026-10-03T00:00:00Z'
    }],rowCount:1};
    throw new Error('unexpected query');
  }};
  const evidence=await catalogMigrationEvidence(db);
  assert.equal(evidence.safe,true);
  assert.equal(evidence.products.total,5);
  assert.equal(evidence.orders.marketplace_items,8);
  assert.equal(evidence.ownership.inventory_business_mismatches,0);
  assert.equal(evidence.media.orphan_rows,0);
  assert.equal(queries.length,5);
});

test('Marketplace startup applies and logs Catalog migration contract after additive schemas',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/catalogMigrationContractReady/);
  const schemaPos=server.indexOf('ensureCatalogV3Schema(pool)');
  const migrationPos=server.indexOf('catalogMigrationContractReady(pool)');
  assert.ok(schemaPos>=0&&migrationPos>schemaPos);
  assert.match(server,/rows\.map\(catalogCompatibilityProjection\)/);
});

test('legacy prepared-product import keeps IDs and adds Catalog V3 metadata in both runtime owners',()=>{
  const marketplace=read('server-marketplace.js');
  const accounting=read('server-business-accounting.js');
  for(const source of [marketplace,accounting]){
    assert.match(source,/catalog_category_code,catalog_schema_version/);
    assert.match(source,/'prepared_food',\$2/);
    assert.match(source,/ON CONFLICT\(business_id,legacy_product_id\)/);
    assert.match(source,/catalog_category_code=COALESCE\(marketplace_products\.catalog_category_code/);
    assert.match(source,/catalog_schema_version=CASE/);
  }
});

test('historical Marketplace orders preserve name price cost variant and modifier snapshots',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/INSERT INTO order_items\([\s\S]*name_snapshot,category_snapshot,quantity,unit_price_snapshot,unit_cost_snapshot/);
  assert.match(server,/variant_snapshot_json,modifier_snapshot_json/);
  assert.match(server,/x\.nameSnapshot/);
  assert.match(server,/x\.unitPrice/);
  assert.match(server,/x\.unitCost/);
  assert.doesNotMatch(server,/UPDATE order_items SET[\s\S]*unit_price_snapshot/i);
});

test('prepared recipe and direct resale stock contracts remain linked through legacy and Inventory IDs',()=>{
  const reservation=read('order-stock-reservation.js');
  assert.match(reservation,/legacy_product_id,inventory_id,quantity_per_unit,variant_mode/);
  assert.match(reservation,/product\.legacy_product_id/);
  assert.match(reservation,/product\.inventory_id/);
  assert.match(reservation,/quantity_per_unit/);
  assert.match(reservation,/source_kind='marketplace_product'/);
});

test('Supplier receiving remains business-scoped and does not resolve stock by catalog name',()=>{
  const accounting=read('server-business-accounting.js');
  assert.match(accounting,/SELECT id,item,unit,base_unit,measurement_family FROM inventory WHERE id=\$1 AND business_id=\$2 FOR UPDATE/);
  assert.match(accounting,/Linked inventory item does not belong to this business/);
  assert.match(accounting,/UPDATE inventory SET quantity=quantity\+\$1,unit_cost=\$2,updated_at=NOW\(\) WHERE id=\$3 AND business_id=\$4/);
});

test('Product Media remains attached to stable marketplace product IDs',()=>{
  const media=read('catalog-media-core.js');
  const marketplace=read('server-marketplace.js');
  assert.match(media,/entity_type='marketplace_product'/);
  assert.match(media,/entity_id=ANY\(\$2::bigint\[\]\)/);
  assert.match(marketplace,/mediaForEntities\(pool,\{entityType:'marketplace_product',entityIds:rows\.map\(x=>x\.id\)/);
});

test('migration contract does not expose private Catalog migration metadata publicly',()=>{
  const adaptive=read('adaptive-storefront-core.js');
  assert.match(adaptive,/catalog_schema_version,/);
  assert.match(adaptive,/catalog_review_required,/);
  assert.match(adaptive,/inventory_id,/);
  assert.match(adaptive,/legacy_product_id,/);
});

test('package syntax contract includes Catalog migration contract core and regression gates',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check catalog-migration-contract-core\.js/);
  assert.match(pkg,/node --check tests\/catalog-migration-contract-v1\.test\.js/);
});
