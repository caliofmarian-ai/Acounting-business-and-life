import crypto from 'node:crypto';
import {
  normalizeSupplierActivities,
  normalizeHandlingMode,
  normalizePackageDefinition,
  normalizePriceTiers,
  computeRepackPlan,
  inheritedExpiry
} from './supplier-domain-core.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const finite=value=>Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;
const nonNegative=value=>finite(value)&&Number(value)>=0;
const money=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const lotCode=()=>`LOT-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

function httpError(status,message){return Object.assign(new Error(message),{status})}

async function exactProfileBusiness(pool,me,role,requestedId=null){
  if(!me?.account?.id)throw httpError(401,'Unauthorized');
  if(!me?.profiles?.some(p=>p.role===role&&p.enabled))throw httpError(403,`${role} profile required`);
  const args=[Number(me.account.id),role];
  let filter='';
  if(requestedId!=null&&Number.isFinite(Number(requestedId))){
    args.push(Number(requestedId));
    filter=' AND pb.business_id=$3';
  }
  const {rows}=await pool.query(`
    SELECT b.*,pb.is_primary
    FROM profile_business_bindings pb
    JOIN businesses b ON b.id=pb.business_id
    JOIN business_memberships bm
      ON bm.business_id=pb.business_id
     AND bm.account_id=pb.account_id
     AND bm.active=TRUE
    WHERE pb.account_id=$1
      AND pb.role=$2
      AND pb.status='active'
      ${filter}
    ORDER BY pb.is_primary DESC,b.id
  `,args);
  if(!rows.length)throw httpError(403,'Business workspace unavailable for this profile');
  if(requestedId==null&&rows.length>1){
    const pref=await pool.query(
      `SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role=$2`,
      [me.account.id,role]
    ).catch(()=>({rows:[]}));
    const selected=rows.find(x=>Number(x.id)===Number(pref.rows[0]?.business_id));
    if(selected)return selected;
  }
  return rows[0];
}

async function requireCatalogOwnership(pool,accountId,catalogId){
  const {rows}=await pool.query(
    `SELECT * FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2`,
    [Number(catalogId),Number(accountId)]
  );
  if(!rows.length)throw httpError(404,'Supplier catalog item not found');
  return rows[0];
}

async function listCatalogV2(pool,catalogId){
  const [tiers,levels]=await Promise.all([
    pool.query(`SELECT id,minimum_quantity,price_per_pack,label FROM supplier_catalog_price_tiers WHERE catalog_item_id=$1 ORDER BY minimum_quantity,id`,[catalogId]),
    pool.query(`SELECT id,level_name,base_unit,base_units_per_level,saleable,sort_order FROM supplier_catalog_package_levels WHERE catalog_item_id=$1 ORDER BY sort_order,id`,[catalogId])
  ]);
  return{price_tiers:tiers.rows,package_levels:levels.rows};
}

export async function ensureSupplierDomainV2Schema(pool){
  await pool.query(`
    ALTER TABLE supplier_catalog_items
      ADD COLUMN IF NOT EXISTS handling_mode TEXT NOT NULL DEFAULT 'sealed_resale';
    ALTER TABLE supplier_catalog_items
      DROP CONSTRAINT IF EXISTS supplier_catalog_items_handling_mode_check;
    ALTER TABLE supplier_catalog_items
      ADD CONSTRAINT supplier_catalog_items_handling_mode_check
      CHECK(handling_mode IN ('sealed_resale','break_pack','bulk','repacked','produced'));

    CREATE TABLE IF NOT EXISTS supplier_business_activities(
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      activity_code TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'self_declared',
      evidence_status TEXT NOT NULL DEFAULT 'not_reviewed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,activity_code),
      CHECK(activity_code IN (
        'producer','processor','manufacturer','packer','repacker','trader',
        'importer','exporter','distributor','wholesaler','retailer','service_provider'
      )),
      CHECK(source IN ('self_declared','admin_recorded','evidence_reviewed')),
      CHECK(evidence_status IN ('not_reviewed','pending','verified','rejected','expired'))
    );

    CREATE TABLE IF NOT EXISTS merchant_supply_parties(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'external',
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      location_note TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      claimed_at TIMESTAMPTZ,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(source_type IN ('external','connected')),
      CHECK(status IN ('active','inactive','merged')),
      CHECK(
        (source_type='external' AND supplier_account_id IS NULL)
        OR (source_type='connected' AND supplier_account_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS merchant_supply_parties_business_idx
      ON merchant_supply_parties(business_id,status,display_name);
    CREATE UNIQUE INDEX IF NOT EXISTS merchant_supply_parties_connected_unique
      ON merchant_supply_parties(business_id,supplier_account_id)
      WHERE supplier_account_id IS NOT NULL AND status='active';

    CREATE TABLE IF NOT EXISTS supplier_catalog_price_tiers(
      id BIGSERIAL PRIMARY KEY,
      catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE CASCADE,
      minimum_quantity NUMERIC(14,4) NOT NULL CHECK(minimum_quantity>0),
      price_per_pack NUMERIC(12,2) NOT NULL CHECK(price_per_pack>=0),
      label TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(catalog_item_id,minimum_quantity)
    );

    CREATE TABLE IF NOT EXISTS supplier_catalog_package_levels(
      id BIGSERIAL PRIMARY KEY,
      catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE CASCADE,
      level_name TEXT NOT NULL,
      base_unit TEXT NOT NULL,
      base_units_per_level NUMERIC(14,6) NOT NULL CHECK(base_units_per_level>0),
      saleable BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(catalog_item_id,level_name)
    );

    CREATE TABLE IF NOT EXISTS supply_lots(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE SET NULL,
      purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
      purchase_receipt_id BIGINT,
      purchase_order_item_id BIGINT,
      inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,
      parent_lot_id BIGINT REFERENCES supply_lots(id) ON DELETE RESTRICT,
      item_name TEXT NOT NULL,
      internal_lot_code TEXT NOT NULL,
      supplier_lot_code TEXT NOT NULL DEFAULT '',
      handling_mode TEXT NOT NULL DEFAULT 'bulk',
      base_unit TEXT NOT NULL,
      quantity_received_base NUMERIC(16,6) NOT NULL CHECK(quantity_received_base>0),
      quantity_remaining_base NUMERIC(16,6) NOT NULL CHECK(quantity_remaining_base>=0),
      unit_cost_base NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(unit_cost_base>=0),
      package_unit_name TEXT NOT NULL DEFAULT '',
      package_size_base NUMERIC(16,6),
      package_count_received NUMERIC(16,6),
      manufactured_at TIMESTAMPTZ,
      packed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(handling_mode IN ('sealed_resale','break_pack','bulk','repacked','produced')),
      CHECK(package_size_base IS NULL OR package_size_base>0),
      CHECK(package_count_received IS NULL OR package_count_received>0),
      UNIQUE(business_id,internal_lot_code),
      FOREIGN KEY(purchase_receipt_id,purchase_order_item_id)
        REFERENCES purchase_receipt_items(receipt_id,purchase_order_item_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX IF NOT EXISTS supply_lots_business_item_idx
      ON supply_lots(business_id,item_name,expires_at,created_at);
    CREATE INDEX IF NOT EXISTS supply_lots_inventory_idx
      ON supply_lots(business_id,inventory_id,created_at);

    CREATE TABLE IF NOT EXISTS supply_repack_operations(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      source_lot_id BIGINT NOT NULL REFERENCES supply_lots(id) ON DELETE RESTRICT,
      output_lot_id BIGINT NOT NULL UNIQUE REFERENCES supply_lots(id) ON DELETE RESTRICT,
      input_quantity_base NUMERIC(16,6) NOT NULL CHECK(input_quantity_base>0),
      package_size_base NUMERIC(16,6) NOT NULL CHECK(package_size_base>0),
      output_packages NUMERIC(16,6) NOT NULL CHECK(output_packages>0),
      packed_quantity_base NUMERIC(16,6) NOT NULL CHECK(packed_quantity_base>0),
      waste_quantity_base NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(waste_quantity_base>=0),
      input_cost NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(input_cost>=0),
      packaging_cost NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(packaging_cost>=0),
      total_output_cost NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(total_output_cost>=0),
      cost_per_output_package NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(cost_per_output_package>=0),
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS supply_repack_business_idx
      ON supply_repack_operations(business_id,created_at DESC);
  `);
}

export function registerSupplierDomainV2Routes({app,pool,body,identity}){
  app.get('/api/supplier/v2/activities',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT activity_code,source,evidence_status,updated_at FROM supplier_business_activities WHERE business_id=$1 ORDER BY activity_code`,
        [b.id]
      );
      res.json({business:{id:b.id,name:b.name},activities:rows});
    }catch(e){next(e)}
  });

  app.put('/api/supplier/v2/activities',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const activities=normalizeSupplierActivities(req.body?.activities||[]);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(`DELETE FROM supplier_business_activities WHERE business_id=$1`,[b.id]);
        for(const code of activities){
          await client.query(
            `INSERT INTO supplier_business_activities(business_id,activity_code,source,evidence_status)
             VALUES($1,$2,'self_declared','not_reviewed')`,
            [b.id,code]
          );
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
      res.json({business:{id:b.id,name:b.name},activities});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/supply-parties',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT p.*,a.display_name connected_account_name
           FROM merchant_supply_parties p
           LEFT JOIN accounts a ON a.id=p.supplier_account_id
          WHERE p.business_id=$1 AND p.status<>'merged'
          ORDER BY p.status='active' DESC,p.display_name,p.id`,
        [b.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/supply-parties',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const name=clean(req.body?.display_name,180);
      if(!name)return res.status(400).json({error:'Supplier name is required'});
      const {rows}=await pool.query(
        `INSERT INTO merchant_supply_parties(
          business_id,source_type,display_name,contact_name,email,phone,location_note,notes,created_by_account_id
        ) VALUES($1,'external',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          b.id,name,clean(req.body?.contact_name,180),clean(req.body?.email,180).toLowerCase(),
          clean(req.body?.phone,80),clean(req.body?.location_note,300),clean(req.body?.notes,1000),me.account.id
        ]
      );
      res.status(201).json(rows[0]);
    }catch(e){next(e)}
  });

  app.patch('/api/procurement/supply-parties/:id',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const current=await pool.query(
        `SELECT * FROM merchant_supply_parties WHERE id=$1 AND business_id=$2`,
        [Number(req.params.id),b.id]
      );
      if(!current.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const x=current.rows[0];
      const status=['active','inactive'].includes(req.body?.status)?req.body.status:x.status;
      const {rows}=await pool.query(
        `UPDATE merchant_supply_parties
            SET display_name=$1,contact_name=$2,email=$3,phone=$4,location_note=$5,notes=$6,status=$7,updated_at=NOW()
          WHERE id=$8 AND business_id=$9 RETURNING *`,
        [
          clean(req.body?.display_name??x.display_name,180)||x.display_name,
          clean(req.body?.contact_name??x.contact_name,180),
          clean(req.body?.email??x.email,180).toLowerCase(),
          clean(req.body?.phone??x.phone,80),
          clean(req.body?.location_note??x.location_note,300),
          clean(req.body?.notes??x.notes,1000),
          status,x.id,b.id
        ]
      );
      res.json(rows[0]);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/supply-parties/:id/connect',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const supplierAccountId=Number(req.body?.supplier_account_id);
      if(!Number.isInteger(supplierAccountId))return res.status(400).json({error:'Supplier account is required'});
      const rel=await pool.query(
        `SELECT 1 FROM supplier_relationships WHERE business_id=$1 AND supplier_account_id=$2 AND state='accepted'`,
        [b.id,supplierAccountId]
      );
      if(!rel.rowCount)return res.status(409).json({error:'Accepted Supplier relationship required before connecting this record'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const current=await client.query(
          `SELECT * FROM merchant_supply_parties WHERE id=$1 AND business_id=$2 FOR UPDATE`,
          [Number(req.params.id),b.id]
        );
        if(!current.rowCount)throw httpError(404,'Supplier record not found');
        const duplicate=await client.query(
          `SELECT id FROM merchant_supply_parties
            WHERE business_id=$1 AND supplier_account_id=$2 AND status='active' AND id<>$3
            FOR UPDATE`,
          [b.id,supplierAccountId,current.rows[0].id]
        );
        if(duplicate.rowCount){
          await client.query(
            `UPDATE supply_lots SET supply_party_id=$1 WHERE business_id=$2 AND supply_party_id=$3`,
            [duplicate.rows[0].id,b.id,current.rows[0].id]
          );
          await client.query(
            `UPDATE merchant_supply_parties SET status='merged',updated_at=NOW() WHERE id=$1`,
            [current.rows[0].id]
          );
          await client.query('COMMIT');
          return res.json({merged_into_party_id:Number(duplicate.rows[0].id),connected:true});
        }
        const {rows}=await client.query(
          `UPDATE merchant_supply_parties
              SET source_type='connected',supplier_account_id=$1,claimed_at=NOW(),updated_at=NOW()
            WHERE id=$2 AND business_id=$3 RETURNING *`,
          [supplierAccountId,current.rows[0].id,b.id]
        );
        await client.query('COMMIT');
        res.json(rows[0]);
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.get('/api/supplier/catalog/:id/v2',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const item=await requireCatalogOwnership(pool,me.account.id,req.params.id);
      const detail=await listCatalogV2(pool,item.id);
      res.json({...item,...detail});
    }catch(e){next(e)}
  });

  app.put('/api/supplier/catalog/:id/v2',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const item=await requireCatalogOwnership(pool,me.account.id,req.params.id);
      const handlingMode=normalizeHandlingMode(req.body?.handling_mode??item.handling_mode);
      const tiers=normalizePriceTiers(req.body?.price_tiers||[]);
      const levels=Array.isArray(req.body?.package_levels)?req.body.package_levels:[];
      const normalizedLevels=levels.map((level,index)=>{
        const p=normalizePackageDefinition({
          outerUnit:level?.level_name,
          innerUnit:level?.base_unit??item.base_unit,
          innerQuantity:level?.base_units_per_level
        });
        return{
          level_name:p.outer_unit,
          base_unit:p.inner_unit,
          base_units_per_level:p.inner_quantity,
          saleable:level?.saleable!==false,
          sort_order:Number.isInteger(Number(level?.sort_order))?Number(level.sort_order):index
        };
      });
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          `UPDATE supplier_catalog_items SET handling_mode=$1,updated_at=NOW() WHERE id=$2 AND supplier_account_id=$3`,
          [handlingMode,item.id,me.account.id]
        );
        await client.query(`DELETE FROM supplier_catalog_price_tiers WHERE catalog_item_id=$1`,[item.id]);
        for(const tier of tiers){
          await client.query(
            `INSERT INTO supplier_catalog_price_tiers(catalog_item_id,minimum_quantity,price_per_pack,label)
             VALUES($1,$2,$3,$4)`,
            [item.id,tier.minimum_quantity,tier.price_per_pack,tier.label]
          );
        }
        await client.query(`DELETE FROM supplier_catalog_package_levels WHERE catalog_item_id=$1`,[item.id]);
        for(const level of normalizedLevels){
          await client.query(
            `INSERT INTO supplier_catalog_package_levels(
              catalog_item_id,level_name,base_unit,base_units_per_level,saleable,sort_order
            ) VALUES($1,$2,$3,$4,$5,$6)`,
            [item.id,level.level_name,level.base_unit,level.base_units_per_level,level.saleable,level.sort_order]
          );
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
      const refreshed=await requireCatalogOwnership(pool,me.account.id,item.id);
      res.json({...refreshed,...await listCatalogV2(pool,item.id)});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/supply-lots',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const args=[b.id];
      let where='';
      if(req.query.inventory_id){
        args.push(Number(req.query.inventory_id));
        where=' AND l.inventory_id=$2';
      }
      const {rows}=await pool.query(
        `SELECT l.*,p.display_name supplier_name,p.source_type supplier_source_type
           FROM supply_lots l
           LEFT JOIN merchant_supply_parties p ON p.id=l.supply_party_id
          WHERE l.business_id=$1 ${where}
          ORDER BY l.expires_at NULLS LAST,l.created_at DESC,l.id DESC
          LIMIT 500`,
        args
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/supply-lots',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const partyId=Number(req.body?.supply_party_id);
      const itemName=clean(req.body?.item_name,180);
      const quantity=Number(req.body?.quantity_base);
      const baseUnit=clean(req.body?.base_unit,50);
      const totalCost=Number(req.body?.total_cost??0);
      if(!Number.isInteger(partyId)||!itemName||!positive(quantity)||!baseUnit||!nonNegative(totalCost)){
        return res.status(400).json({error:'Supplier, item, quantity, base unit and non-negative total cost are required'});
      }
      const party=await pool.query(
        `SELECT * FROM merchant_supply_parties WHERE id=$1 AND business_id=$2 AND status='active'`,
        [partyId,b.id]
      );
      if(!party.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const inventoryId=req.body?.inventory_id?Number(req.body.inventory_id):null;
      let inventory=null;
      if(inventoryId){
        const q=await pool.query(`SELECT * FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,b.id]);
        if(!q.rowCount)return res.status(404).json({error:'Inventory item not found for this business'});
        inventory=q.rows[0];
        const inventoryBase=clean(inventory.base_unit||inventory.unit,50);
        if(inventoryBase&&inventoryBase!==baseUnit){
          return res.status(409).json({error:'Received lot base unit does not match the linked Inventory item'});
        }
      }
      const handlingMode=normalizeHandlingMode(req.body?.handling_mode,{fallback:'bulk'});
      const unitCost=quantity>0?totalCost/quantity:0;
      const internal=clean(req.body?.internal_lot_code,90)||lotCode();
      const expires=req.body?.expires_at?new Date(req.body.expires_at):null;
      if(expires&&Number.isNaN(expires.getTime()))return res.status(400).json({error:'Expiry date is invalid'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        if(inventory){
          const oldQty=Number(inventory.quantity)||0;
          const oldCost=Number(inventory.unit_cost)||0;
          const newQty=oldQty+quantity;
          const weighted=newQty>0?((oldQty*oldCost)+totalCost)/newQty:0;
          await client.query(
            `UPDATE inventory SET quantity=$1,unit_cost=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4`,
            [newQty,weighted,inventory.id,b.id]
          );
        }
        const {rows}=await client.query(
          `INSERT INTO supply_lots(
            business_id,supply_party_id,inventory_id,item_name,internal_lot_code,supplier_lot_code,
            handling_mode,base_unit,quantity_received_base,quantity_remaining_base,unit_cost_base,
            package_unit_name,package_size_base,package_count_received,manufactured_at,packed_at,
            expires_at,received_at,note,created_by_account_id
          ) VALUES(
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,
            COALESCE($17,NOW()),$18,$19
          ) RETURNING *`,
          [
            b.id,partyId,inventoryId,itemName,internal,clean(req.body?.supplier_lot_code,90),
            handlingMode,baseUnit,quantity,unitCost,clean(req.body?.package_unit_name,50),
            req.body?.package_size_base?Number(req.body.package_size_base):null,
            req.body?.package_count_received?Number(req.body.package_count_received):null,
            req.body?.manufactured_at||null,req.body?.packed_at||null,
            expires?expires.toISOString():null,req.body?.received_at||null,
            clean(req.body?.note,1000),me.account.id
          ]
        );
        await client.query('COMMIT');
        res.status(201).json(rows[0]);
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.post('/api/procurement/supply-lots/:id/repack',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const sourceLotId=Number(req.params.id);
      const inputQuantity=Number(req.body?.input_quantity_base);
      const packageSize=Number(req.body?.package_size_base);
      const outputPackages=Number(req.body?.output_packages);
      const wasteQuantity=Number(req.body?.waste_quantity_base??0);
      const packagingCostPerOutput=Number(req.body?.packaging_cost_per_output??0);
      const outputName=clean(req.body?.output_item_name,180);
      const packageUnit=clean(req.body?.package_unit_name,50)||'pack';
      if(!outputName)return res.status(400).json({error:'Output item name is required'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const source=await client.query(
          `SELECT * FROM supply_lots WHERE id=$1 AND business_id=$2 FOR UPDATE`,
          [sourceLotId,b.id]
        );
        if(!source.rowCount)throw httpError(404,'Source lot not found');
        const lot=source.rows[0];
        if(inputQuantity>Number(lot.quantity_remaining_base)+1e-9){
          throw httpError(409,'Repack input exceeds source lot quantity remaining');
        }
        const outputInventoryId=req.body?.output_inventory_id?Number(req.body.output_inventory_id):null;
        let sourceInventory=null;
        if(lot.inventory_id){
          const sourceInv=await client.query(
            `SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,
            [Number(lot.inventory_id),b.id]
          );
          if(!sourceInv.rowCount)throw httpError(409,'Source lot Inventory item is unavailable');
          sourceInventory=sourceInv.rows[0];
          if(Number(sourceInventory.quantity)+1e-9<inputQuantity){
            throw httpError(409,'Source Inventory quantity is lower than the lot repack input');
          }
          if(outputInventoryId&&Number(outputInventoryId)===Number(sourceInventory.id)){
            throw httpError(409,'Repacked output must use a different Inventory item from the bulk source in V2');
          }
        }
        const plan=computeRepackPlan({
          inputQuantity,
          packageSize,
          outputPackages,
          wasteQuantity,
          inputUnitCost:Number(lot.unit_cost_base),
          packagingCostPerOutput
        });
        const outputExpiry=inheritedExpiry([lot.expires_at].filter(Boolean));
        const outputInternal=clean(req.body?.internal_lot_code,90)||lotCode();
        const outputBaseUnit=clean(req.body?.base_unit,50)||clean(lot.base_unit,50);
        if(outputBaseUnit!==clean(lot.base_unit,50)){
          throw httpError(409,'Repack output must retain the source base unit');
        }
        const outputUnitCost=plan.packed_quantity>0?plan.total_output_cost/plan.packed_quantity:0;
        const output=await client.query(
          `INSERT INTO supply_lots(
            business_id,supply_party_id,inventory_id,parent_lot_id,item_name,internal_lot_code,
            handling_mode,base_unit,quantity_received_base,quantity_remaining_base,unit_cost_base,
            package_unit_name,package_size_base,package_count_received,packed_at,expires_at,note,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,'repacked',$7,$8,$8,$9,$10,$11,$12,NOW(),$13,$14,$15)
          RETURNING *`,
          [
            b.id,lot.supply_party_id,outputInventoryId,
            lot.id,outputName,outputInternal,outputBaseUnit,plan.packed_quantity,outputUnitCost,
            packageUnit,plan.package_size,plan.output_packages,outputExpiry,
            clean(req.body?.note,1000),me.account.id
          ]
        );
        await client.query(
          `UPDATE supply_lots SET quantity_remaining_base=quantity_remaining_base-$1 WHERE id=$2`,
          [plan.input_quantity,lot.id]
        );
        if(sourceInventory){
          await client.query(
            `UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,
            [plan.input_quantity,sourceInventory.id,b.id]
          );
        }
        await client.query(
          `INSERT INTO supply_repack_operations(
            business_id,source_lot_id,output_lot_id,input_quantity_base,package_size_base,
            output_packages,packed_quantity_base,waste_quantity_base,input_cost,packaging_cost,
            total_output_cost,cost_per_output_package,actor_account_id,note
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            b.id,lot.id,output.rows[0].id,plan.input_quantity,plan.package_size,
            plan.output_packages,plan.packed_quantity,plan.waste_quantity,plan.input_cost,
            plan.packaging_cost,plan.total_output_cost,plan.cost_per_output_package,
            me.account.id,clean(req.body?.note,1000)
          ]
        );
        if(outputInventoryId){
          const inv=await client.query(
            `SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,
            [outputInventoryId,b.id]
          );
          if(!inv.rowCount)throw httpError(404,'Output Inventory item not found');
          const inventoryBase=clean(inv.rows[0].base_unit||inv.rows[0].unit,50);
          if(inventoryBase&&inventoryBase!==outputBaseUnit)throw httpError(409,'Output Inventory base unit mismatch');
          const oldQty=Number(inv.rows[0].quantity)||0;
          const oldCost=Number(inv.rows[0].unit_cost)||0;
          const newQty=oldQty+plan.packed_quantity;
          const weighted=newQty>0?((oldQty*oldCost)+plan.total_output_cost)/newQty:0;
          await client.query(
            `UPDATE inventory SET quantity=$1,unit_cost=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4`,
            [newQty,weighted,inv.rows[0].id,b.id]
          );
        }
        await client.query('COMMIT');
        res.status(201).json({operation:plan,source_lot_id:lot.id,output_lot:output.rows[0]});
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });
}

export const supplierDomainV2Internals={
  exactProfileBusiness,
  requireCatalogOwnership,
  listCatalogV2
};
