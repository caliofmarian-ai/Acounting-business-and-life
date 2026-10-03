import {CATALOG_V3_SCHEMA_VERSION} from './catalog-v3-core.js';

export const CATALOG_MIGRATION_CONTRACT_VERSION='catalog-migration-contract-v1-2026-10-03';

const clean=(value,max=120)=>String(value??'').trim().slice(0,max);

export function legacyCatalogCategory(row={}){
  const domain=clean(row.product_domain,20);
  const kind=clean(row.product_kind,40);
  if(domain==='non_food')return'general_retail';
  if(kind==='prepared_food')return'prepared_food';
  if(kind==='fresh_direct')return'fresh_food';
  if(kind==='packaged_resale')return'packaged_food_drink';
  return null;
}

export function catalogCompatibilityProjection(row={}){
  const fallback=legacyCatalogCategory(row);
  return{
    ...row,
    catalog_category_code:row.catalog_category_code||fallback,
    catalog_schema_version:row.catalog_schema_version||CATALOG_V3_SCHEMA_VERSION
  };
}

export async function ensureCatalogMigrationContract(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS catalog_migration_versions (
      version TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    INSERT INTO catalog_migration_versions(version,schema_version,metadata_json)
    VALUES($1,$2,$3::jsonb)
    ON CONFLICT(version) DO NOTHING
  `,[
    CATALOG_MIGRATION_CONTRACT_VERSION,
    CATALOG_V3_SCHEMA_VERSION,
    JSON.stringify({
      strategy:'additive_backfill',
      preserves:[
        'marketplace_products.id',
        'marketplace_products.legacy_product_id',
        'marketplace_products.inventory_id',
        'marketplace_products.selling_price',
        'marketplace_products.published',
        'order_items snapshots'
      ],
      category_mapping:{
        prepared_food:'prepared_food',
        fresh_direct:'fresh_food',
        packaged_resale:'packaged_food_drink',
        non_food:'general_retail'
      }
    })
  ]);

  await db.query(`
    UPDATE marketplace_products
       SET catalog_category_code=CASE
         WHEN product_domain='non_food' THEN 'general_retail'
         WHEN product_kind='prepared_food' THEN 'prepared_food'
         WHEN product_kind='fresh_direct' THEN 'fresh_food'
         WHEN product_kind='packaged_resale' THEN 'packaged_food_drink'
         ELSE catalog_category_code
       END,
       updated_at=updated_at
     WHERE (catalog_category_code IS NULL OR catalog_category_code='')
       AND (
         product_domain='non_food'
         OR product_kind IN ('prepared_food','fresh_direct','packaged_resale')
       )
  `);

  await db.query(`
    UPDATE marketplace_products
       SET catalog_schema_version=$1,
           updated_at=updated_at
     WHERE COALESCE(catalog_schema_version,'')=''
  `,[CATALOG_V3_SCHEMA_VERSION]);
}

export async function catalogMigrationEvidence(db){
  const productQ=await db.query(`
    SELECT
      COUNT(*)::int total_products,
      COUNT(DISTINCT id)::int distinct_product_ids,
      COUNT(*) FILTER(WHERE product_domain='food')::int food_products,
      COUNT(*) FILTER(WHERE product_domain='non_food')::int non_food_products,
      COUNT(*) FILTER(WHERE catalog_category_code IS NULL OR catalog_category_code='')::int unmapped_products,
      COUNT(*) FILTER(WHERE COALESCE(catalog_schema_version,'')='')::int unversioned_products,
      COUNT(*) FILTER(WHERE legacy_product_id IS NOT NULL)::int legacy_linked_products,
      COUNT(*) FILTER(WHERE inventory_id IS NOT NULL)::int inventory_linked_products
      FROM marketplace_products
  `);

  const orderQ=await db.query(`
    SELECT
      COUNT(*) FILTER(WHERE source_kind='marketplace_product')::int marketplace_order_items,
      COUNT(*) FILTER(
        WHERE source_kind='marketplace_product'
          AND (
            COALESCE(name_snapshot,'')=''
            OR unit_price_snapshot IS NULL
            OR unit_cost_snapshot IS NULL
          )
      )::int marketplace_order_items_missing_core_snapshot
      FROM order_items
  `);

  const ownershipQ=await db.query(`
    SELECT
      (
        SELECT COUNT(*)::int
          FROM marketplace_products p
          JOIN inventory i ON i.id=p.inventory_id
         WHERE p.business_id<>i.business_id
      ) inventory_business_mismatches,
      (
        SELECT COUNT(*)::int
          FROM marketplace_products p
          JOIN products lp ON lp.id=p.legacy_product_id
         WHERE p.business_id<>lp.business_id
      ) legacy_product_business_mismatches
  `);

  const mediaQ=await db.query(`
    SELECT
      COUNT(*) FILTER(WHERE cm.entity_type='marketplace_product')::int marketplace_media_rows,
      COUNT(*) FILTER(
        WHERE cm.entity_type='marketplace_product'
          AND p.id IS NULL
      )::int orphan_marketplace_media_rows
      FROM catalog_product_media cm
      LEFT JOIN marketplace_products p
        ON cm.entity_type='marketplace_product' AND p.id=cm.entity_id
  `);

  const versionQ=await db.query(`
    SELECT version,schema_version,applied_at
      FROM catalog_migration_versions
     WHERE version=$1
  `,[CATALOG_MIGRATION_CONTRACT_VERSION]);

  const products=productQ.rows[0]||{};
  const orders=orderQ.rows[0]||{};
  const ownership=ownershipQ.rows[0]||{};
  const media=mediaQ.rows[0]||{};
  return{
    version:CATALOG_MIGRATION_CONTRACT_VERSION,
    schema_version:CATALOG_V3_SCHEMA_VERSION,
    marker:versionQ.rows[0]||null,
    products:{
      total:Number(products.total_products||0),
      distinct_ids:Number(products.distinct_product_ids||0),
      food:Number(products.food_products||0),
      non_food:Number(products.non_food_products||0),
      unmapped:Number(products.unmapped_products||0),
      unversioned:Number(products.unversioned_products||0),
      legacy_linked:Number(products.legacy_linked_products||0),
      inventory_linked:Number(products.inventory_linked_products||0)
    },
    orders:{
      marketplace_items:Number(orders.marketplace_order_items||0),
      missing_core_snapshot:Number(orders.marketplace_order_items_missing_core_snapshot||0)
    },
    ownership:{
      inventory_business_mismatches:Number(ownership.inventory_business_mismatches||0),
      legacy_product_business_mismatches:Number(ownership.legacy_product_business_mismatches||0)
    },
    media:{
      marketplace_rows:Number(media.marketplace_media_rows||0),
      orphan_rows:Number(media.orphan_marketplace_media_rows||0)
    },
    safe:
      Number(products.total_products||0)===Number(products.distinct_product_ids||0)
      && Number(products.unversioned_products||0)===0
      && Number(ownership.inventory_business_mismatches||0)===0
      && Number(ownership.legacy_product_business_mismatches||0)===0
  };
}

export async function catalogMigrationContractReady(db,{logger=console.log}={}){
  await ensureCatalogMigrationContract(db);
  const evidence=await catalogMigrationEvidence(db);
  logger('CATALOG_MIGRATION_CONTRACT_READY '+JSON.stringify(evidence));
  return evidence;
}
