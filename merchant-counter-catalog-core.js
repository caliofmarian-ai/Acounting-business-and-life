import {variantProjectionForProducts} from './catalog-variants-core.js';
import {effectiveFoodAvailability,modifierProjectionForProducts,menuScheduleActive,validateProductModifierSelections} from './food-menu-core.js';

const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0;
const money=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const unavailable=message=>Object.assign(new Error(message),{status:409});

// This is an authenticated Merchant surface. Publication belongs to public
// discovery/checkout and is deliberately not a counter-sale eligibility rule.
export async function merchantCounterCatalog(db,{businessId,now=new Date()}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw Object.assign(new Error('A valid business_id is required'),{status:400});
  const canonical=await db.query(`
    SELECT p.id,p.name,p.category,p.selling_price,p.active,p.published,
           p.product_domain,p.product_kind,p.variant_mode,p.availability_state,
           p.availability_until,p.availability_note,COALESCE(i.unit_cost*p.quantity_per_unit,0) unit_cost
      FROM marketplace_products p
      LEFT JOIN inventory i ON i.id=p.inventory_id AND i.business_id=p.business_id
     WHERE p.business_id=$1 AND p.active=TRUE
     ORDER BY p.category,p.name,p.id
  `,[bid]);
  const legacy=await db.query(`
    SELECT p.id,p.name,p.category,p.selling_price,p.active,
           COALESCE(SUM(r.quantity*i.unit_cost),0) unit_cost
      FROM products p
      LEFT JOIN recipes r ON r.product_id=p.id
      LEFT JOIN inventory i ON i.id=r.inventory_id AND i.business_id=p.business_id
     WHERE p.business_id=$1 AND p.active=TRUE
       AND NOT EXISTS(SELECT 1 FROM marketplace_products cp
                       WHERE cp.business_id=p.business_id AND cp.legacy_product_id=p.id)
     GROUP BY p.id ORDER BY p.category,p.name,p.id
  `,[bid]);
  const variants=await variantProjectionForProducts(db,{productIds:canonical.rows.filter(row=>row.variant_mode).map(row=>Number(row.id)),publicOnly:true});
  const modifiers=await modifierProjectionForProducts(db,{businessId:bid,productIds:canonical.rows.filter(row=>row.product_domain==='food').map(row=>Number(row.id)),publicOnly:true});
  const foodIds=canonical.rows.filter(row=>row.product_domain==='food').map(row=>Number(row.id));
  const memberships=new Map(foodIds.map(id=>[id,[]])),scheduleCache=new Map();
  if(foodIds.length){
    const links=await db.query(`
      SELECT DISTINCT mi.product_id,m.id
        FROM merchant_menu_items mi
        JOIN merchant_menu_sections s ON s.id=mi.section_id AND s.active=TRUE
        JOIN merchant_menus m ON m.id=s.menu_id AND m.business_id=$1 AND m.active=TRUE
       WHERE mi.product_id=ANY($2::bigint[]) AND mi.active=TRUE
    `,[bid,foodIds]);
    for(const link of links.rows)memberships.get(Number(link.product_id))?.push(Number(link.id));
  }
  const projected=await Promise.all(canonical.rows.map(async row=>{
    const availability=row.product_domain==='food'
      ?await counterFoodOrderability(db,row,bid,{menuIds:memberships.get(Number(row.id)),scheduleCache,now})
      :{available:true,blocked_reason:''};
    return{
      id:Number(row.id),source_kind:'marketplace_product',name:row.name,category:row.category,
      selling_price:Number(row.selling_price),unit_cost:Number(row.unit_cost),active:true,
      published:Boolean(row.published),product_domain:row.product_domain,product_kind:row.product_kind,
      variant_mode:Boolean(row.variant_mode),variants:variants.get(Number(row.id))||[],
      modifier_groups:modifiers.get(Number(row.id))||[],
      ...availability
    };
  }));
  return[
    ...projected,
    ...legacy.rows.map(row=>({...row,id:Number(row.id),source_kind:'product',available:true,variants:[],modifier_groups:[]}))
  ].sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''))||String(a.name).localeCompare(String(b.name))||a.source_kind.localeCompare(b.source_kind)||a.id-b.id);
}

async function recipeCost(db,productId,businessId){
  const cost=await db.query(`SELECT COALESCE(SUM(r.quantity*i.unit_cost),0) unit_cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 AND i.business_id=$2`,[productId,businessId]);
  return Number(cost.rows[0]?.unit_cost||0);
}

