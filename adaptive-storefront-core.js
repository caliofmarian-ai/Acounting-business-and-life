export const ADAPTIVE_STOREFRONT_VERSION='adaptive-storefront-v2-2026-10-03';

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0;

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
  const unavailable=holdsAvailable?`COALESCE((
    SELECT SUM(h.quantity)
      FROM inventory_unavailable_allocations h
     WHERE h.business_id=${alias}.business_id
       AND h.inventory_id=${alias}.id
       AND h.state='active'
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
    - ${unavailable}
    - ${lotBlocked}
  )`;
}

async function optionalInventoryRelations(db){
  try{
    const q=await db.query("SELECT to_regclass('public.supply_lots') lots_rel, to_regclass('public.inventory_unavailable_allocations') holds_rel");
    return{lots:Boolean(q.rows[0]?.lots_rel),holds:Boolean(q.rows[0]?.holds_rel)};
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code||'')))return{lots:false,holds:false};
    throw error;
  }
}

export async function publicCatalogAttributeMap(db,productIds=[]){
  const ids=[...new Set((productIds||[]).map(Number).filter(positiveInt))];
  const out=new Map(ids.map(id=>[id,{}]));
  if(!ids.length)return out;
  const {rows}=await db.query(`
    SELECT v.product_id,v.attribute_code,v.value_json,
           d.label,d.value_type,d.unit_family
      FROM catalog_product_attribute_values v
      JOIN catalog_attribute_definitions d
        ON d.code=v.attribute_code AND d.public_visible=TRUE
     WHERE v.product_id=ANY($1::bigint[])
     ORDER BY v.product_id,d.label,v.attribute_code
  `,[ids]);
  for(const row of rows){
    const id=Number(row.product_id),current=out.get(id)||{};
    current[row.attribute_code]={
      label:row.label,
      value:row.value_json,
      value_type:row.value_type,
      unit_family:row.unit_family||''
    };
    out.set(id,current);
  }
  return out;
}

export async function publicRetailAvailabilityMap(db,{businessId,productIds=[]}={}){
  const bid=Number(businessId),ids=[...new Set((productIds||[]).map(Number).filter(positiveInt))];
  const out=new Map(ids.map(id=>[id,{orderable:false,state:'unavailable'}]));
  if(!positiveInt(bid)||!ids.length)return out;
  const relations=await optionalInventoryRelations(db);
  const directAvailable=inventoryAvailableSql('i',{lotsAvailable:relations.lots,holdsAvailable:relations.holds});
  const variantAvailable=inventoryAvailableSql('vi',{lotsAvailable:relations.lots,holdsAvailable:relations.holds});
  const {rows}=await db.query(`
    SELECT p.id,
           CASE
             WHEN p.variant_mode THEN EXISTS(
               SELECT 1
                 FROM catalog_product_variants v
                 JOIN inventory vi ON vi.id=v.inventory_id AND vi.business_id=p.business_id
                WHERE v.product_id=p.id
                  AND v.active=TRUE
                  AND (${variantAvailable})>0
             )
             WHEN p.inventory_id IS NOT NULL THEN (${directAvailable})>0
             WHEN p.stock_tracked THEN COALESCE(p.stock_quantity,0)>0
             ELSE TRUE
           END orderable
      FROM marketplace_products p
      LEFT JOIN inventory i ON i.id=p.inventory_id AND i.business_id=p.business_id
     WHERE p.business_id=$1
       AND p.product_domain='non_food'
       AND p.id=ANY($2::bigint[])
  `,[bid,ids]);
  for(const row of rows){
    const orderable=Boolean(row.orderable);
    out.set(Number(row.id),{
      orderable,
      state:orderable?'available':'out_of_stock',
      reason:orderable?'in_stock':'out_of_stock'
    });
  }
  return out;
}

export function publicProductProjection(row,{attributes={},retailAvailability=null}={}){
  if(!row)return null;
  const {
    inventory_id,
    legacy_product_id,
    stock_tracked,
    stock_quantity,
    price_comparison_override,
    catalog_schema_version,
    catalog_review_required,
    package_length_cm,
    package_width_cm,
    package_height_cm,
    package_weight_kg,
    inventory_item_name,
    inventory_quantity,
    inventory_unit,
    inventory_unit_cost,
    internal_sku,
    barcode,
    unit_cost,
    direct_inventory_quantity,
    direct_available_quantity,
    variant_on_hand,
    variant_available,
    ...safe
  }=row;
  const projected={
    ...safe,
    catalog_attributes:attributes&&typeof attributes==='object'?attributes:{}
  };
  if(projected.product_domain==='non_food'){
    projected.orderability=retailAvailability||{orderable:true,state:'available',reason:'legacy_untracked'};
  }
  return projected;
}

function facetValue(value){
  if(value===true)return'Yes';
  if(value===false)return'No';
  if(value==null)return'';
  return clean(value,120);
}

export function retailFacetSummary(products=[]){
  const categoryMap=new Map(),attributeMap=new Map(),variantAxisMap=new Map(),brands=new Set();
  for(const product of Array.isArray(products)?products:[]){
    if(product?.product_domain!=='non_food')continue;
    const category=clean(product.category,100);
    if(category)categoryMap.set(category,(categoryMap.get(category)||0)+1);
    const brand=clean(product.brand,120);if(brand)brands.add(brand);
    for(const [code,entry] of Object.entries(product.catalog_attributes||{})){
      const value=facetValue(entry?.value);
      if(!value)continue;
      const current=attributeMap.get(code)||{code,label:clean(entry?.label,100)||code,unit_family:clean(entry?.unit_family,30),values:new Set()};
      current.values.add(value);attributeMap.set(code,current);
    }
    for(const variant of Array.isArray(product.variants)?product.variants:[]){
      for(const option of Array.isArray(variant.option_values)?variant.option_values:[]){
        const code=clean(option.option_code,80),label=clean(option.option_label,100),value=clean(option.value_label,100);
        if(!code||!value)continue;
        const current=variantAxisMap.get(code)||{code,label:label||code,values:new Set()};
        current.values.add(value);variantAxisMap.set(code,current);
      }
    }
  }
  const attributes=[...attributeMap.values(),...[...variantAxisMap.values()].filter(axis=>!attributeMap.has(axis.code))]
    .map(entry=>({code:entry.code,label:entry.label,unit_family:entry.unit_family||'',values:[...entry.values].sort((a,b)=>a.localeCompare(b)).slice(0,40)}))
    .filter(entry=>entry.values.length>1)
    .slice(0,8);
  return{
    categories:[...categoryMap.entries()].map(([value,count])=>({value,count})).sort((a,b)=>a.value.localeCompare(b.value)),
    brands:[...brands].sort((a,b)=>a.localeCompare(b)).slice(0,80),
    attributes
  };
}

export function storefrontPresentationMode(store={},products=[]){
  const domain=clean(store.merchant_domain,20);
  if(['food','non_food','mixed'].includes(domain))return domain;
  let food=false,retail=false;
  for(const product of Array.isArray(products)?products:[]){
    if(product?.product_domain==='food')food=true;
    if(product?.product_domain==='non_food')retail=true;
  }
  return food&&retail?'mixed':retail?'non_food':'food';
}
