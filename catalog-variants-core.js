const VARIANT_SCHEMA_VERSION='retail-variants-v1-2026-10-03';
const MAX_OPTIONS=3;
const MAX_VARIANTS=500;
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0;
const moneyOrNull=value=>{
  if(value==null||value==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new TypeError('Variant price must be zero or greater.');
  return Math.round((n+Number.EPSILON)*100)/100;
};
const codeFor=value=>clean(value,80).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60);

export {VARIANT_SCHEMA_VERSION,MAX_OPTIONS,MAX_VARIANTS};

export function normalizeVariantConfiguration(input={}){
  const rawOptions=Array.isArray(input?.options)?input.options:[];
  const rawVariants=Array.isArray(input?.variants)?input.variants:[];
  if(!rawOptions.length||rawOptions.length>MAX_OPTIONS)throw new TypeError(`Retail variants need 1–${MAX_OPTIONS} option groups.`);
  if(!rawVariants.length||rawVariants.length>MAX_VARIANTS)throw new TypeError(`Retail variants need 1–${MAX_VARIANTS} sellable combinations.`);

  const optionCodes=new Set();
  const options=rawOptions.map((raw,index)=>{
    const label=clean(raw?.label||raw?.name,80);
    if(!label)throw new TypeError('Every variant option needs a label.');
    const code=codeFor(raw?.code||label);
    if(!code)throw new TypeError(`${label} needs a valid option code.`);
    if(optionCodes.has(code))throw new TypeError(`Variant option ${label} is duplicated.`);
    optionCodes.add(code);
    const rawValues=Array.isArray(raw?.values)?raw.values:[];
    if(!rawValues.length||rawValues.length>100)throw new TypeError(`${label} needs 1–100 values.`);
    const valueCodes=new Set();
    const values=rawValues.map((entry,valueIndex)=>{
      const valueLabel=clean(typeof entry==='string'?entry:(entry?.label||entry?.name),100);
      if(!valueLabel)throw new TypeError(`${label} contains an empty value.`);
      const valueCode=codeFor(typeof entry==='string'?entry:(entry?.code||valueLabel));
      if(!valueCode)throw new TypeError(`${valueLabel} needs a valid value code.`);
      if(valueCodes.has(valueCode))throw new TypeError(`${valueLabel} is duplicated under ${label}.`);
      valueCodes.add(valueCode);
      return{code:valueCode,label:valueLabel,sort_order:valueIndex};
    });
    return{code,label,sort_order:index,values};
  });

  const byOption=new Map(options.map(option=>[option.code,new Set(option.values.map(value=>value.code))]));
  const variantKeys=new Set(),inventoryIds=new Set();
  const variants=rawVariants.map((raw,index)=>{
    const inventoryId=Number(raw?.inventory_id);
    if(!positiveInt(inventoryId))throw new TypeError('Every retail variant must link to a valid Merchant Inventory item.');
    if(inventoryIds.has(inventoryId))throw new TypeError('The same Inventory item cannot back more than one variant of a product.');
    inventoryIds.add(inventoryId);

    const rawValues=raw?.option_values&&typeof raw.option_values==='object'&&!Array.isArray(raw.option_values)?raw.option_values:{};
    const normalizedValues={};
    for(const option of options){
      const selected=codeFor(rawValues[option.code]);
      if(!selected||!byOption.get(option.code)?.has(selected))throw new TypeError(`Choose a valid ${option.label} for every variant.`);
      normalizedValues[option.code]=selected;
    }
    const extras=Object.keys(rawValues).map(codeFor).filter(Boolean).filter(code=>!optionCodes.has(code));
    if(extras.length)throw new TypeError(`${extras[0]} is not a configured variant option.`);
    const variantKey=options.map(option=>`${option.code}=${normalizedValues[option.code]}`).join('|');
    if(variantKeys.has(variantKey))throw new TypeError('The same variant combination cannot be added twice.');
    variantKeys.add(variantKey);
    return{
      variant_key:variantKey,
      inventory_id:inventoryId,
      price_override:moneyOrNull(raw?.price_override),
      active:raw?.active!==false,
      sort_order:index,
      option_values:normalizedValues
    };
  });
  return{version:VARIANT_SCHEMA_VERSION,options,variants};
}

export async function ensureCatalogVariantSchema(db){
  await db.query(`
    ALTER TABLE marketplace_products
      ADD COLUMN IF NOT EXISTS variant_mode BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS catalog_product_options (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id,code)
    );

    CREATE TABLE IF NOT EXISTS catalog_product_option_values (
      id BIGSERIAL PRIMARY KEY,
      option_id BIGINT NOT NULL REFERENCES catalog_product_options(id) ON DELETE CASCADE,
      value_code TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(option_id,value_code)
    );

    CREATE TABLE IF NOT EXISTS catalog_product_variants (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      variant_key TEXT NOT NULL,
      inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,
      price_override NUMERIC(12,2) CHECK(price_override IS NULL OR price_override>=0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id,variant_key)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS catalog_product_variants_inventory_unique
      ON catalog_product_variants(product_id,inventory_id)
      WHERE inventory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS catalog_product_variants_product_idx
      ON catalog_product_variants(product_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS catalog_variant_option_values (
      variant_id BIGINT NOT NULL REFERENCES catalog_product_variants(id) ON DELETE CASCADE,
      option_id BIGINT NOT NULL REFERENCES catalog_product_options(id) ON DELETE CASCADE,
      option_value_id BIGINT NOT NULL REFERENCES catalog_product_option_values(id) ON DELETE CASCADE,
      PRIMARY KEY(variant_id,option_id)
    );

    ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS catalog_variant_id BIGINT REFERENCES catalog_product_variants(id) ON DELETE SET NULL;
    ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS variant_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS order_items_catalog_variant_idx
      ON order_items(catalog_variant_id) WHERE catalog_variant_id IS NOT NULL;
  `);
}