async function counterFoodOrderability(db,row,businessId,{menuIds=null,scheduleCache=new Map(),now=new Date()}={}){
  const availability=effectiveFoodAvailability(row,now);
  if(!availability.orderable)return{available:false,blocked_reason:availability.state};
  if(menuIds==null){
    const memberships=await db.query(`
      SELECT DISTINCT m.id
        FROM merchant_menu_items mi
        JOIN merchant_menu_sections s ON s.id=mi.section_id AND s.active=TRUE
        JOIN merchant_menus m ON m.id=s.menu_id AND m.business_id=$2 AND m.active=TRUE
       WHERE mi.product_id=$1 AND mi.active=TRUE
    `,[Number(row.id),businessId]);
    menuIds=memberships.rows.map(menu=>Number(menu.id));
  }
  if(!menuIds.length)return{available:true,blocked_reason:''};
  for(const id of menuIds){
    if(!scheduleCache.has(id))scheduleCache.set(id,db.query(`
      SELECT day_of_week,start_time::text,end_time::text,active
        FROM merchant_menu_schedules WHERE menu_id=$1 AND active=TRUE
        ORDER BY sort_order,id
    `,[id]).then(result=>result.rows));
    if(menuScheduleActive(await scheduleCache.get(id),now))return{available:true,blocked_reason:''};
  }
  return{available:false,blocked_reason:'outside_menu_schedule'};
}

