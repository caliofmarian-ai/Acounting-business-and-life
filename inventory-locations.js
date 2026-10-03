import {inventoryLotExpiryStatus} from './inventory-lot-core.js';
import {STORAGE_CONDITIONS,STORAGE_AREA_TYPES} from './inventory-storage-core.js';

const EPS=1e-9;
const clean=(value,max=160)=>String(value??'').trim().slice(0,max);

function locationNameFromInventory(row={}){
  const label=clean(row.storage_location_label,120);
  if(label)return label;
  return({
    pantry:'Pantry',
    fridge:'Fridge',
    freezer:'Freezer',
    prep_station:'Prep station',
    chemical_storage:'Chemical storage',
    service_storage:'Service storage',
    sales_floor:'Sales floor',
    stock_room:'Stock room',
    shelf_bin:'Shelf / bin',
    warehouse:'Warehouse',
    secure_storage:'Secure storage',
    returns_inspection:'Returns / inspection',
    general_supply:'General supplies',
    other:'Primary storage'
  })[row.storage_area_type||'other']||'Primary storage';
}

async function supplyLotsAvailable(client){
  const r=await client.query("SELECT to_regclass('public.supply_lots') rel");
  return Boolean(r.rows[0]?.rel);
}

export async function ensureInventoryLocationSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_storage_locations (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      storage_condition TEXT NOT NULL DEFAULT 'other',
      storage_area_type TEXT NOT NULL DEFAULT 'other',
      location_label TEXT NOT NULL DEFAULT '',
      storage_segregated BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(storage_condition IN ('ambient','dry','chilled','frozen','other')),
      CHECK(storage_area_type IN ('pantry','fridge','freezer','prep_station','chemical_storage','service_storage','sales_floor','stock_room','shelf_bin','warehouse','secure_storage','returns_inspection','general_supply','other'))
    );
    ALTER TABLE inventory_storage_locations
      DROP CONSTRAINT IF EXISTS inventory_storage_locations_storage_area_type_check;
    ALTER TABLE inventory_storage_locations
      ADD CONSTRAINT inventory_storage_locations_storage_area_type_check
      CHECK(storage_area_type IN ('pantry','fridge','freezer','prep_station','chemical_storage','service_storage','sales_floor','stock_room','shelf_bin','warehouse','secure_storage','returns_inspection','general_supply','other'));
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_storage_locations_business_name_unique
      ON inventory_storage_locations(business_id,LOWER(name));

    CREATE TABLE IF NOT EXISTS inventory_location_balances (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      location_id BIGINT NOT NULL REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      quantity NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(quantity>=0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(inventory_id,location_id)
    );
    CREATE INDEX IF NOT EXISTS inventory_location_balances_business_idx
      ON inventory_location_balances(business_id,location_id,inventory_id);

    CREATE TABLE IF NOT EXISTS inventory_lot_location_balances (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      lot_id BIGINT NOT NULL,
      location_id BIGINT NOT NULL REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      quantity NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(quantity>=0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(lot_id,location_id)
    );
    CREATE INDEX IF NOT EXISTS inventory_lot_location_balances_inventory_idx
      ON inventory_lot_location_balances(business_id,inventory_id,location_id,lot_id);

    CREATE TABLE IF NOT EXISTS inventory_location_transfers (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
      source_location_id BIGINT NOT NULL REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      destination_location_id BIGINT NOT NULL REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      quantity NUMERIC(16,6) NOT NULL CHECK(quantity>0),
      unit TEXT NOT NULL,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      reversal_of_transfer_id BIGINT REFERENCES inventory_location_transfers(id) ON DELETE RESTRICT,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(source_location_id<>destination_location_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_location_transfer_single_reversal
      ON inventory_location_transfers(reversal_of_transfer_id)
      WHERE reversal_of_transfer_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS inventory_location_transfers_business_idx
      ON inventory_location_transfers(business_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS inventory_location_transfer_lots (
      transfer_id BIGINT NOT NULL REFERENCES inventory_location_transfers(id) ON DELETE CASCADE,
      lot_id BIGINT NOT NULL,
      quantity NUMERIC(16,6) NOT NULL CHECK(quantity>0),
      expires_at_snapshot TIMESTAMPTZ,
      PRIMARY KEY(transfer_id,lot_id)
    );
  `);

  const businesses=await pool.query(`SELECT DISTINCT business_id FROM inventory WHERE business_id IS NOT NULL`);
  for(const row of businesses.rows){
    await reconcileBusinessInventoryLocations(pool,{businessId:Number(row.business_id)});
  }
}

async function ensureLocation(client,{businessId,name,condition='other',area='other',label='',segregated=false,actorAccountId=null}={}){
  const safeName=clean(name,120)||'Primary storage';
  const existing=await client.query(`
    SELECT * FROM inventory_storage_locations
     WHERE business_id=$1 AND LOWER(name)=LOWER($2)
     LIMIT 1
  `,[businessId,safeName]);
  if(existing.rowCount)return existing.rows[0];
  const saved=await client.query(`
    INSERT INTO inventory_storage_locations(
      business_id,name,storage_condition,storage_area_type,location_label,storage_segregated,created_by_account_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `,[
    businessId,safeName,
    STORAGE_CONDITIONS.includes(condition)?condition:'other',
    STORAGE_AREA_TYPES.includes(area)?area:'other',
    clean(label,120),Boolean(segregated),actorAccountId
  ]);
  return saved.rows[0];
}

export async function ensureDefaultInventoryLocation(client,{businessId,inventoryId,actorAccountId=null}={}){
  const inv=await client.query(`
    SELECT * FROM inventory WHERE id=$1 AND business_id=$2
  `,[inventoryId,businessId]);
  if(!inv.rowCount)throw Object.assign(new Error('Inventory item not found.'),{status:404});
  const row=inv.rows[0];
  return ensureLocation(client,{
    businessId,
    name:locationNameFromInventory(row),
    condition:row.storage_condition||'other',
    area:row.storage_area_type||'other',
    label:row.storage_location_label||'',
    segregated:Boolean(row.storage_segregated),
    actorAccountId
  });
}

async function reduceBalances(client,{table,idField,idValue,businessId,inventoryId,quantity}){
  let remaining=Math.max(0,Number(quantity||0));
  if(remaining<=EPS)return;
  const rows=await client.query(`
    SELECT location_id,quantity FROM ${table}
     WHERE business_id=$1 AND inventory_id=$2 AND ${idField}=$3 AND quantity>0
     ORDER BY quantity DESC,location_id
     FOR UPDATE
  `,[businessId,inventoryId,idValue]);
  for(const row of rows.rows){
    if(remaining<=EPS)break;
    const take=Math.min(remaining,Number(row.quantity));
    await client.query(`
      UPDATE ${table}
         SET quantity=GREATEST(0,quantity-$1),updated_at=NOW()
       WHERE business_id=$2 AND inventory_id=$3 AND ${idField}=$4 AND location_id=$5
    `,[take,businessId,inventoryId,idValue,Number(row.location_id)]);
    remaining-=take;
  }
  if(remaining>1e-6)throw Object.assign(new Error('Location balances cannot be reconciled with canonical Inventory quantity.'),{status:409});
}

export async function reconcileInventoryLocationBalance(client,{businessId,inventoryId,actorAccountId=null}={}){
  const inv=await client.query(`
    SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE
  `,[inventoryId,businessId]);
  if(!inv.rowCount)throw Object.assign(new Error('Inventory item not found.'),{status:404});
  const primary=await ensureDefaultInventoryLocation(client,{businessId,inventoryId,actorAccountId});
  const total=await client.query(`
    SELECT COALESCE(SUM(quantity),0) total
      FROM inventory_location_balances
     WHERE business_id=$1 AND inventory_id=$2
  `,[businessId,inventoryId]);
  const canonical=Math.max(0,Number(inv.rows[0].quantity||0)),allocated=Math.max(0,Number(total.rows[0].total||0));
  const diff=canonical-allocated;
  if(diff>EPS){
    await client.query(`
      INSERT INTO inventory_location_balances(business_id,inventory_id,location_id,quantity)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(inventory_id,location_id) DO UPDATE
        SET quantity=inventory_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
    `,[businessId,inventoryId,primary.id,diff]);
  }else if(diff<-EPS){
    let remaining=-diff;
    const rows=await client.query(`
      SELECT location_id,quantity FROM inventory_location_balances
       WHERE business_id=$1 AND inventory_id=$2 AND quantity>0
       ORDER BY CASE WHEN location_id=$3 THEN 0 ELSE 1 END,quantity DESC,location_id
       FOR UPDATE
    `,[businessId,inventoryId,primary.id]);
    for(const row of rows.rows){
      if(remaining<=EPS)break;
      const take=Math.min(remaining,Number(row.quantity));
      await client.query(`
        UPDATE inventory_location_balances
           SET quantity=GREATEST(0,quantity-$1),updated_at=NOW()
         WHERE business_id=$2 AND inventory_id=$3 AND location_id=$4
      `,[take,businessId,inventoryId,Number(row.location_id)]);
      remaining-=take;
    }
    if(remaining>1e-6)throw Object.assign(new Error('Inventory location balances exceed canonical stock and could not be reconciled.'),{status:409});
  }
  return primary;
}

export async function reconcileLotLocationBalance(client,{businessId,inventoryId,lotId,actorAccountId=null}={}){
  if(!(await supplyLotsAvailable(client)))return null;
  const lot=await client.query(`
    SELECT * FROM supply_lots
     WHERE id=$1 AND business_id=$2 AND inventory_id=$3
     FOR UPDATE
  `,[lotId,businessId,inventoryId]);
  if(!lot.rowCount)return null;
  const primary=await reconcileInventoryLocationBalance(client,{businessId,inventoryId,actorAccountId});
  const total=await client.query(`
    SELECT COALESCE(SUM(quantity),0) total
      FROM inventory_lot_location_balances
     WHERE business_id=$1 AND inventory_id=$2 AND lot_id=$3
  `,[businessId,inventoryId,lotId]);
  const canonical=Math.max(0,Number(lot.rows[0].quantity_remaining_base||0)),allocated=Math.max(0,Number(total.rows[0].total||0));
  const diff=canonical-allocated;
  if(diff>EPS){
    await client.query(`
      INSERT INTO inventory_lot_location_balances(business_id,inventory_id,lot_id,location_id,quantity)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(lot_id,location_id) DO UPDATE
        SET quantity=inventory_lot_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
    `,[businessId,inventoryId,lotId,primary.id,diff]);
  }else if(diff<-EPS){
    await reduceBalances(client,{
      table:'inventory_lot_location_balances',idField:'lot_id',idValue:lotId,
      businessId,inventoryId,quantity:-diff
    });
  }
  return primary;
}

export async function reconcileBusinessInventoryLocations(client,{businessId,actorAccountId=null}={}){
  const inv=await client.query(`SELECT id FROM inventory WHERE business_id=$1 ORDER BY id`,[businessId]);
  for(const row of inv.rows){
    await reconcileInventoryLocationBalance(client,{businessId,inventoryId:Number(row.id),actorAccountId});
  }
  if(await supplyLotsAvailable(client)){
    const lots=await client.query(`
      SELECT id,inventory_id FROM supply_lots
       WHERE business_id=$1 AND inventory_id IS NOT NULL
       ORDER BY id
    `,[businessId]);
    for(const lot of lots.rows){
      await reconcileLotLocationBalance(client,{
        businessId,inventoryId:Number(lot.inventory_id),lotId:Number(lot.id),actorAccountId
      });
    }
  }
}

export async function inventoryLocationBalanceRows(client,{businessId,inventoryId=null}={}){
  await reconcileBusinessInventoryLocations(client,{businessId});
  const params=[businessId];let filter='';
  if(inventoryId!=null){params.push(Number(inventoryId));filter=' AND b.inventory_id=$2'}
  const {rows}=await client.query(`
    SELECT b.business_id,b.inventory_id,b.location_id,b.quantity,
           i.item,i.unit,i.inventory_type,i.inventory_domain,i.stock_role,
           l.name location_name,l.storage_condition,l.storage_area_type,l.location_label,l.storage_segregated
      FROM inventory_location_balances b
      JOIN inventory i ON i.id=b.inventory_id AND i.business_id=b.business_id
      JOIN inventory_storage_locations l ON l.id=b.location_id AND l.business_id=b.business_id
     WHERE b.business_id=$1${filter}
     ORDER BY i.item,l.name,l.id
  `,params);
  return rows.map(row=>({...row,quantity:Number(row.quantity)}));
}

async function sourceLotRows(client,{businessId,inventoryId,locationId}={}){
  await reconcileBusinessInventoryLocations(client,{businessId});
  if(!(await supplyLotsAvailable(client)))return[];
  const {rows}=await client.query(`
    SELECT lb.lot_id,lb.quantity,l.expires_at,l.lot_state,l.internal_lot_code,l.supplier_lot_code
      FROM inventory_lot_location_balances lb
      JOIN supply_lots l ON l.id=lb.lot_id AND l.business_id=lb.business_id AND l.inventory_id=lb.inventory_id
     WHERE lb.business_id=$1 AND lb.inventory_id=$2 AND lb.location_id=$3 AND lb.quantity>0
     ORDER BY l.expires_at NULLS LAST,l.received_at,l.created_at,l.id
     FOR UPDATE OF lb
  `,[businessId,inventoryId,locationId]);
  return rows;
}

function planTransferLots(rows,quantity,{lotId=null,now=Date.now()}={}){
  let remaining=Number(quantity),allocations=[];
  const eligible=(rows||[]).filter(row=>{
    if(lotId!=null)return Number(row.lot_id)===Number(lotId);
    return String(row.lot_state||'available')==='available'&&inventoryLotExpiryStatus(row.expires_at,{now})!=='expired';
  });
  for(const row of eligible){
    if(remaining<=EPS)break;
    const take=Math.min(remaining,Number(row.quantity||0));
    if(take>EPS)allocations.push({lot_id:Number(row.lot_id),quantity:take,expires_at:row.expires_at||null});
    remaining-=take;
  }
  return{allocations,tracked:Math.max(0,Number(quantity)-remaining),remaining:Math.max(0,remaining)};
}

export async function planLocationStockReduction(client,{
  businessId,inventoryId,locationId,quantityToRemove,actorAccountId=null
}={}){
  const required=Number(quantityToRemove);
  if(!Number.isFinite(required)||required<0)return{ok:false,reason:'invalid_quantity',required};
  await reconcileBusinessInventoryLocations(client,{businessId,actorAccountId});
  const source=await client.query(`
    SELECT quantity FROM inventory_location_balances
     WHERE business_id=$1 AND inventory_id=$2 AND location_id=$3
     FOR UPDATE
  `,[businessId,inventoryId,locationId]);
  const available=Number(source.rows[0]?.quantity||0);
  if(required>available+EPS)return{ok:false,reason:'location_shortage',required,available,allocations:[],untracked_used:0};
  const lots=await sourceLotRows(client,{businessId,inventoryId,locationId});
  let remaining=required;const allocations=[];
  for(const lot of lots){
    if(remaining<=EPS)break;
    const qty=Math.min(remaining,Number(lot.quantity||0));
    if(qty>EPS)allocations.push({lot_id:Number(lot.lot_id),quantity:qty,expires_at:lot.expires_at||null});
    remaining-=qty;
  }
  return{ok:true,required,available,allocations,untracked_used:Math.max(0,remaining)};
}

export async function applyLocationLotReductions(client,{
  businessId,inventoryId,locationId,allocations=[]
}={}){
  for(const allocation of allocations){
    const qty=Number(allocation.quantity);
    if(!Number.isFinite(qty)||qty<=0)continue;
    const updated=await client.query(`
      UPDATE inventory_lot_location_balances
         SET quantity=quantity-$1,updated_at=NOW()
       WHERE business_id=$2 AND inventory_id=$3 AND lot_id=$4 AND location_id=$5
         AND quantity+$6>=$1
       RETURNING lot_id,quantity
    `,[qty,businessId,inventoryId,Number(allocation.lot_id),locationId,EPS]);
    if(!updated.rowCount)throw Object.assign(new Error('Lot-location quantity changed while the count was being posted.'),{status:409});
  }
}

export function registerInventoryLocationRoutes(app,{pool,jsonBody,accountingContext}){
  async function merchantContext(req){
    const ctx=await accountingContext(req);
    if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});
    return ctx;
  }

  app.get('/api/inventory/locations',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      await reconcileBusinessInventoryLocations(pool,{businessId:ctx.business.id,actorAccountId:ctx.me.account.id});
      const {rows}=await pool.query(`
        SELECT * FROM inventory_storage_locations
         WHERE business_id=$1 AND active=TRUE
         ORDER BY name,id
      `,[ctx.business.id]);
      res.json(rows);
    }catch(error){next(error)}
  });

  app.post('/api/inventory/locations',jsonBody,async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      const name=clean(req.body?.name,120),condition=clean(req.body?.storage_condition,30)||'other',area=clean(req.body?.storage_area_type,40)||'other';
      if(!name)return res.status(400).json({error:'Location name is required.'});
      if(!STORAGE_CONDITIONS.includes(condition)||!STORAGE_AREA_TYPES.includes(area))return res.status(400).json({error:'Choose a valid storage condition and area.'});
      if(area==='fridge'&&condition!=='chilled')return res.status(409).json({error:'Fridge locations must use the Chilled condition.'});
      if(area==='freezer'&&condition!=='frozen')return res.status(409).json({error:'Freezer locations must use the Frozen condition.'});
      if(area==='chemical_storage'&&!req.body?.storage_segregated)return res.status(409).json({error:'Chemical storage must be segregated from food.'});
      try{
        const saved=await pool.query(`
          INSERT INTO inventory_storage_locations(
            business_id,name,storage_condition,storage_area_type,location_label,storage_segregated,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
        `,[ctx.business.id,name,condition,area,clean(req.body?.location_label,120),Boolean(req.body?.storage_segregated),ctx.me.account.id]);
        res.status(201).json(saved.rows[0]);
      }catch(error){
        if(error?.code==='23505')return res.status(409).json({error:'A storage location with that name already exists.'});
        throw error;
      }
    }catch(error){next(error)}
  });

  app.get('/api/inventory/location-balances',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      const inventoryId=req.query?.inventory_id==null||req.query.inventory_id===''?null:Number(req.query.inventory_id);
      if(inventoryId!=null&&!Number.isInteger(inventoryId))return res.status(400).json({error:'Invalid Inventory item.'});
      res.json(await inventoryLocationBalanceRows(pool,{businessId:ctx.business.id,inventoryId}));
    }catch(error){next(error)}
  });

  app.get('/api/inventory/transfers',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      const {rows}=await pool.query(`
        SELECT t.*,i.item,sl.name source_location,dl.name destination_location
          FROM inventory_location_transfers t
          JOIN inventory i ON i.id=t.inventory_id
          JOIN inventory_storage_locations sl ON sl.id=t.source_location_id
          JOIN inventory_storage_locations dl ON dl.id=t.destination_location_id
         WHERE t.business_id=$1
         ORDER BY t.created_at DESC,t.id DESC
         LIMIT 100
      `,[ctx.business.id]);
      res.json(rows);
    }catch(error){next(error)}
  });

  app.post('/api/inventory/transfers',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req);
      const inventoryId=Number(req.body?.inventory_id),sourceId=Number(req.body?.source_location_id),destinationId=Number(req.body?.destination_location_id),quantity=Number(req.body?.quantity);
      const explicitLotId=req.body?.lot_id==null||req.body?.lot_id===''?null:Number(req.body.lot_id);
      if(!Number.isInteger(inventoryId)||!Number.isInteger(sourceId)||!Number.isInteger(destinationId)||sourceId===destinationId||!Number.isFinite(quantity)||quantity<=0){
        return res.status(400).json({error:'Choose an Inventory item, source, destination and quantity greater than zero.'});
      }
      if(explicitLotId!=null&&!Number.isInteger(explicitLotId))return res.status(400).json({error:'Choose a valid lot or leave lot selection automatic.'});
      await client.query('BEGIN');
      const inv=await client.query(`SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,[inventoryId,ctx.business.id]);
      if(!inv.rowCount)throw Object.assign(new Error('Inventory item not found.'),{status:404});
      const loc=await client.query(`
        SELECT id FROM inventory_storage_locations
         WHERE business_id=$1 AND active=TRUE AND id=ANY($2::bigint[])
         ORDER BY id FOR UPDATE
      `,[ctx.business.id,[sourceId,destinationId]]);
      if(loc.rowCount!==2)throw Object.assign(new Error('Source or destination storage location is unavailable.'),{status:409});
      await reconcileInventoryLocationBalance(client,{businessId:ctx.business.id,inventoryId,actorAccountId:ctx.me.account.id});
      const source=await client.query(`
        SELECT quantity FROM inventory_location_balances
         WHERE business_id=$1 AND inventory_id=$2 AND location_id=$3 FOR UPDATE
      `,[ctx.business.id,inventoryId,sourceId]);
      if(!source.rowCount||Number(source.rows[0].quantity)+EPS<quantity)throw Object.assign(new Error('Source location does not contain enough physical stock.'),{status:409});

      const lotRows=await sourceLotRows(client,{businessId:ctx.business.id,inventoryId,locationId:sourceId});
      const lotPlan=planTransferLots(lotRows,quantity,{lotId:explicitLotId});
      const untrackedAtSource=Math.max(0,Number(source.rows[0].quantity)-lotRows.reduce((sum,row)=>sum+Number(row.quantity||0),0));
      if(explicitLotId!=null&&lotPlan.remaining>EPS)throw Object.assign(new Error('The selected lot does not contain enough stock in the source location.'),{status:409});
      if(explicitLotId==null&&lotPlan.remaining>untrackedAtSource+EPS)throw Object.assign(new Error('Not enough safe FEFO or untracked stock is available in the source location.'),{status:409});

      await client.query(`
        UPDATE inventory_location_balances SET quantity=quantity-$1,updated_at=NOW()
         WHERE business_id=$2 AND inventory_id=$3 AND location_id=$4
      `,[quantity,ctx.business.id,inventoryId,sourceId]);
      await client.query(`
        INSERT INTO inventory_location_balances(business_id,inventory_id,location_id,quantity)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(inventory_id,location_id) DO UPDATE
          SET quantity=inventory_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
      `,[ctx.business.id,inventoryId,destinationId,quantity]);

      const transfer=await client.query(`
        INSERT INTO inventory_location_transfers(
          business_id,inventory_id,source_location_id,destination_location_id,quantity,unit,actor_account_id,note
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,[ctx.business.id,inventoryId,sourceId,destinationId,quantity,inv.rows[0].unit,ctx.me.account.id,clean(req.body?.note,300)]);

      for(const allocation of lotPlan.allocations){
        await client.query(`
          UPDATE inventory_lot_location_balances
             SET quantity=quantity-$1,updated_at=NOW()
           WHERE business_id=$2 AND inventory_id=$3 AND lot_id=$4 AND location_id=$5
        `,[allocation.quantity,ctx.business.id,inventoryId,allocation.lot_id,sourceId]);
        await client.query(`
          INSERT INTO inventory_lot_location_balances(business_id,inventory_id,lot_id,location_id,quantity)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(lot_id,location_id) DO UPDATE
            SET quantity=inventory_lot_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
        `,[ctx.business.id,inventoryId,allocation.lot_id,destinationId,allocation.quantity]);
        await client.query(`
          INSERT INTO inventory_location_transfer_lots(transfer_id,lot_id,quantity,expires_at_snapshot)
          VALUES($1,$2,$3,$4)
        `,[transfer.rows[0].id,allocation.lot_id,allocation.quantity,allocation.expires_at]);
      }

      const businessTotal=await client.query(`SELECT quantity FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,ctx.business.id]);
      const locationTotal=await client.query(`SELECT COALESCE(SUM(quantity),0) total FROM inventory_location_balances WHERE business_id=$1 AND inventory_id=$2`,[ctx.business.id,inventoryId]);
      if(Math.abs(Number(businessTotal.rows[0].quantity)-Number(locationTotal.rows[0].total))>1e-6){
        throw Object.assign(new Error('Internal transfer would violate business-total stock conservation.'),{status:409});
      }
      await client.query('COMMIT');
      res.status(201).json({
        transfer:transfer.rows[0],
        lot_allocations:lotPlan.allocations,
        business_total:Number(businessTotal.rows[0].quantity),
        location_total:Number(locationTotal.rows[0].total),
        accounting_effect:'internal_stock_location_only_no_purchase_sale_or_cash_movement'
      });
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });

  app.post('/api/inventory/transfers/:id/reverse',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req),transferId=Number(req.params.id);
      if(!Number.isInteger(transferId))return res.status(400).json({error:'Invalid transfer.'});
      await client.query('BEGIN');
      const original=await client.query(`
        SELECT * FROM inventory_location_transfers
         WHERE id=$1 AND business_id=$2 FOR UPDATE
      `,[transferId,ctx.business.id]);
      if(!original.rowCount)throw Object.assign(new Error('Internal transfer not found.'),{status:404});
      if(original.rows[0].reversal_of_transfer_id!=null)throw Object.assign(new Error('A reversal cannot itself be reversed from this action.'),{status:409});
      const already=await client.query(`SELECT id FROM inventory_location_transfers WHERE reversal_of_transfer_id=$1`,[transferId]);
      if(already.rowCount)throw Object.assign(new Error('This transfer has already been reversed.'),{status:409});
      const t=original.rows[0],quantity=Number(t.quantity);
      await reconcileInventoryLocationBalance(client,{businessId:ctx.business.id,inventoryId:Number(t.inventory_id),actorAccountId:ctx.me.account.id});
      const destination=await client.query(`
        SELECT quantity FROM inventory_location_balances
         WHERE business_id=$1 AND inventory_id=$2 AND location_id=$3 FOR UPDATE
      `,[ctx.business.id,t.inventory_id,t.destination_location_id]);
      if(!destination.rowCount||Number(destination.rows[0].quantity)+EPS<quantity)throw Object.assign(new Error('Destination location no longer contains enough stock to reverse this transfer.'),{status:409});

      const lots=await client.query(`
        SELECT * FROM inventory_location_transfer_lots WHERE transfer_id=$1 ORDER BY lot_id
      `,[transferId]);
      for(const allocation of lots.rows){
        const q=await client.query(`
          SELECT quantity FROM inventory_lot_location_balances
           WHERE business_id=$1 AND inventory_id=$2 AND lot_id=$3 AND location_id=$4 FOR UPDATE
        `,[ctx.business.id,t.inventory_id,allocation.lot_id,t.destination_location_id]);
        if(!q.rowCount||Number(q.rows[0].quantity)+EPS<Number(allocation.quantity))throw Object.assign(new Error('Destination lot balance changed and this transfer can no longer be reversed exactly.'),{status:409});
      }

      await client.query(`
        UPDATE inventory_location_balances SET quantity=quantity-$1,updated_at=NOW()
         WHERE business_id=$2 AND inventory_id=$3 AND location_id=$4
      `,[quantity,ctx.business.id,t.inventory_id,t.destination_location_id]);
      await client.query(`
        INSERT INTO inventory_location_balances(business_id,inventory_id,location_id,quantity)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(inventory_id,location_id) DO UPDATE
          SET quantity=inventory_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
      `,[ctx.business.id,t.inventory_id,t.source_location_id,quantity]);

      const reversal=await client.query(`
        INSERT INTO inventory_location_transfers(
          business_id,inventory_id,source_location_id,destination_location_id,quantity,unit,
          actor_account_id,reversal_of_transfer_id,note
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `,[
        ctx.business.id,t.inventory_id,t.destination_location_id,t.source_location_id,quantity,t.unit,
        ctx.me.account.id,transferId,clean(req.body?.note||'Transfer reversal',300)
      ]);

      for(const allocation of lots.rows){
        await client.query(`
          UPDATE inventory_lot_location_balances SET quantity=quantity-$1,updated_at=NOW()
           WHERE business_id=$2 AND inventory_id=$3 AND lot_id=$4 AND location_id=$5
        `,[allocation.quantity,ctx.business.id,t.inventory_id,allocation.lot_id,t.destination_location_id]);
        await client.query(`
          INSERT INTO inventory_lot_location_balances(business_id,inventory_id,lot_id,location_id,quantity)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(lot_id,location_id) DO UPDATE
            SET quantity=inventory_lot_location_balances.quantity+EXCLUDED.quantity,updated_at=NOW()
        `,[ctx.business.id,t.inventory_id,allocation.lot_id,t.source_location_id,allocation.quantity]);
        await client.query(`
          INSERT INTO inventory_location_transfer_lots(transfer_id,lot_id,quantity,expires_at_snapshot)
          VALUES($1,$2,$3,$4)
        `,[reversal.rows[0].id,allocation.lot_id,allocation.quantity,allocation.expires_at_snapshot]);
      }
      await client.query('COMMIT');
      res.status(201).json({
        transfer:reversal.rows[0],
        reversed_transfer_id:transferId,
        accounting_effect:'internal_stock_location_only_no_purchase_sale_or_cash_movement'
      });
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });
}