export async function readRetailVariantConfiguration(db,{productId,publicOnly=false}={}){
  const id=Number(productId);
  if(!positiveInt(id))return{version:VARIANT_SCHEMA_VERSION,options:[],variants:[]};
  let lotsAvailable=true,holdsAvailable=true;
  if(publicOnly){
    try{
      const rel=await db.query("SELECT to_regclass('public.supply_lots') lots_rel, to_regclass('public.inventory_unavailable_allocations') holds_rel");
      lotsAvailable=Boolean(rel.rows[0]?.lots_rel);holdsAvailable=Boolean(rel.rows[0]?.holds_rel);
    }catch(error){
      if(!['42P01','42703'].includes(String(error?.code||'')))throw error;
      lotsAvailable=false;holdsAvailable=false;
    }
  }
  const unavailableSql=holdsAvailable?`COALESCE((
    SELECT SUM(h.quantity)
      FROM inventory_unavailable_allocations h
     WHERE h.business_id=p.business_id AND h.inventory_id=i.id AND h.state='active'
  ),0)`:'0';
  const lotBlockedSql=lotsAvailable?`COALESCE((
    SELECT SUM(GREATEST(0,sl.quantity_remaining_base))
      FROM supply_lots sl
     WHERE sl.business_id=p.business_id AND sl.inventory_id=i.id
       AND sl.quantity_remaining_base>0
       AND (COALESCE(sl.lot_state,'available')<>'available' OR (sl.expires_at IS NOT NULL AND sl.expires_at<=NOW()))
  ),0)`:'0';
  const availableSql=`GREATEST(0,
    COALESCE(i.quantity,0)
    - COALESCE((
        SELECT SUM(r.quantity_reserved)
          FROM order_stock_reservations r
         WHERE r.business_id=p.business_id
           AND r.stock_kind='inventory'
           AND r.stock_ref_id=i.id
           AND r.state='reserved'
           AND (r.expires_at IS NULL OR r.expires_at>NOW())
      ),0)
    - ${unavailableSql}
    - ${lotBlockedSql}
  )`;
  const optionsQ=await db.query(`
    SELECT o.id,o.code,o.label,o.sort_order,
           COALESCE(json_agg(json_build_object(
             'id',v.id,'code',v.value_code,'label',v.label,'sort_order',v.sort_order
           ) ORDER BY v.sort_order,v.id) FILTER(WHERE v.id IS NOT NULL),'[]'::json) values
      FROM catalog_product_options o
      LEFT JOIN catalog_product_option_values v ON v.option_id=o.id
     WHERE o.product_id=$1
     GROUP BY o.id
     ORDER BY o.sort_order,o.id
  `,[id]);
  const variantsQ=await db.query(`
    SELECT v.id,v.product_id,v.variant_key,v.inventory_id,v.price_override,v.active,v.sort_order,
           i.item inventory_item,i.internal_sku,i.barcode,i.quantity inventory_quantity,i.unit inventory_unit,
           CASE WHEN i.id IS NULL THEN 0 ELSE ${availableSql} END inventory_available_quantity
      FROM catalog_product_variants v
      JOIN marketplace_products p ON p.id=v.product_id
      LEFT JOIN inventory i ON i.id=v.inventory_id AND i.business_id=p.business_id
     WHERE v.product_id=$1 ${publicOnly?'AND v.active=TRUE':''}
     ORDER BY v.sort_order,v.id
  `,[id]);
  const variantIds=variantsQ.rows.map(row=>Number(row.id));
  let selections=[];
  if(variantIds.length){
    const selected=await db.query(`
      SELECT x.variant_id,o.code option_code,o.label option_label,
             v.value_code,v.label value_label
        FROM catalog_variant_option_values x
        JOIN catalog_product_options o ON o.id=x.option_id
        JOIN catalog_product_option_values v ON v.id=x.option_value_id
       WHERE x.variant_id=ANY($1::bigint[])
       ORDER BY x.variant_id,o.sort_order,o.id
    `,[variantIds]);
    selections=selected.rows;
  }
  const byVariant=new Map();
  for(const row of selections){
    const list=byVariant.get(Number(row.variant_id))||[];
    list.push({option_code:row.option_code,option_label:row.option_label,value_code:row.value_code,value_label:row.value_label});
    byVariant.set(Number(row.variant_id),list);
  }
  const variants=variantsQ.rows.map(row=>{
    const base={
      id:Number(row.id),
      variant_key:row.variant_key,
      price_override:row.price_override==null?null:Number(row.price_override),
      active:Boolean(row.active),
      option_values:byVariant.get(Number(row.id))||[]
    };
    if(publicOnly)return{
      ...base,
      in_stock:Boolean(row.inventory_id)&&Number(row.inventory_available_quantity||0)>0
    };
    return{
      ...base,
      inventory_id:row.inventory_id==null?null:Number(row.inventory_id),
      inventory_item:row.inventory_item||'',
      internal_sku:row.internal_sku||'',
      barcode:row.barcode||'',
      inventory_quantity:Number(row.inventory_quantity||0),
      inventory_available_quantity:Number(row.inventory_available_quantity||0),
      inventory_unit:row.inventory_unit||''
    };
  });
  return{
    version:VARIANT_SCHEMA_VERSION,
    options:optionsQ.rows.map(row=>({
      id:Number(row.id),code:row.code,label:row.label,sort_order:Number(row.sort_order||0),
      values:(row.values||[]).map(value=>({...value,id:Number(value.id),sort_order:Number(value.sort_order||0)}))
    })),
    variants
  };
}

