import {planFefoAllocation} from './inventory-lot-core.js';

async function supplyLotsAvailable(client){
  const r=await client.query("SELECT to_regclass('public.supply_lots') rel");
  return Boolean(r.rows[0]?.rel);
}

export async function inventoryLotRows(client,{businessId,inventoryId,lock=false}={}){
  if(!(await supplyLotsAvailable(client)))return[];
  const suffix=lock?' FOR UPDATE':'';
  const {rows}=await client.query(
    `SELECT id,business_id,inventory_id,item_name,internal_lot_code,supplier_lot_code,
            lot_state,base_unit,quantity_received_base,quantity_remaining_base,unit_cost_base,
            expires_at,received_at,created_at
       FROM supply_lots
      WHERE business_id=$1 AND inventory_id=$2 AND quantity_remaining_base>0
      ORDER BY expires_at NULLS LAST,received_at,created_at,id${suffix}`,
    [Number(businessId),Number(inventoryId)]
  );
  return rows;
}

export async function planInventoryFefo(client,{
  businessId,
  inventoryId,
  inventoryQuantity,
  quantityNeeded,
  now=Date.now(),
  lock=true
}={}){
  const lots=await inventoryLotRows(client,{businessId,inventoryId,lock});
  return planFefoAllocation({quantityNeeded,inventoryQuantity,lots,now});
}

export async function applyLotAllocations(client,allocations=[]){
  for(const allocation of allocations){
    const qty=Number(allocation.quantity);
    if(!Number.isFinite(qty)||qty<=0)continue;
    const result=await client.query(
      `UPDATE supply_lots
          SET quantity_remaining_base=GREATEST(0,quantity_remaining_base-$1),
              lot_state=CASE WHEN quantity_remaining_base-$1<=0.000000001 THEN 'depleted' ELSE lot_state END
        WHERE id=$2 AND lot_state='available' AND quantity_remaining_base+$3>=$1
        RETURNING id,quantity_remaining_base,lot_state`,
      [qty,Number(allocation.lot_id),1e-9]
    );
    if(!result.rowCount)throw Object.assign(new Error('Lot allocation changed while stock was being consumed'),{status:409});
  }
}

export async function restoreLotAllocation(client,{lotId,quantity}={}){
  const qty=Number(quantity);
  if(!Number.isFinite(qty)||qty<=0)return;
  await client.query(
    `UPDATE supply_lots
        SET quantity_remaining_base=quantity_remaining_base+$1,
            lot_state=CASE WHEN lot_state='depleted' THEN 'available' ELSE lot_state END
      WHERE id=$2`,
    [qty,Number(lotId)]
  );
}

export async function canUseSupplyLots(client){
  return supplyLotsAvailable(client);
}

export async function applyPhysicalLotReductions(client,allocations=[]){
  const applied=[];
  for(const allocation of allocations){
    const qty=Number(allocation.quantity);
    if(!Number.isFinite(qty)||qty<=0)continue;
    const result=await client.query(
      `UPDATE supply_lots
          SET quantity_remaining_base=GREATEST(0,quantity_remaining_base-$1),
              lot_state=CASE WHEN quantity_remaining_base-$1<=0.000000001 THEN 'depleted' ELSE lot_state END
        WHERE id=$2 AND quantity_remaining_base+$3>=$1
        RETURNING id,inventory_id,internal_lot_code,supplier_lot_code,lot_state,expires_at,quantity_remaining_base`,
      [qty,Number(allocation.lot_id),1e-9]
    );
    if(!result.rowCount)throw Object.assign(new Error('Lot quantity changed while the Inventory adjustment was being saved'),{status:409});
    applied.push({...allocation,...result.rows[0]});
  }
  return applied;
}

