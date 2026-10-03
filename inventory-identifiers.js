const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

export function normalizeInternalSku(value){
  return clean(value,80).replace(/\s+/g,' ').toUpperCase();
}

export function normalizeBarcode(value){
  return clean(value,160).replace(/\s+/g,'').toUpperCase().slice(0,120);
}

export function rankInventoryLookup(rows,{barcode='',sku='',q=''}={}){
  const exactBarcode=normalizeBarcode(barcode);
  const exactSku=normalizeInternalSku(sku);
  const query=clean(q,120).toLocaleLowerCase();
  const out=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const rowBarcode=normalizeBarcode(row.barcode);
    const rowSku=normalizeInternalSku(row.internal_sku);
    const item=String(row.item||'').trim();
    const itemLower=item.toLocaleLowerCase();
    let rank=null,matchType='';
    if(exactBarcode){
      if(rowBarcode!==exactBarcode)continue;
      rank=0;matchType='barcode_exact';
    }else if(exactSku){
      if(rowSku!==exactSku)continue;
      rank=0;matchType='sku_exact';
    }else{
      if(!query)continue;
      const barcodeLower=rowBarcode.toLocaleLowerCase();
      const skuLower=rowSku.toLocaleLowerCase();
      if(barcodeLower===query){rank=0;matchType='barcode_exact'}
      else if(skuLower===query){rank=1;matchType='sku_exact'}
      else if(itemLower===query){rank=2;matchType='item_exact'}
      else if(skuLower&&skuLower.startsWith(query)){rank=3;matchType='sku_prefix'}
      else if(itemLower.startsWith(query)){rank=4;matchType='item_prefix'}
      else if(barcodeLower.includes(query)){rank=5;matchType='barcode_partial'}
      else if(skuLower.includes(query)){rank=6;matchType='sku_partial'}
      else if(itemLower.includes(query)){rank=7;matchType='item_partial'}
      else continue;
    }
    out.push({...row,match_type:matchType,_lookup_rank:rank});
  }
  out.sort((a,b)=>a._lookup_rank-b._lookup_rank||String(a.item||'').localeCompare(String(b.item||''))||Number(a.id)-Number(b.id));
  return out.slice(0,20).map(({_lookup_rank,...row})=>row);
}

export async function ensureInventoryIdentifierSchema(pool){
  await pool.query(`
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS internal_sku TEXT NOT NULL DEFAULT '';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_business_internal_sku_unique
      ON inventory(business_id,LOWER(internal_sku))
      WHERE internal_sku<>'';
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_business_barcode_unique
      ON inventory(business_id,barcode)
      WHERE barcode<>'';
  `);
}

async function conflictFor(pool,{businessId,inventoryId,internalSku='',barcode=''}){
  if(internalSku){
    const q=await pool.query(`
      SELECT id,item,internal_sku,barcode
        FROM inventory
       WHERE business_id=$1 AND id<>$2 AND LOWER(internal_sku)=LOWER($3)
       ORDER BY id LIMIT 1
    `,[businessId,inventoryId,internalSku]);
    if(q.rowCount)return{field:'internal_sku',label:'Internal SKU / code',row:q.rows[0]};
  }
  if(barcode){
    const q=await pool.query(`
      SELECT id,item,internal_sku,barcode
        FROM inventory
       WHERE business_id=$1 AND id<>$2 AND barcode=$3
       ORDER BY id LIMIT 1
    `,[businessId,inventoryId,barcode]);
    if(q.rowCount)return{field:'barcode',label:'Barcode / GTIN',row:q.rows[0]};
  }
  return null;
}

function conflictPayload(conflict){
  return{
    error:`${conflict.label} is already assigned to ${conflict.row.item}.`,
    code:'inventory_identifier_conflict',
    field:conflict.field,
    conflicting_inventory_id:Number(conflict.row.id),
    conflicting_item:conflict.row.item
  };
}

export function registerInventoryIdentifierRoutes(app,{
  pool,jsonBody,accountingContext,inventoryAvailabilityRows
}){
  async function merchantContext(req){
    const ctx=await accountingContext(req);
    if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});
    return ctx;
  }

  app.get('/api/inventory/lookup',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      const barcode=normalizeBarcode(req.query?.barcode);
      const sku=normalizeInternalSku(req.query?.sku);
      const q=clean(req.query?.q,120);
      if(!barcode&&!sku&&!q)return res.status(400).json({error:'Enter an item name, SKU or barcode to search Inventory.'});
      const rows=await inventoryAvailabilityRows(pool,{businessId:ctx.business.id});
      res.json(rankInventoryLookup(rows,{barcode,sku,q}));
    }catch(error){next(error)}
  });

  app.patch('/api/inventory/:id/identifiers',jsonBody,async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req),inventoryId=Number(req.params.id);
      if(!Number.isInteger(inventoryId)||inventoryId<=0)return res.status(400).json({error:'Invalid Inventory item.'});
      const current=await pool.query(`
        SELECT * FROM inventory WHERE id=$1 AND business_id=$2
      `,[inventoryId,ctx.business.id]);
      if(!current.rowCount)return res.status(404).json({error:'Inventory item not found.'});

      const hasSku=Object.prototype.hasOwnProperty.call(req.body||{},'internal_sku');
      const hasBarcode=Object.prototype.hasOwnProperty.call(req.body||{},'barcode');
      const internalSku=hasSku?normalizeInternalSku(req.body.internal_sku):normalizeInternalSku(current.rows[0].internal_sku);
      const barcode=hasBarcode?normalizeBarcode(req.body.barcode):normalizeBarcode(current.rows[0].barcode);
      const conflict=await conflictFor(pool,{
        businessId:ctx.business.id,inventoryId,internalSku,barcode
      });
      if(conflict)return res.status(409).json(conflictPayload(conflict));

      try{
        const saved=await pool.query(`
          UPDATE inventory
             SET internal_sku=$1,barcode=$2,updated_at=NOW()
           WHERE id=$3 AND business_id=$4
           RETURNING *
        `,[internalSku,barcode,inventoryId,ctx.business.id]);
        return res.json(saved.rows[0]);
      }catch(error){
        if(error?.code!=='23505')throw error;
        const raceConflict=await conflictFor(pool,{
          businessId:ctx.business.id,inventoryId,internalSku,barcode
        });
        if(raceConflict)return res.status(409).json(conflictPayload(raceConflict));
        return res.status(409).json({
          error:'That Inventory SKU or barcode is already assigned to another item.',
          code:'inventory_identifier_conflict'
        });
      }
    }catch(error){next(error)}
  });
}
