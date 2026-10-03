import {normalizeBarcode} from './inventory-identifiers.js';

export const RETAIL_MERCHANDISING_VERSION='retail-merchandising-v1-2026-10-03';
export const MAX_CATALOG_PAGE_SIZE=100;
export const MAX_BULK_PRODUCTS=200;

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0;
const codeFor=value=>clean(value,100).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70);

export function normalizeCollectionConfiguration(input={}){
  const name=clean(input.name,100);
  if(!name)throw new TypeError('Collection name is required.');
  const code=codeFor(input.code||name);
  if(!code)throw new TypeError('Collection code is required.');
  return{
    name,
    code,
    description:clean(input.description,500),
    active:input.active!==false,
    sort_order:Number.isInteger(Number(input.sort_order))?Number(input.sort_order):0
  };
}

export function normalizeBulkProductIds(values=[]){
  const ids=[...new Set((Array.isArray(values)?values:[]).map(Number).filter(positiveInt))];
  if(!ids.length)throw new TypeError('Choose at least one Catalog product.');
  if(ids.length>MAX_BULK_PRODUCTS)throw new TypeError(`Bulk actions support up to ${MAX_BULK_PRODUCTS} products at a time.`);
  return ids;
}

export async function ensureRetailMerchandisingSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS merchant_catalog_collections (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      collection_type TEXT NOT NULL DEFAULT 'manual',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(collection_type IN ('manual')),
      UNIQUE(business_id,code)
    );
    CREATE INDEX IF NOT EXISTS merchant_catalog_collections_business_idx
      ON merchant_catalog_collections(business_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_catalog_collection_items (
      collection_id BIGINT NOT NULL REFERENCES merchant_catalog_collections(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(collection_id,product_id)
    );
    CREATE INDEX IF NOT EXISTS merchant_catalog_collection_items_product_idx
      ON merchant_catalog_collection_items(product_id,collection_id);
  `);
}

export async function listCatalogCollections(db,{businessId,publicOnly=false}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))return[];
  const {rows}=await db.query(`
    SELECT c.id,c.business_id,c.code,c.name,c.description,c.collection_type,c.active,c.sort_order,
           COUNT(ci.product_id) FILTER(
             WHERE p.id IS NOT NULL
               ${publicOnly?"AND p.active=TRUE AND p.published=TRUE":''}
           )::int item_count,
           COALESCE(
             json_agg(ci.product_id ORDER BY ci.sort_order,ci.product_id)
               FILTER(WHERE p.id IS NOT NULL ${publicOnly?"AND p.active=TRUE AND p.published=TRUE":''}),
             '[]'::json
           ) product_ids
      FROM merchant_catalog_collections c
      LEFT JOIN merchant_catalog_collection_items ci ON ci.collection_id=c.id
      LEFT JOIN marketplace_products p ON p.id=ci.product_id AND p.business_id=c.business_id
     WHERE c.business_id=$1 ${publicOnly?'AND c.active=TRUE':''}
     GROUP BY c.id
     ORDER BY c.sort_order,c.name,c.id
  `,[bid]);
  return rows.map(row=>({
    ...row,
    id:Number(row.id),
    business_id:Number(row.business_id),
    sort_order:Number(row.sort_order||0),
    item_count:Number(row.item_count||0),
    product_ids:(row.product_ids||[]).map(Number)
  }));
}

export async function createCatalogCollection(db,{businessId,configuration}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  const normalized=normalizeCollectionConfiguration(configuration);
  const {rows}=await db.query(`
    INSERT INTO merchant_catalog_collections(
      business_id,code,name,description,collection_type,active,sort_order
    ) VALUES($1,$2,$3,$4,'manual',$5,$6)
    RETURNING *
  `,[bid,normalized.code,normalized.name,normalized.description,normalized.active,normalized.sort_order]);
  return rows[0];
}

export async function updateCatalogCollection(db,{businessId,collectionId,configuration}={}){
  const bid=Number(businessId),cid=Number(collectionId);
  if(!positiveInt(bid)||!positiveInt(cid))throw new TypeError('A valid Catalog collection is required.');
  const normalized=normalizeCollectionConfiguration(configuration);
  const {rows}=await db.query(`
    UPDATE merchant_catalog_collections
       SET code=$1,name=$2,description=$3,active=$4,sort_order=$5,updated_at=NOW()
     WHERE id=$6 AND business_id=$7
     RETURNING *
  `,[normalized.code,normalized.name,normalized.description,normalized.active,normalized.sort_order,cid,bid]);
  if(!rows.length)throw Object.assign(new Error('Collection not found in this business.'),{status:404});
  return rows[0];
}

export async function replaceCollectionProducts(db,{businessId,collectionId,productIds=[]}={}){
  const bid=Number(businessId),cid=Number(collectionId);
  if(!positiveInt(bid)||!positiveInt(cid))throw new TypeError('A valid Catalog collection is required.');
  const collection=await db.query(
    'SELECT id FROM merchant_catalog_collections WHERE id=$1 AND business_id=$2 FOR UPDATE',
    [cid,bid]
  );
  if(!collection.rowCount)throw Object.assign(new Error('Collection not found in this business.'),{status:404});
  const ids=[...new Set((Array.isArray(productIds)?productIds:[]).map(Number).filter(positiveInt))];
  if(ids.length){
    const products=await db.query(`
      SELECT id FROM marketplace_products
       WHERE business_id=$1 AND product_domain='non_food' AND id=ANY($2::bigint[])
    `,[bid,ids]);
    if(products.rowCount!==ids.length){
      throw Object.assign(new Error('Collections can include only Retail products from this business.'),{status:409});
    }
  }
  await db.query('DELETE FROM merchant_catalog_collection_items WHERE collection_id=$1',[cid]);
  for(const [sortOrder,productId] of ids.entries()){
    await db.query(`
      INSERT INTO merchant_catalog_collection_items(collection_id,product_id,sort_order)
      VALUES($1,$2,$3)
    `,[cid,productId,sortOrder]);
  }
  return ids;
}

function inventoryAvailableSql(alias,{lotsAvailable=true,holdsAvailable=true}={}){
  const lotBlocked=lotsAvailable?`COALESCE((
    SELECT SUM(GREATEST(0,sl.quantity_remaining_base))
      FROM supply_lots sl
     WHERE sl.business_id=${alias}.business_id
       AND sl.inventory_id=${alias}.id
       AND sl.quantity_remaining_base>0
       AND (
         COALESCE(sl.lot_state,'available')<>'available'
         OR (sl.expires_at IS NOT NULL AND sl.expires_at<=NOW())
       )
  ),0)`:'0';
  return `GREATEST(0,
    COALESCE(${alias}.quantity,0)
    - COALESCE((
        SELECT SUM(r.quantity_reserved)
          FROM order_stock_reservations r
         WHERE r.business_id=${alias}.business_id
           AND r.stock_kind='inventory'
           AND r.stock_ref_id=${alias}.id
           AND r.state='reserved'
           AND (r.expires_at IS NULL OR r.expires_at>NOW())
      ),0)
    - ${holdsAvailable?`COALESCE((
        SELECT SUM(h.quantity)
          FROM inventory_unavailable_allocations h
         WHERE h.business_id=${alias}.business_id
           AND h.inventory_id=${alias}.id
           AND h.state='active'
      ),0)`:'0'}
    - ${lotBlocked}
  )`;
}

function catalogListFilters(input={}){
  const q=clean(input.q,120);
  const category=clean(input.category,100);
  const status=clean(input.status,30).toLowerCase();
  const stock=clean(input.stock,30).toLowerCase();
  const media=clean(input.media,30).toLowerCase();
  const collectionId=input.collection_id==null||input.collection_id===''?null:Number(input.collection_id);
  const limit=Math.max(1,Math.min(MAX_CATALOG_PAGE_SIZE,Number(input.limit)||50));
  const offset=Math.max(0,Number(input.offset)||0);
  return{
    q,category,
    status:['published','private','archived','all'].includes(status)?status:'all',
    stock:['in_stock','out_of_stock','all'].includes(stock)?stock:'all',
    media:['missing','has_media','all'].includes(media)?media:'all',
    collection_id:positiveInt(collectionId)?collectionId:null,
    limit,offset
  };
}

export async function retailCatalogPage(db,{businessId,filters={}}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  let lotsAvailable=true,holdsAvailable=true;
  try{
    const rel=await db.query("SELECT to_regclass('public.supply_lots') lots_rel, to_regclass('public.inventory_unavailable_allocations') holds_rel");
    lotsAvailable=Boolean(rel.rows[0]?.lots_rel);
    holdsAvailable=Boolean(rel.rows[0]?.holds_rel);
  }catch(error){
    if(!['42P01','42703'].includes(String(error?.code||'')))throw error;
    lotsAvailable=false;holdsAvailable=false;
  }
  const f=catalogListFilters(filters);
  const args=[bid];
  const where=["p.business_id=$1","p.product_domain='non_food'"];
  const add=value=>{args.push(value);return'$'+args.length};

  if(f.q){
    const p=add('%'+f.q+'%');
    where.push(`(
      p.name ILIKE ${p} OR p.brand ILIKE ${p} OR p.model ILIKE ${p} OR p.category ILIKE ${p}
      OR COALESCE(i.internal_sku,'') ILIKE ${p} OR COALESCE(i.barcode,'') ILIKE ${p}
      OR EXISTS(
        SELECT 1
          FROM catalog_product_variants sv
          JOIN inventory svi ON svi.id=sv.inventory_id AND svi.business_id=p.business_id
         WHERE sv.product_id=p.id
           AND (COALESCE(svi.internal_sku,'') ILIKE ${p} OR COALESCE(svi.barcode,'') ILIKE ${p})
      )
    )`);
  }
  if(f.category)where.push(`p.category=${add(f.category)}`);
  if(f.status==='published')where.push('p.active=TRUE AND p.published=TRUE');
  if(f.status==='private')where.push('p.active=TRUE AND p.published=FALSE');
  if(f.status==='archived')where.push('p.active=FALSE');
  if(f.collection_id){
    const p=add(f.collection_id);
    where.push(`EXISTS(
      SELECT 1 FROM merchant_catalog_collection_items ci
       JOIN merchant_catalog_collections c ON c.id=ci.collection_id AND c.business_id=p.business_id
      WHERE ci.product_id=p.id AND ci.collection_id=${p}
    )`);
  }

  const directAvailableExpr=inventoryAvailableSql('i',{lotsAvailable,holdsAvailable});
  const variantAvailableExpr=inventoryAvailableSql('vi',{lotsAvailable,holdsAvailable});
  const sellableExpr=`CASE
    WHEN p.variant_mode THEN EXISTS(
      SELECT 1 FROM catalog_product_variants v
      JOIN inventory vi ON vi.id=v.inventory_id AND vi.business_id=p.business_id
      WHERE v.product_id=p.id AND v.active=TRUE AND (${variantAvailableExpr})>0
    )
    WHEN p.inventory_id IS NOT NULL THEN (${directAvailableExpr})>0
    WHEN p.stock_tracked THEN COALESCE(p.stock_quantity,0)>0
    ELSE TRUE
  END`;
  if(f.stock==='in_stock')where.push('('+sellableExpr+')=TRUE');
  if(f.stock==='out_of_stock')where.push('('+sellableExpr+')=FALSE');

  const hasMediaExpr=`(
    COALESCE(NULLIF(p.image_data_url,''),'')<>''
    OR EXISTS(
      SELECT 1 FROM catalog_product_media cm
       WHERE cm.entity_type='marketplace_product' AND cm.entity_id=p.id
         AND cm.approval_status='approved' AND cm.public_visible=TRUE
    )
  )`;
  if(f.media==='missing')where.push('('+hasMediaExpr+')=FALSE');
  if(f.media==='has_media')where.push('('+hasMediaExpr+')=TRUE');

  const limitParam=add(f.limit),offsetParam=add(f.offset);
  const {rows}=await db.query(`
    SELECT p.*,
           i.item inventory_item_name,i.internal_sku,i.barcode,
           COALESCE(i.quantity,0) direct_inventory_quantity,
           CASE WHEN i.id IS NULL THEN 0 ELSE ${directAvailableExpr} END direct_available_quantity,
           i.unit inventory_unit,
           ${sellableExpr} in_stock,
           ${hasMediaExpr} has_public_media,
           (SELECT COUNT(*)::int FROM catalog_product_variants v WHERE v.product_id=p.id) variant_count,
           (SELECT COUNT(*)::int FROM catalog_product_variants v WHERE v.product_id=p.id AND v.active=TRUE) active_variant_count,
           COALESCE((
             SELECT SUM(COALESCE(vi.quantity,0))
               FROM catalog_product_variants v
               LEFT JOIN inventory vi ON vi.id=v.inventory_id AND vi.business_id=p.business_id
              WHERE v.product_id=p.id AND v.active=TRUE
           ),0) variant_on_hand,
           COALESCE((
             SELECT SUM(${variantAvailableExpr})
               FROM catalog_product_variants v
               JOIN inventory vi ON vi.id=v.inventory_id AND vi.business_id=p.business_id
              WHERE v.product_id=p.id AND v.active=TRUE
           ),0) variant_available,
           COALESCE((
             SELECT json_agg(ci.collection_id ORDER BY ci.collection_id)
               FROM merchant_catalog_collection_items ci
               JOIN merchant_catalog_collections c ON c.id=ci.collection_id AND c.business_id=p.business_id
              WHERE ci.product_id=p.id
           ),'[]'::json) collection_ids,
           COUNT(*) OVER()::int total_count
      FROM marketplace_products p
      LEFT JOIN inventory i ON i.id=p.inventory_id AND i.business_id=p.business_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.active DESC,p.published DESC,p.updated_at DESC,p.id DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}
  `,args);

  return{
    version:RETAIL_MERCHANDISING_VERSION,
    items:rows.map(row=>({
      ...row,
      id:Number(row.id),
      business_id:Number(row.business_id),
      selling_price:Number(row.selling_price),
      quantity_per_unit:Number(row.quantity_per_unit),
      direct_inventory_quantity:Number(row.direct_inventory_quantity||0),
      direct_available_quantity:Number(row.direct_available_quantity||0),
      variant_count:Number(row.variant_count||0),
      active_variant_count:Number(row.active_variant_count||0),
      variant_on_hand:Number(row.variant_on_hand||0),
      variant_available:Number(row.variant_available||0),
      collection_ids:(row.collection_ids||[]).map(Number),
      total_count:Number(row.total_count||0)
    })),
    total:rows.length?Number(rows[0].total_count||0):0,
    limit:f.limit,
    offset:f.offset,
    filters:f
  };
}

async function requireOwnedRetailProducts(db,businessId,productIds,{lock=false}={}){
  const ids=normalizeBulkProductIds(productIds);
  const {rows}=await db.query(`
    SELECT * FROM marketplace_products
     WHERE business_id=$1 AND product_domain='non_food' AND id=ANY($2::bigint[])
     ORDER BY id
     ${lock?'FOR UPDATE':''}
  `,[Number(businessId),ids]);
  if(rows.length!==ids.length)throw Object.assign(new Error('One or more selected Retail products are unavailable in this business.'),{status:409});
  return rows;
}

async function ensureBulkPublishable(db,businessId,rows){
  for(const row of rows){
    if(row.active!==true)throw Object.assign(new Error(`${row.name} is archived. Restore it before publishing.`),{status:409});
    if(row.variant_mode){
      const q=await db.query(`
        SELECT COUNT(*)::int count
          FROM catalog_product_variants v
          JOIN inventory i ON i.id=v.inventory_id AND i.business_id=$2
         WHERE v.product_id=$1 AND v.active=TRUE
      `,[Number(row.id),Number(businessId)]);
      if(Number(q.rows[0]?.count||0)<1){
        throw Object.assign(new Error(`${row.name} needs at least one active Inventory-backed variant before publishing.`),{status:409});
      }
    }else if(row.product_kind==='non_food_resale'&&!row.inventory_id){
      throw Object.assign(new Error(`${row.name} is not linked to Retail Inventory.`),{status:409});
    }
  }
}

export async function applyRetailBulkAction(db,{businessId,productIds,action,value,confirm=false}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  if(confirm!==true)throw Object.assign(new Error('Confirm this bulk Catalog action before applying it.'),{status:400,code:'CATALOG_BULK_CONFIRMATION_REQUIRED'});
  const rows=await requireOwnedRetailProducts(db,bid,productIds,{lock:true});
  const ids=rows.map(row=>Number(row.id));
  const kind=clean(action,40).toLowerCase();

  if(kind==='publish'){
    await ensureBulkPublishable(db,bid,rows);
    await db.query('UPDATE marketplace_products SET published=TRUE,updated_at=NOW() WHERE business_id=$1 AND id=ANY($2::bigint[])',[bid,ids]);
  }else if(kind==='unpublish'){
    await db.query('UPDATE marketplace_products SET published=FALSE,updated_at=NOW() WHERE business_id=$1 AND id=ANY($2::bigint[])',[bid,ids]);
  }else if(kind==='availability'){
    const active=Boolean(value);
    await db.query(`
      UPDATE marketplace_products
         SET active=$1,published=CASE WHEN $1 THEN published ELSE FALSE END,updated_at=NOW()
       WHERE business_id=$2 AND id=ANY($3::bigint[])
    `,[active,bid,ids]);
  }else if(kind==='archive'){
    await db.query('UPDATE marketplace_products SET active=FALSE,published=FALSE,updated_at=NOW() WHERE business_id=$1 AND id=ANY($2::bigint[])',[bid,ids]);
  }else if(kind==='restore'){
    await db.query('UPDATE marketplace_products SET active=TRUE,published=FALSE,updated_at=NOW() WHERE business_id=$1 AND id=ANY($2::bigint[])',[bid,ids]);
  }else if(kind==='category'){
    const category=clean(value,100);
    if(!category)throw new TypeError('Choose a category for the selected products.');
    await db.query('UPDATE marketplace_products SET category=$1,updated_at=NOW() WHERE business_id=$2 AND id=ANY($3::bigint[])',[category,bid,ids]);
  }else if(kind==='collection_add'||kind==='collection_remove'){
    const cid=Number(value);
    if(!positiveInt(cid))throw new TypeError('Choose a valid collection.');
    const collection=await db.query('SELECT id FROM merchant_catalog_collections WHERE id=$1 AND business_id=$2 AND active=TRUE',[cid,bid]);
    if(!collection.rowCount)throw Object.assign(new Error('Collection not found in this business.'),{status:404});
    if(kind==='collection_add'){
      for(const [sortOrder,pid] of ids.entries()){
        await db.query(`
          INSERT INTO merchant_catalog_collection_items(collection_id,product_id,sort_order)
          VALUES($1,$2,$3)
          ON CONFLICT(collection_id,product_id) DO NOTHING
        `,[cid,pid,sortOrder]);
      }
    }else{
      await db.query('DELETE FROM merchant_catalog_collection_items WHERE collection_id=$1 AND product_id=ANY($2::bigint[])',[cid,ids]);
    }
  }else{
    throw new TypeError('Unsupported bulk Catalog action.');
  }

  return{action:kind,product_ids:ids,updated_count:ids.length};
}

export async function scanRetailCatalogBarcode(db,{businessId,barcode}={}){
  const bid=Number(businessId),normalized=normalizeBarcode(barcode);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  if(!normalized)throw new TypeError('Scan or enter a barcode first.');

  const inv=await db.query(`
    SELECT id,business_id,item,internal_sku,barcode,quantity,unit,unit_cost,inventory_domain,stock_role
      FROM inventory
     WHERE business_id=$1 AND barcode=$2
     LIMIT 1
  `,[bid,normalized]);

  if(!inv.rowCount){
    return{
      status:'new_barcode',
      barcode:normalized,
      draft:{
        barcode:normalized,
        product_domain:'non_food',
        product_kind:'non_food_resale',
        requires_inventory:true
      }
    };
  }
  const inventory=inv.rows[0];
  if(inventory.inventory_domain&&inventory.inventory_domain!=='non_food'){
    return{
      status:'inventory_non_retail',
      barcode:normalized,
      inventory:{
        ...inventory,id:Number(inventory.id),business_id:Number(inventory.business_id),
        quantity:Number(inventory.quantity||0),unit_cost:Number(inventory.unit_cost||0)
      }
    };
  }

  const variant=await db.query(`
    SELECT v.id variant_id,v.product_id,v.variant_key,v.price_override,v.active,
           p.name product_name,p.category,p.published,p.active product_active
      FROM catalog_product_variants v
      JOIN marketplace_products p ON p.id=v.product_id AND p.business_id=$1
     WHERE v.inventory_id=$2
     ORDER BY v.active DESC,p.active DESC,v.id
     LIMIT 1
  `,[bid,Number(inventory.id)]);
  if(variant.rowCount){
    return{
      status:'catalog_variant',
      barcode:normalized,
      inventory:{...inventory,id:Number(inventory.id),business_id:Number(inventory.business_id),quantity:Number(inventory.quantity||0),unit_cost:Number(inventory.unit_cost||0)},
      product:{
        id:Number(variant.rows[0].product_id),
        name:variant.rows[0].product_name,
        category:variant.rows[0].category,
        published:Boolean(variant.rows[0].published),
        active:Boolean(variant.rows[0].product_active)
      },
      variant:{
        id:Number(variant.rows[0].variant_id),
        variant_key:variant.rows[0].variant_key,
        price_override:variant.rows[0].price_override==null?null:Number(variant.rows[0].price_override),
        active:Boolean(variant.rows[0].active)
      }
    };
  }

  const direct=await db.query(`
    SELECT id,name,category,selling_price,published,active
      FROM marketplace_products
     WHERE business_id=$1 AND inventory_id=$2 AND product_domain='non_food'
     ORDER BY active DESC,id
     LIMIT 1
  `,[bid,Number(inventory.id)]);
  if(direct.rowCount){
    return{
      status:'catalog_product',
      barcode:normalized,
      inventory:{...inventory,id:Number(inventory.id),business_id:Number(inventory.business_id),quantity:Number(inventory.quantity||0),unit_cost:Number(inventory.unit_cost||0)},
      product:{
        ...direct.rows[0],
        id:Number(direct.rows[0].id),
        selling_price:Number(direct.rows[0].selling_price),
        published:Boolean(direct.rows[0].published),
        active:Boolean(direct.rows[0].active)
      }
    };
  }

  return{
    status:'inventory_only',
    barcode:normalized,
    inventory:{...inventory,id:Number(inventory.id),business_id:Number(inventory.business_id),quantity:Number(inventory.quantity||0),unit_cost:Number(inventory.unit_cost||0)},
    draft:{
      inventory_id:Number(inventory.id),
      barcode:normalized,
      internal_sku:inventory.internal_sku||'',
      name:inventory.item||'',
      product_domain:'non_food',
      product_kind:'non_food_resale',
      requires_inventory:false
    }
  };
}

export async function publicRetailCollections(db,{businessId}={}){
  const collections=await listCatalogCollections(db,{businessId,publicOnly:true});
  return collections.filter(collection=>collection.item_count>0).map(collection=>({
    id:collection.id,
    code:collection.code,
    name:collection.name,
    description:collection.description,
    sort_order:collection.sort_order,
    product_ids:collection.product_ids
  }));
}