export async function merchantCounterSnapshots(db,{businessId,items,now=new Date()}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw Object.assign(new Error('A valid Merchant business is required'),{status:400});
  if(!Array.isArray(items)||!items.length||items.length>50)throw Object.assign(new Error('Order needs 1–50 items'),{status:400});
  const lines=new Map();
  for(const raw of items){
    let id=Number(raw?.product_id);const quantity=Number(raw?.quantity);
    // Older clients send legacy IDs without a kind. Their meaning stays legacy;
    // a canonical ID is never guessed from a colliding numeric value.
    let source=raw?.source_kind==null?'product':String(raw.source_kind);
    const variant=raw?.variant_id==null?null:Number(raw.variant_id);
    const modifiers=(Array.isArray(raw?.modifier_option_ids)?raw.modifier_option_ids:[]).map(Number).sort((a,b)=>a-b);
    if(!positiveInt(id)||!Number.isFinite(quantity)||quantity<=0||!['product','marketplace_product'].includes(source)||
       (variant!=null&&!positiveInt(variant))||modifiers.some(id=>!positiveInt(id))||new Set(modifiers).size!==modifiers.length){
      throw Object.assign(new Error('Every item needs a valid product, source, quantity and options'),{status:400});
    }
    if(source==='product'){
      // Preserve old Merchant clients through the explicit legacy relation. This
      // cannot confuse equal numeric IDs, and imported items still obey current
      // Catalog availability, prices and option rules.
      const imported=await db.query('SELECT id,active FROM marketplace_products WHERE business_id=$1 AND legacy_product_id=$2',[bid,id]);
      if(imported.rowCount){
        if(imported.rows[0].active!==true)throw unavailable('One or more products are unavailable for this business');
        source='marketplace_product';id=Number(imported.rows[0].id);
      }
    }
    const key=`${source}:${id}:${variant||0}:${modifiers.join(',')}`;
    const previous=lines.get(key);
    if(previous){
      previous.quantity+=quantity;
      if(!Number.isFinite(previous.quantity))throw Object.assign(new Error('Order quantity is too large'),{status:400});
    }
    else lines.set(key,{id,quantity,source,variant,modifiers});
  }
  const snapshots=[];
  // Lock canonical products in stable order; Inventory is locked later by the
  // reservation engine, avoiding SHARE-to-UPDATE upgrades on shared stock.
  for(const line of [...lines.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.id-b.id||(a.variant||0)-(b.variant||0))){
    let row,unitCost=0,unitPrice=0,name,variantSnapshot={},modifierSnapshot={groups:[]};
    if(line.source==='product'){
      const result=await db.query(`
        SELECT p.id,p.name,p.category,p.selling_price,p.active
          FROM products p WHERE p.business_id=$1 AND p.id=$2 AND p.active=TRUE
           AND NOT EXISTS(SELECT 1 FROM marketplace_products cp
                           WHERE cp.business_id=p.business_id AND cp.legacy_product_id=p.id)
          FOR SHARE OF p
      `,[bid,line.id]);
      row=result.rows[0];
      if(!row)throw unavailable('One or more products are unavailable for this business');
      if(line.variant||line.modifiers.length)throw unavailable('Legacy prepared products do not use Catalog options');
      unitCost=await recipeCost(db,line.id,bid);unitPrice=Number(row.selling_price);name=row.name;
    }else{
      const result=await db.query(`SELECT id,name,category,selling_price,active,product_domain,product_kind,inventory_id,quantity_per_unit,variant_mode,legacy_product_id,availability_state,availability_until,availability_note FROM marketplace_products WHERE business_id=$1 AND id=$2 AND active=TRUE FOR UPDATE`,[bid,line.id]);
      row=result.rows[0];
      if(!row)throw unavailable('One or more Catalog products are unavailable for this business');
      unitPrice=Number(row.selling_price);name=row.name;
      if(row.product_domain==='food'){
        const availability=await counterFoodOrderability(db,row,bid,{now});
        if(!availability.available)throw unavailable(availability.blocked_reason==='outside_menu_schedule'?`${row.name} is not available in the current menu schedule`:`${row.name} is currently unavailable`);
        const selected=await validateProductModifierSelections(db,{businessId:bid,productId:line.id,optionIds:line.modifiers});
        unitPrice=money(unitPrice+selected.price_delta);modifierSnapshot=selected.snapshot;
      }else if(line.modifiers.length)throw unavailable(`${row.name} does not use Food menu options`);
      if(row.variant_mode){
        if(!line.variant)throw unavailable(`Choose a variant for ${row.name}`);
        const variant=await db.query(`
          SELECT v.id,v.variant_key,v.price_override,i.unit_cost
            FROM catalog_product_variants v
            JOIN inventory i ON i.id=v.inventory_id AND i.business_id=$3
           WHERE v.id=$1 AND v.product_id=$2 AND v.active=TRUE
           FOR SHARE OF v
        `,[line.variant,line.id,bid]);
        const selected=variant.rows[0];
        if(!selected)throw unavailable(`${row.name} variant is unavailable`);
        unitPrice=selected.price_override==null?unitPrice:Number(selected.price_override);
        unitCost=Number(row.quantity_per_unit)*Number(selected.unit_cost||0);
        const values=await db.query(`
          SELECT o.code option_code,o.label option_label,ov.value_code,ov.label value_label
            FROM catalog_variant_option_values x
            JOIN catalog_product_options o ON o.id=x.option_id
            JOIN catalog_product_option_values ov ON ov.id=x.option_value_id
           WHERE x.variant_id=$1 ORDER BY o.sort_order,o.id
        `,[line.variant]);
        variantSnapshot={variant_id:line.variant,variant_key:selected.variant_key,option_values:values.rows};
        const label=values.rows.map(value=>value.value_label).filter(Boolean).join(' / ');
        if(label)name+=` · ${label}`;
      }else{
        if(line.variant)throw unavailable(`${row.name} does not use retail variants`);
        if(row.inventory_id){
          const stock=await db.query('SELECT unit_cost FROM inventory WHERE id=$1 AND business_id=$2',[row.inventory_id,bid]);
          if(!stock.rowCount)throw unavailable(`${row.name} is not linked to valid Merchant stock`);
          unitCost=Number(row.quantity_per_unit)*Number(stock.rows[0].unit_cost||0);
        }else if(row.legacy_product_id)unitCost=await recipeCost(db,Number(row.legacy_product_id),bid);
      }
    }
    if(!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(unitCost)||unitCost<0)throw unavailable('Product price or cost is invalid');
    const total=money(unitPrice*line.quantity),cogs=money(unitCost*line.quantity);
    if(!Number.isFinite(total)||!Number.isFinite(cogs))throw Object.assign(new Error('Order quantity is too large'),{status:400});
    snapshots.push({source_kind:line.source,source_id:line.id,catalog_variant_id:line.variant,
      variant_snapshot_json:variantSnapshot,modifier_snapshot_json:modifierSnapshot,
      name_snapshot:name,category_snapshot:row.category,quantity:line.quantity,
      unit_price_snapshot:unitPrice,unit_cost_snapshot:unitCost,line_total:total,
      estimated_cogs:cogs,estimated_gross_profit:money(total-cogs)});
  }
  return snapshots;
}
