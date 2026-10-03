import {applyLotAllocations,inventoryLotRows} from './inventory-lot-runtime.js';
import {inventoryLotExpiryStatus,sortFefoLots} from './inventory-lot-core.js';

const EPS=1e-9;
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);

export async function ensureOrderStockReservationSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_stock_reservations (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      stock_kind TEXT NOT NULL CHECK(stock_kind IN ('inventory','marketplace_product')),
      stock_ref_id BIGINT NOT NULL,
      item_name_snapshot TEXT NOT NULL DEFAULT '',
      quantity_reserved NUMERIC(16,6) NOT NULL CHECK(quantity_reserved>0),
      untracked_quantity_reserved NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(untracked_quantity_reserved>=0),
      state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','consumed','released')),
      expires_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      released_at TIMESTAMPTZ,
      release_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id,stock_kind,stock_ref_id)
    );
    CREATE INDEX IF NOT EXISTS order_stock_reservations_active_idx
      ON order_stock_reservations(business_id,stock_kind,stock_ref_id,state,expires_at);

    CREATE TABLE IF NOT EXISTS order_stock_reservation_lots (
      reservation_id BIGINT NOT NULL REFERENCES order_stock_reservations(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
      lot_id BIGINT NOT NULL,
      quantity_reserved NUMERIC(16,6) NOT NULL CHECK(quantity_reserved>0),
      expires_at_snapshot TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(reservation_id,lot_id)
    );
    CREATE INDEX IF NOT EXISTS order_stock_reservation_lots_lot_idx
      ON order_stock_reservation_lots(lot_id,reservation_id);
  `);
}

export function reservationExpiryForOrder(order,{now=new Date()}={}){
  const base=new Date(now);
  const status=String(order?.order_status||'');
  const minutes=status==='accepted'?240:30;
  return new Date(base.getTime()+minutes*60*1000).toISOString();
}

export async function releaseExpiredStockReservations(client,{businessId=null}={}){
  const params=[];let scope='';
  if(businessId!=null){params.push(Number(businessId));scope=' AND business_id=$1'}
  const {rows}=await client.query(`
    UPDATE order_stock_reservations
       SET state='released',released_at=COALESCE(released_at,NOW()),release_reason='expired',updated_at=NOW()
     WHERE state='reserved' AND expires_at IS NOT NULL AND expires_at<=NOW()${scope}
     RETURNING id,order_id,stock_kind,stock_ref_id
  `,params);
  return rows;
}

async function addRecipeNeeds(client,{businessId,productId,orderQuantity,inventoryNeeds}){
  const {rows}=await client.query(`
    SELECT r.inventory_id,r.quantity recipe_quantity,i.item,i.unit_cost
      FROM recipes r
      JOIN inventory i ON i.id=r.inventory_id AND i.business_id=$2
     WHERE r.product_id=$1
     ORDER BY r.inventory_id
  `,[Number(productId),Number(businessId)]);
  for(const row of rows){
    const id=Number(row.inventory_id),qty=Number(row.recipe_quantity)*Number(orderQuantity);
    const existing=inventoryNeeds.get(id)||{stock_kind:'inventory',stock_ref_id:id,item:row.item,unit_cost:Number(row.unit_cost||0),quantity:0};
    existing.quantity+=qty;inventoryNeeds.set(id,existing);
  }
}

export async function orderReservationNeeds(client,order){
  const inventoryNeeds=new Map(),marketplaceNeeds=new Map();
  const items=await client.query(`
    SELECT id,source_kind,source_id,name_snapshot,quantity
      FROM order_items WHERE order_id=$1 ORDER BY id
  `,[Number(order.id)]);
  const addInventory=(id,item,unitCost,qty)=>{
    const key=Number(id),existing=inventoryNeeds.get(key)||{stock_kind:'inventory',stock_ref_id:key,item,unit_cost:Number(unitCost||0),quantity:0};
    existing.quantity+=Number(qty);inventoryNeeds.set(key,existing);
  };
  for(const item of items.rows){
    if(item.source_kind==='product'){
      await addRecipeNeeds(client,{businessId:order.business_id,productId:item.source_id,orderQuantity:item.quantity,inventoryNeeds});
      continue;
    }
    if(item.source_kind!=='marketplace_product')continue;
    const p=await client.query(`
      SELECT id,name,stock_tracked,stock_quantity,legacy_product_id,inventory_id,quantity_per_unit
        FROM marketplace_products WHERE id=$1 AND business_id=$2
    `,[Number(item.source_id),Number(order.business_id)]);
    if(!p.rowCount)throw Object.assign(new Error('Marketplace product is no longer available for stock reservation'),{status:409});
    const row=p.rows[0];
    if(row.inventory_id){
      const inv=await client.query(`SELECT id,item,unit_cost FROM inventory WHERE id=$1 AND business_id=$2`,[row.inventory_id,order.business_id]);
      if(!inv.rowCount)throw Object.assign(new Error(`${row.name} is not linked to valid Merchant stock`),{status:409});
      addInventory(inv.rows[0].id,inv.rows[0].item,inv.rows[0].unit_cost,Number(row.quantity_per_unit)*Number(item.quantity));
    }else if(row.stock_tracked&&row.stock_quantity!=null){
      const id=Number(row.id),existing=marketplaceNeeds.get(id)||{stock_kind:'marketplace_product',stock_ref_id:id,item:row.name,unit_cost:0,quantity:0};
      existing.quantity+=Number(item.quantity);marketplaceNeeds.set(id,existing);
    }
    if(row.legacy_product_id){
      await addRecipeNeeds(client,{businessId:order.business_id,productId:row.legacy_product_id,orderQuantity:item.quantity,inventoryNeeds});
    }
  }

  const itemCount=items.rows.reduce((sum,x)=>sum+Number(x.quantity||0),0);
  const consumables=await client.query(`
    SELECT r.inventory_id,r.quantity_used,r.usage_basis,i.item,i.unit_cost
      FROM merchant_order_consumable_rules r
      JOIN inventory i ON i.id=r.inventory_id AND i.business_id=r.business_id
     WHERE r.business_id=$1 AND r.active=TRUE
       AND (r.fulfilment_scope='all' OR r.fulfilment_scope=$2)
     ORDER BY r.inventory_id
  `,[Number(order.business_id),order.fulfilment_method]);
  for(const row of consumables.rows){
    const multiplier=row.usage_basis==='per_item'?itemCount:1;
    addInventory(row.inventory_id,row.item,row.unit_cost,Number(row.quantity_used)*multiplier);
  }
  return{inventoryNeeds:[...inventoryNeeds.values()],marketplaceNeeds:[...marketplaceNeeds.values()]};
}

async function activeReservationSums(client,{businessId,kind,refId,excludeOrderId}){
  const total=await client.query(`
    SELECT COALESCE(SUM(quantity_reserved),0) reserved,
           COALESCE(SUM(untracked_quantity_reserved),0) untracked_reserved
      FROM order_stock_reservations
     WHERE business_id=$1 AND stock_kind=$2 AND stock_ref_id=$3 AND state='reserved'
       AND (expires_at IS NULL OR expires_at>NOW()) AND order_id<>$4
  `,[Number(businessId),kind,Number(refId),Number(excludeOrderId)]);
  return{reserved:Number(total.rows[0]?.reserved||0),untrackedReserved:Number(total.rows[0]?.untracked_reserved||0)};
}

export function planInventoryReservationAllocation({
  quantityNeeded,
  physicalQuantity,
  lots=[],
  reservedByLot=new Map(),
  untrackedReserved=0,
  now=Date.now()
}={}){
  const required=Number(quantityNeeded),physical=Math.max(0,Number(physicalQuantity||0));
  if(!Number.isFinite(required)||required<=0)return{ok:false,required,available:0,short:Math.max(0,required||0),reason:'invalid_quantity'};
  const reservedMap=reservedByLot instanceof Map?reservedByLot:new Map(Object.entries(reservedByLot||{}).map(([k,v])=>[Number(k),Number(v)]));
  const trackedTotal=(Array.isArray(lots)?lots:[]).reduce((sum,l)=>sum+Math.max(0,Number(l.quantity_remaining_base||0)),0);
  const untrackedTotal=Math.max(0,physical-trackedTotal);
  const untrackedAvailable=Math.max(0,untrackedTotal-Math.max(0,Number(untrackedReserved||0)));
  const eligible=sortFefoLots((Array.isArray(lots)?lots:[])
    .filter(l=>String(l.lot_state||'available')==='available'&&inventoryLotExpiryStatus(l.expires_at,{now})!=='expired'))
    .map(l=>({...l,available_quantity:Math.max(0,Number(l.quantity_remaining_base||0)-Math.max(0,Number(reservedMap.get(Number(l.id))||0)))}))
    .filter(l=>l.available_quantity>EPS);
  const eligibleTotal=eligible.reduce((sum,l)=>sum+l.available_quantity,0);
  const totalAvailable=untrackedAvailable+eligibleTotal;
  if(required>totalAvailable+EPS){
    return{ok:false,required,available:totalAvailable,short:required-totalAvailable,reason:'reserved_or_unusable_stock',allocations:[],untrackedUsed:0};
  }
  let remaining=required;const allocations=[];
  for(const lot of eligible){
    if(remaining<=EPS)break;
    const qty=Math.min(remaining,lot.available_quantity);
    if(qty>EPS)allocations.push({lot_id:Number(lot.id),quantity:qty,expires_at:lot.expires_at||null});
    remaining-=qty;
  }
  const untrackedUsed=Math.max(0,remaining);
  return{ok:true,required,available:totalAvailable,allocations,untrackedUsed,trackedAvailable:eligibleTotal,untrackedAvailable};
}

async function planInventoryReservation(client,{order,need}){
  const inv=await client.query(`
    SELECT id,item,quantity,unit,unit_cost FROM inventory
     WHERE id=$1 AND business_id=$2 FOR UPDATE
  `,[Number(need.stock_ref_id),Number(order.business_id)]);
  if(!inv.rowCount)throw Object.assign(new Error(`${need.item} is not available in Merchant Inventory`),{status:409});
  const inventory=inv.rows[0],physical=Number(inventory.quantity||0);
  const lots=await inventoryLotRows(client,{businessId:order.business_id,inventoryId:need.stock_ref_id,lock:true});
  const active=await activeReservationSums(client,{businessId:order.business_id,kind:'inventory',refId:need.stock_ref_id,excludeOrderId:order.id});
  let reservedByLot=new Map();
  if(lots.length){
    const ids=lots.map(x=>Number(x.id));
    const q=await client.query(`
      SELECT rl.lot_id,COALESCE(SUM(rl.quantity_reserved),0) reserved
        FROM order_stock_reservation_lots rl
        JOIN order_stock_reservations r ON r.id=rl.reservation_id
       WHERE r.business_id=$1 AND r.stock_kind='inventory' AND r.stock_ref_id=$2
         AND r.state='reserved' AND (r.expires_at IS NULL OR r.expires_at>NOW())
         AND r.order_id<>$3 AND rl.lot_id=ANY($4::bigint[])
       GROUP BY rl.lot_id
    `,[Number(order.business_id),Number(need.stock_ref_id),Number(order.id),ids]);
    reservedByLot=new Map(q.rows.map(x=>[Number(x.lot_id),Number(x.reserved||0)]));
  }
  const planned=planInventoryReservationAllocation({
    quantityNeeded:Number(need.quantity),
    physicalQuantity:physical,
    lots,
    reservedByLot,
    untrackedReserved:active.untrackedReserved,
    now:Date.now()
  });
  if(!planned.ok)return{...planned,item:inventory.item};
  return{...planned,inventory};
}

async function planMarketplaceReservation(client,{order,need}){
  const p=await client.query(`
    SELECT id,name,stock_quantity FROM marketplace_products
     WHERE id=$1 AND business_id=$2 FOR UPDATE
  `,[Number(need.stock_ref_id),Number(order.business_id)]);
  if(!p.rowCount)return{ok:false,item:need.item,required:Number(need.quantity),available:0,short:Number(need.quantity),reason:'marketplace_stock_missing'};
  const row=p.rows[0],stock=Number(row.stock_quantity||0);
  const active=await activeReservationSums(client,{businessId:order.business_id,kind:'marketplace_product',refId:need.stock_ref_id,excludeOrderId:order.id});
  const available=Math.max(0,stock-active.reserved),required=Number(need.quantity);
  if(required>available+EPS)return{ok:false,item:row.name,required,available,short:required-available,reason:'reserved_stock'};
  return{ok:true,product:row,required,available};
}

export async function reserveOrderStock(client,order,{expiresAt=null}={}){
  await releaseExpiredStockReservations(client,{businessId:order.business_id});
  const existing=await client.query(`
    SELECT * FROM order_stock_reservations
     WHERE order_id=$1 AND state='reserved' AND (expires_at IS NULL OR expires_at>NOW())
     ORDER BY stock_kind,stock_ref_id
     FOR UPDATE
  `,[Number(order.id)]);
  if(existing.rowCount){
    const nextExpiry=expiresAt||reservationExpiryForOrder(order);
    await client.query(`UPDATE order_stock_reservations SET expires_at=$1,updated_at=NOW() WHERE order_id=$2 AND state='reserved'`,[nextExpiry,Number(order.id)]);
    return{reservations:existing.rows,shortages:[],reused:true};
  }

  const needs=await orderReservationNeeds(client,order),plans=[],shortages=[];
  for(const need of needs.inventoryNeeds.sort((a,b)=>a.stock_ref_id-b.stock_ref_id)){
    const plan=await planInventoryReservation(client,{order,need});
    if(!plan.ok)shortages.push(plan);else plans.push({need,plan});
  }
  for(const need of needs.marketplaceNeeds.sort((a,b)=>a.stock_ref_id-b.stock_ref_id)){
    const plan=await planMarketplaceReservation(client,{order,need});
    if(!plan.ok)shortages.push(plan);else plans.push({need,plan});
  }
  if(shortages.length)throw Object.assign(new Error('Not enough available stock to reserve this order.'),{status:409,shortages});

  const expiry=expiresAt||reservationExpiryForOrder(order),saved=[];
  for(const {need,plan} of plans){
    const ins=await client.query(`
      INSERT INTO order_stock_reservations(
        order_id,business_id,stock_kind,stock_ref_id,item_name_snapshot,quantity_reserved,
        untracked_quantity_reserved,state,expires_at,consumed_at,released_at,release_reason,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,NULL,NULL,'',NOW())
      ON CONFLICT(order_id,stock_kind,stock_ref_id) DO UPDATE SET
        item_name_snapshot=EXCLUDED.item_name_snapshot,quantity_reserved=EXCLUDED.quantity_reserved,
        untracked_quantity_reserved=EXCLUDED.untracked_quantity_reserved,state='reserved',
        expires_at=EXCLUDED.expires_at,consumed_at=NULL,released_at=NULL,release_reason='',updated_at=NOW()
      RETURNING *
    `,[Number(order.id),Number(order.business_id),need.stock_kind,Number(need.stock_ref_id),clean(need.item),Number(need.quantity),Number(plan.untrackedUsed||0),expiry]);
    const reservation=ins.rows[0];saved.push(reservation);
    await client.query(`DELETE FROM order_stock_reservation_lots WHERE reservation_id=$1`,[reservation.id]);
    for(const allocation of plan.allocations||[]){
      await client.query(`
        INSERT INTO order_stock_reservation_lots(reservation_id,order_id,inventory_id,lot_id,quantity_reserved,expires_at_snapshot)
        VALUES($1,$2,$3,$4,$5,$6)
      `,[reservation.id,Number(order.id),Number(need.stock_ref_id),allocation.lot_id,allocation.quantity,allocation.expires_at]);
    }
  }
  return{reservations:saved,shortages:[],reused:false};
}

export async function releaseOrderReservations(client,{orderId,reason='cancelled'}={}){
  const {rows}=await client.query(`
    UPDATE order_stock_reservations
       SET state='released',released_at=COALESCE(released_at,NOW()),release_reason=$2,updated_at=NOW()
     WHERE order_id=$1 AND state='reserved'
     RETURNING *
  `,[Number(orderId),clean(reason,80)]);
  return rows;
}

export async function consumeOrderReservations(client,order){
  if(order.stock_consumed_at)return{consumed:false,reused:true};
  await reserveOrderStock(client,order,{expiresAt:reservationExpiryForOrder({...order,order_status:'accepted'})});
  const reservations=await client.query(`
    SELECT * FROM order_stock_reservations
     WHERE order_id=$1 AND state='reserved'
     ORDER BY stock_kind,stock_ref_id FOR UPDATE
  `,[Number(order.id)]);
  for(const r of reservations.rows){
    const qty=Number(r.quantity_reserved);
    if(r.stock_kind==='inventory'){
      const inv=await client.query(`SELECT id,item,quantity,unit_cost,inventory_type FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,[r.stock_ref_id,order.business_id]);
      if(!inv.rowCount||Number(inv.rows[0].quantity)+EPS<qty)throw Object.assign(new Error('Reserved Inventory quantity changed before preparation started.'),{status:409});
      await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,[qty,r.stock_ref_id,order.business_id]);
      const unitCost=Number(inv.rows[0].unit_cost||0);
      await client.query(`
        INSERT INTO order_stock_consumptions(order_id,inventory_id,item_name_snapshot,inventory_type_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(order_id,inventory_id) DO UPDATE SET
          item_name_snapshot=EXCLUDED.item_name_snapshot,
          inventory_type_snapshot=EXCLUDED.inventory_type_snapshot,
          quantity_used=EXCLUDED.quantity_used,unit_cost_snapshot=EXCLUDED.unit_cost_snapshot,cost_snapshot=EXCLUDED.cost_snapshot
      `,[order.id,r.stock_ref_id,inv.rows[0].item,inv.rows[0].inventory_type||'ingredient',qty,unitCost,qty*unitCost]);
      const lotRows=await client.query(`
        SELECT lot_id,quantity_reserved,expires_at_snapshot
          FROM order_stock_reservation_lots WHERE reservation_id=$1 ORDER BY lot_id
      `,[r.id]);
      const allocations=lotRows.rows.map(x=>({lot_id:Number(x.lot_id),quantity:Number(x.quantity_reserved),expires_at:x.expires_at_snapshot}));
      await applyLotAllocations(client,allocations);
      for(const allocation of allocations){
        await client.query(`
          INSERT INTO order_stock_lot_allocations(order_id,inventory_id,lot_id,quantity_used,expires_at_snapshot)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(order_id,inventory_id,lot_id) DO UPDATE SET
            quantity_used=EXCLUDED.quantity_used,expires_at_snapshot=EXCLUDED.expires_at_snapshot,reversed_at=NULL
        `,[order.id,r.stock_ref_id,allocation.lot_id,allocation.quantity,allocation.expires_at]);
      }
    }else{
      const updated=await client.query(`
        UPDATE marketplace_products SET stock_quantity=stock_quantity-$1,updated_at=NOW()
         WHERE id=$2 AND business_id=$3 AND stock_quantity+$4>=$1 RETURNING id
      `,[qty,r.stock_ref_id,order.business_id,EPS]);
      if(!updated.rowCount)throw Object.assign(new Error('Reserved Marketplace stock changed before preparation started.'),{status:409});
      await client.query(`
        INSERT INTO marketplace_stock_events(order_id,marketplace_product_id,quantity,action)
        VALUES($1,$2,$3,'consume') ON CONFLICT DO NOTHING
      `,[order.id,r.stock_ref_id,qty]);
    }
    await client.query(`
      UPDATE order_stock_reservations
         SET state='consumed',consumed_at=NOW(),expires_at=NULL,updated_at=NOW()
       WHERE id=$1 AND state='reserved'
    `,[r.id]);
  }
  await client.query(`UPDATE orders SET stock_consumed_at=COALESCE(stock_consumed_at,NOW()),updated_at=NOW() WHERE id=$1`,[order.id]);
  return{consumed:true,reservations:reservations.rows.length};
}