export async function replaceRetailVariantConfiguration(db,{businessId,productId,configuration}={}){
  const bid=Number(businessId),pid=Number(productId);
  if(!positiveInt(bid)||!positiveInt(pid))throw new TypeError('A valid Merchant product is required.');
  const normalized=normalizeVariantConfiguration(configuration);
  const inventoryIds=normalized.variants.map(row=>row.inventory_id);
  const inv=await db.query(`
    SELECT id,item,internal_sku,barcode,quantity,unit
      FROM inventory
     WHERE business_id=$1 AND id=ANY($2::bigint[])
     ORDER BY id
     FOR SHARE
  `,[bid,inventoryIds]);
  if(inv.rowCount!==inventoryIds.length)throw Object.assign(new Error('One or more variant Inventory items are not available in this business.'),{status:409});

  const optionIds=new Map(),valueIds=new Map();
  for(const option of normalized.options){
    const saved=await db.query(`
      INSERT INTO catalog_product_options(product_id,code,label,sort_order)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(product_id,code) DO UPDATE SET label=EXCLUDED.label,sort_order=EXCLUDED.sort_order,updated_at=NOW()
      RETURNING id
    `,[pid,option.code,option.label,option.sort_order]);
    const optionId=Number(saved.rows[0].id);optionIds.set(option.code,optionId);
    for(const value of option.values){
      const v=await db.query(`
        INSERT INTO catalog_product_option_values(option_id,value_code,label,sort_order)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(option_id,value_code) DO UPDATE SET label=EXCLUDED.label,sort_order=EXCLUDED.sort_order,updated_at=NOW()
        RETURNING id
      `,[optionId,value.code,value.label,value.sort_order]);
      valueIds.set(`${option.code}:${value.code}`,Number(v.rows[0].id));
    }
  }

  const activeKeys=[];
  for(const variant of normalized.variants){
    const saved=await db.query(`
      INSERT INTO catalog_product_variants(product_id,variant_key,inventory_id,price_override,active,sort_order)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(product_id,variant_key) DO UPDATE SET
        inventory_id=EXCLUDED.inventory_id,price_override=EXCLUDED.price_override,
        active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,updated_at=NOW()
      RETURNING id
    `,[pid,variant.variant_key,variant.inventory_id,variant.price_override,variant.active,variant.sort_order]);
    const variantId=Number(saved.rows[0].id);activeKeys.push(variant.variant_key);
    await db.query('DELETE FROM catalog_variant_option_values WHERE variant_id=$1',[variantId]);
    for(const option of normalized.options){
      await db.query(`
        INSERT INTO catalog_variant_option_values(variant_id,option_id,option_value_id)
        VALUES($1,$2,$3)
      `,[variantId,optionIds.get(option.code),valueIds.get(`${option.code}:${variant.option_values[option.code]}`)]);
    }
  }
  await db.query(`
    UPDATE catalog_product_variants
       SET active=FALSE,updated_at=NOW()
     WHERE product_id=$1 AND NOT (variant_key=ANY($2::text[]))
  `,[pid,activeKeys]);
  await db.query(`
    UPDATE marketplace_products
       SET variant_mode=TRUE,inventory_id=NULL,stock_tracked=FALSE,stock_quantity=NULL,updated_at=NOW()
     WHERE id=$1 AND business_id=$2
  `,[pid,bid]);
  return readRetailVariantConfiguration(db,{productId:pid,publicOnly:false});
}

export async function variantProjectionForProducts(db,{productIds=[],publicOnly=false}={}){
  const ids=[...new Set((productIds||[]).map(Number).filter(positiveInt))];
  const out=new Map(ids.map(id=>[id,[]]));
  for(const id of ids){
    const config=await readRetailVariantConfiguration(db,{productId:id,publicOnly});
    out.set(id,config.variants);
  }
  return out;
}
