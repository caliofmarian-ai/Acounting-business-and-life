import {toBaseQuantity} from './merchant-catalog-core.js';

export const INVENTORY_UNAVAILABLE_REASONS=Object.freeze([
  'damaged',
  'quality_control',
  'safety_stock',
  'return_pending',
  'quarantine',
  'other'
]);

const REASON_SET=new Set(INVENTORY_UNAVAILABLE_REASONS);
const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;

export async function ensureInventoryStateSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_unavailable_allocations (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      location_id BIGINT REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      quantity NUMERIC(16,6) NOT NULL CHECK(quantity>0),
      note TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active',
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      released_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      released_at TIMESTAMPTZ,
      release_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(reason IN ('damaged','quality_control','safety_stock','return_pending','quarantine','other')),
      CHECK(state IN ('active','released'))
    );
    CREATE INDEX IF NOT EXISTS inventory_unavailable_active_idx
      ON inventory_unavailable_allocations(business_id,inventory_id,state,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS inventory_unavailable_location_idx
      ON inventory_unavailable_allocations(business_id,location_id,state,inventory_id)
      WHERE location_id IS NOT NULL;
  `);
}

export function normalizeUnavailableAllocation(input={}){
  const reason=clean(input.reason,40).toLowerCase();
  const quantity=Number(input.quantity);
  if(!REASON_SET.has(reason))throw new TypeError('Choose a valid unavailable-stock reason.');
  if(!positive(quantity))throw new TypeError('Unavailable quantity must be greater than zero.');
  const locationId=input.location_id==null||input.location_id===''?null:Number(input.location_id);
  if(locationId!=null&&(!Number.isInteger(locationId)||locationId<1))throw new TypeError('Choose a valid Inventory location.');
  return{
    reason,
    quantity,
    location_id:locationId,
    note:clean(input.note,500)
  };
}

export async function activeInventoryUnavailableMap(client,businessId){
  try{
    const {rows}=await client.query(`
      SELECT inventory_id,COALESCE(SUM(quantity),0) unavailable_quantity
        FROM inventory_unavailable_allocations
       WHERE business_id=$1 AND state='active'
       GROUP BY inventory_id
    `,[Number(businessId)]);
    return new Map(rows.map(row=>[Number(row.inventory_id),Math.max(0,Number(row.unavailable_quantity||0))]));
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code||'')))return new Map();
    throw error;
  }
}

export async function listInventoryUnavailableAllocations(client,{businessId,inventoryId=null,activeOnly=false}={}){
  const params=[Number(businessId)];
  let inventoryFilter='',stateFilter='';
  if(inventoryId!=null){
    params.push(Number(inventoryId));
    inventoryFilter=` AND h.inventory_id=$${params.length}`;
  }
  if(activeOnly)stateFilter=" AND h.state='active'";
  const {rows}=await client.query(`
    SELECT h.*,i.item,i.unit,l.name location_name
      FROM inventory_unavailable_allocations h
      JOIN inventory i ON i.id=h.inventory_id AND i.business_id=h.business_id
      LEFT JOIN inventory_storage_locations l ON l.id=h.location_id AND l.business_id=h.business_id
     WHERE h.business_id=$1${inventoryFilter}${stateFilter}
     ORDER BY h.state='active' DESC,h.created_at DESC,h.id DESC
     LIMIT 500
  `,params);
  return rows.map(row=>({...row,quantity:Number(row.quantity)}));
}

export async function createInventoryUnavailableAllocation(client,{
  businessId,inventoryId,input,actorAccountId=null
}={}){
  const bid=Number(businessId),iid=Number(inventoryId);
  if(!Number.isInteger(bid)||bid<1||!Number.isInteger(iid)||iid<1)throw new TypeError('A valid Inventory item is required.');
  const normalized=normalizeUnavailableAllocation(input);
  const inventory=await client.query(`
    SELECT id,item,unit FROM inventory WHERE id=$1 AND business_id=$2
  `,[iid,bid]);
  if(!inventory.rowCount)throw Object.assign(new Error('Inventory item not found in this business.'),{status:404});
  if(normalized.location_id!=null){
    const location=await client.query(`
      SELECT id FROM inventory_storage_locations
       WHERE id=$1 AND business_id=$2 AND active=TRUE
    `,[normalized.location_id,bid]);
    if(!location.rowCount)throw Object.assign(new Error('Inventory location not found in this business.'),{status:404});
  }
  const {rows}=await client.query(`
    INSERT INTO inventory_unavailable_allocations(
      business_id,inventory_id,location_id,reason,quantity,note,actor_account_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `,[bid,iid,normalized.location_id,normalized.reason,normalized.quantity,normalized.note,actorAccountId||null]);
  return{...rows[0],quantity:Number(rows[0].quantity)};
}

export async function releaseInventoryUnavailableAllocation(client,{
  businessId,allocationId,actorAccountId=null,note=''
}={}){
  const bid=Number(businessId),id=Number(allocationId);
  if(!Number.isInteger(bid)||bid<1||!Number.isInteger(id)||id<1)throw new TypeError('A valid unavailable-stock allocation is required.');
  const {rows}=await client.query(`
    UPDATE inventory_unavailable_allocations
       SET state='released',released_at=COALESCE(released_at,NOW()),
           released_by_account_id=$1,release_note=$2,updated_at=NOW()
     WHERE id=$3 AND business_id=$4 AND state='active'
     RETURNING *
  `,[actorAccountId||null,clean(note,500),id,bid]);
  if(!rows.length)throw Object.assign(new Error('Active unavailable-stock allocation not found.'),{status:404});
  return{...rows[0],quantity:Number(rows[0].quantity)};
}

function normalizeUnit(value){
  return clean(value,40).toLowerCase();
}

function incomingQuantityInInventoryUnit(row){
  const maxPacks=Number(row.confirmed_packs??row.ordered_packs??0);
  const received=Math.max(0,Number(row.received_packs||0));
  const remainingPacks=Math.max(0,maxPacks-received);
  const perPack=Number(row.base_units_per_pack_snapshot||0);
  if(!positive(remainingPacks)||!positive(perPack))return{quantity:0,resolved:true};
  const supplierQuantity=remainingPacks*perPack;
  const supplierUnit=clean(row.base_unit_snapshot,40);
  const inventoryBase=clean(row.inventory_base_unit||row.inventory_unit,40);
  const family=clean(row.measurement_family,30);

  if(normalizeUnit(supplierUnit)===normalizeUnit(inventoryBase)){
    return{quantity:supplierQuantity,resolved:true};
  }

  if(family&&family!=='custom'){
    try{
      const converted=toBaseQuantity(supplierQuantity,supplierUnit);
      if(converted.family===family&&normalizeUnit(converted.base_unit)===normalizeUnit(inventoryBase)){
        return{quantity:converted.base_quantity,resolved:true};
      }
    }catch{}
  }
  return{quantity:0,resolved:false};
}

export async function incomingInventoryMap(client,businessId){
  const bid=Number(businessId);
  try{
    const {rows}=await client.query(`
      SELECT l.legacy_inventory_id inventory_id,
             i.base_unit inventory_base_unit,i.unit inventory_unit,i.measurement_family,
             poi.base_unit_snapshot,poi.base_units_per_pack_snapshot,
             poi.ordered_packs,poi.confirmed_packs,poi.received_packs,p.status
        FROM purchase_order_items poi
        JOIN purchase_orders p ON p.id=poi.purchase_order_id
        JOIN merchant_supplier_item_links l
          ON l.business_id=p.business_id AND l.catalog_item_id=poi.catalog_item_id
        JOIN inventory i
          ON i.id=l.legacy_inventory_id AND i.business_id=p.business_id
       WHERE p.business_id=$1
         AND l.legacy_inventory_id IS NOT NULL
         AND p.status IN (
           'sent','supplier_received','accepted','partially_accepted','preparing',
           'ready_for_pickup','out_for_delivery','delivered','partially_received'
         )
         AND poi.received_packs+0.000001<COALESCE(poi.confirmed_packs,poi.ordered_packs)
    `,[bid]);
    const map=new Map();
    for(const row of rows){
      const id=Number(row.inventory_id);
      const current=map.get(id)||{incoming_quantity:0,incoming_lines:0,incoming_unresolved_lines:0};
      const converted=incomingQuantityInInventoryUnit(row);
      current.incoming_lines+=1;
      if(converted.resolved)current.incoming_quantity+=Number(converted.quantity||0);
      else current.incoming_unresolved_lines+=1;
      map.set(id,current);
    }
    for(const value of map.values()){
      value.incoming_quantity=Math.max(0,Number(value.incoming_quantity||0));
    }
    return map;
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code||'')))return new Map();
    throw error;
  }
}
