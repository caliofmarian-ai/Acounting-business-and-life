const COUNT_TYPES=new Set(['full','cycle']);
const SCOPE_TYPES=new Set(['all','inventory_type','storage_area_type','location_id']);
const STORAGE_AREAS=new Set(['pantry','fridge','freezer','prep_station','chemical_storage','service_storage','other']);

const asNumber=value=>Number(value);
const cleanText=(value,max=300)=>String(value??'').trim().slice(0,max);

export function normalizeInventoryCountScope(body={},inventoryTypes=new Set()){
  const countType=cleanText(body.count_type,20);
  if(!COUNT_TYPES.has(countType))throw Object.assign(new Error('Choose a full inventory or cycle count.'),{status:400});
  if(countType==='full')return{count_type:'full',scope_type:'all',scope_value:''};
  const scopeType=cleanText(body.scope_type,40);
  const scopeValue=cleanText(body.scope_value,80);
  if(!SCOPE_TYPES.has(scopeType)||scopeType==='all'||!scopeValue){
    throw Object.assign(new Error('Cycle count requires an Inventory category, storage area or internal location.'),{status:400});
  }
  if(scopeType==='inventory_type'&&!inventoryTypes.has(scopeValue)){
    throw Object.assign(new Error('Choose a valid Inventory category for this cycle count.'),{status:400});
  }
  if(scopeType==='storage_area_type'&&!STORAGE_AREAS.has(scopeValue)){
    throw Object.assign(new Error('Choose a valid storage area for this cycle count.'),{status:400});
  }
  if(scopeType==='location_id'){
    const locationId=Number(scopeValue);
    if(!Number.isInteger(locationId)||locationId<=0)throw Object.assign(new Error('Choose a valid internal storage location for this cycle count.'),{status:400});
    return{count_type:'cycle',scope_type:'location_id',scope_value:String(locationId),location_id:locationId};
  }
  return{count_type:'cycle',scope_type:scopeType,scope_value:scopeValue};
}

export function serializeInventoryCountSession(session,items=[]){
  if(!session)return null;
  const status=String(session.status||'in_progress');
  const revealExpected=status!=='in_progress';
  const normalized=(items||[]).map(row=>{
    const counted=row.counted_quantity==null?null:asNumber(row.counted_quantity);
    const expected=asNumber(row.expected_quantity);
    const item={
      inventory_id:asNumber(row.inventory_id),
      item:row.item||'',
      inventory_type:row.inventory_type||'ingredient',
      storage_area_type:row.storage_area_type||'other',
      storage_condition:row.storage_condition||'other',
      storage_location_label:row.storage_location_label||'',
      location_id:row.location_id==null?null:asNumber(row.location_id),
      location_name:row.location_name||'',
      unit:row.unit_snapshot||row.unit||'',
      counted_quantity:counted,
      counted_at:row.counted_at||null,
      counted_by_account_id:row.counted_by_account_id==null?null:asNumber(row.counted_by_account_id),
      posted_adjustment_id:row.posted_adjustment_id==null?null:asNumber(row.posted_adjustment_id)
    };
    if(revealExpected){
      item.expected_quantity=expected;
      item.variance_quantity=counted==null?null:counted-expected;
    }
    return item;
  });
  return{
    id:asNumber(session.id),
    business_id:asNumber(session.business_id),
    count_type:session.count_type,
    scope_type:session.scope_type,
    scope_value:session.scope_value||'',
    location_id:session.location_id==null?null:asNumber(session.location_id),
    location_name:session.location_name||'',
    status,
    actor_account_id:session.actor_account_id==null?null:asNumber(session.actor_account_id),
    reviewed_by_account_id:session.reviewed_by_account_id==null?null:asNumber(session.reviewed_by_account_id),
    posted_by_account_id:session.posted_by_account_id==null?null:asNumber(session.posted_by_account_id),
    started_at:session.started_at||null,
    updated_at:session.updated_at||null,
    reviewed_at:session.reviewed_at||null,
    posted_at:session.posted_at||null,
    progress:{
      total:normalized.length,
      counted:normalized.filter(x=>x.counted_quantity!=null).length,
      remaining:normalized.filter(x=>x.counted_quantity==null).length
    },
    reveal_expected:revealExpected,
    items:normalized
  };
}

async function loadSession(db,{businessId,sessionId}){
  const sessionQuery=await db.query(`
    SELECT s.*,l.name location_name
      FROM inventory_count_sessions s
      LEFT JOIN inventory_storage_locations l ON l.id=s.location_id AND l.business_id=s.business_id
     WHERE s.id=$1 AND s.business_id=$2
  `,[sessionId,businessId]);
  if(!sessionQuery.rowCount)return null;
  const items=await db.query(`
    SELECT si.*,i.item,i.inventory_type,i.storage_area_type,i.storage_condition,i.storage_location_label,i.unit,
           l.name location_name
      FROM inventory_count_session_items si
      JOIN inventory i ON i.id=si.inventory_id AND i.business_id=$2
      LEFT JOIN inventory_storage_locations l ON l.id=si.location_id AND l.business_id=$2
     WHERE si.session_id=$1
     ORDER BY i.inventory_type,i.storage_area_type,i.item,i.id
  `,[sessionId,businessId]);
  return serializeInventoryCountSession(sessionQuery.rows[0],items.rows);
}

export async function ensureInventoryCountSessionSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_count_sessions (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      count_type TEXT NOT NULL CHECK(count_type IN ('full','cycle')),
      scope_type TEXT NOT NULL CHECK(scope_type IN ('all','inventory_type','storage_area_type','location_id')),
      scope_value TEXT NOT NULL DEFAULT '',
      location_id BIGINT REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','review','posted','cancelled')),
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      reviewed_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      posted_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      posted_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ
    );
    ALTER TABLE inventory_count_sessions ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT;
    ALTER TABLE inventory_count_sessions DROP CONSTRAINT IF EXISTS inventory_count_sessions_scope_type_check;
    ALTER TABLE inventory_count_sessions ADD CONSTRAINT inventory_count_sessions_scope_type_check
      CHECK(scope_type IN ('all','inventory_type','storage_area_type','location_id'));

    CREATE INDEX IF NOT EXISTS inventory_count_sessions_business_idx
      ON inventory_count_sessions(business_id,started_at DESC,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_sessions_one_active_per_business
      ON inventory_count_sessions(business_id)
      WHERE status IN ('in_progress','review');

    CREATE TABLE IF NOT EXISTS inventory_count_session_items (
      session_id BIGINT NOT NULL REFERENCES inventory_count_sessions(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
      expected_quantity NUMERIC(14,4) NOT NULL CHECK(expected_quantity>=0),
      unit_snapshot TEXT NOT NULL,
      unit_cost_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0,
      counted_quantity NUMERIC(14,4) CHECK(counted_quantity>=0),
      counted_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      counted_at TIMESTAMPTZ,
      posted_adjustment_id BIGINT REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
      PRIMARY KEY(session_id,inventory_id)
    );
    ALTER TABLE inventory_count_session_items ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inventory_storage_locations(id) ON DELETE RESTRICT;

    CREATE INDEX IF NOT EXISTS inventory_count_session_items_inventory_idx
      ON inventory_count_session_items(inventory_id,session_id DESC);
  `);
}

export function registerInventoryCountSessionRoutes(app,deps){
  const {
    pool,jsonBody,accountingContext,inventoryTypes,
    canUseSupplyLots,inventoryLotRows,planPhysicalStockReduction,applyPhysicalLotReductions,
    reconcileBusinessInventoryLocations,planLocationStockReduction,applyLocationLotReductions,reconcileInventoryLocationBalance
  }=deps;

  async function merchantContext(req){
    const ctx=await accountingContext(req);
    if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});
    return ctx;
  }

  app.get('/api/inventory/count-sessions/active',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req);
      const q=await pool.query(`
        SELECT id FROM inventory_count_sessions
         WHERE business_id=$1 AND status IN ('in_progress','review')
         ORDER BY started_at DESC,id DESC LIMIT 1
      `,[ctx.business.id]);
      if(!q.rowCount)return res.json(null);
      res.json(await loadSession(pool,{businessId:ctx.business.id,sessionId:q.rows[0].id}));
    }catch(error){next(error)}
  });

  app.get('/api/inventory/count-sessions/:id',async(req,res,next)=>{
    try{
      const ctx=await merchantContext(req),sessionId=Number(req.params.id);
      if(!Number.isInteger(sessionId))return res.status(400).json({error:'Invalid count session.'});
      const payload=await loadSession(pool,{businessId:ctx.business.id,sessionId});
      if(!payload)return res.status(404).json({error:'Inventory count session not found.'});
      res.json(payload);
    }catch(error){next(error)}
  });

  app.post('/api/inventory/count-sessions',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req);
      const scope=normalizeInventoryCountScope(req.body||{},inventoryTypes);
      await client.query('BEGIN');
      const active=await client.query(`
        SELECT id FROM inventory_count_sessions
         WHERE business_id=$1 AND status IN ('in_progress','review')
         ORDER BY started_at DESC,id DESC LIMIT 1
         FOR UPDATE
      `,[ctx.business.id]);
      if(active.rowCount){
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:'An Inventory count is already in progress. Resume it before starting another.',
          active_session_id:Number(active.rows[0].id)
        });
      }
      let location=null;
      if(scope.scope_type==='location_id'){
        await reconcileBusinessInventoryLocations(client,{businessId:ctx.business.id,actorAccountId:ctx.me.account.id});
        const q=await client.query(`
          SELECT * FROM inventory_storage_locations
           WHERE id=$1 AND business_id=$2 AND active=TRUE
           FOR UPDATE
        `,[scope.location_id,ctx.business.id]);
        if(!q.rowCount)throw Object.assign(new Error('Storage location is unavailable for this count.'),{status:404});
        location=q.rows[0];
      }

      const session=await client.query(`
        INSERT INTO inventory_count_sessions(
          business_id,count_type,scope_type,scope_value,location_id,status,actor_account_id
        ) VALUES($1,$2,$3,$4,$5,'in_progress',$6)
        RETURNING *
      `,[ctx.business.id,scope.count_type,scope.scope_type,scope.scope_value,location?.id||null,ctx.me.account.id]);

      const sessionId=Number(session.rows[0].id);
      let inserted;
      if(location){
        inserted=await client.query(`
          INSERT INTO inventory_count_session_items(
            session_id,inventory_id,expected_quantity,unit_snapshot,unit_cost_snapshot,location_id
          )
          SELECT $1,b.inventory_id,b.quantity,i.unit,i.unit_cost,$3
            FROM inventory_location_balances b
            JOIN inventory i ON i.id=b.inventory_id AND i.business_id=b.business_id
           WHERE b.business_id=$2 AND b.location_id=$3 AND b.quantity>0
           ORDER BY i.item,i.id
        `,[sessionId,ctx.business.id,Number(location.id)]);
      }else{
        const filter=scope.scope_type==='inventory_type'
          ?' AND inventory_type=$3'
          :scope.scope_type==='storage_area_type'
            ?' AND storage_area_type=$3'
            :'';
        const params=scope.scope_type==='all'
          ?[sessionId,ctx.business.id]
          :[sessionId,ctx.business.id,scope.scope_value];
        inserted=await client.query(`
          INSERT INTO inventory_count_session_items(
            session_id,inventory_id,expected_quantity,unit_snapshot,unit_cost_snapshot
          )
          SELECT $1,id,quantity,unit,unit_cost
            FROM inventory
           WHERE business_id=$2${filter}
        `,params);
      }
      if(!inserted.rowCount)throw Object.assign(new Error('No Inventory items match this count scope or location.'),{status:409});
      const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
      await client.query('COMMIT');
      res.status(201).json(payload);
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      if(error?.code==='23505'&&error?.constraint==='inventory_count_sessions_one_active_per_business'){
        return res.status(409).json({error:'An Inventory count is already in progress. Resume it before starting another.'});
      }
      next(error);
    }finally{client.release()}
  });

  app.put('/api/inventory/count-sessions/:id/items/:inventoryId',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req),sessionId=Number(req.params.id),inventoryId=Number(req.params.inventoryId);
      const counted=Number(req.body?.counted_quantity);
      if(!Number.isInteger(sessionId)||!Number.isInteger(inventoryId)||!Number.isFinite(counted)||counted<0){
        return res.status(400).json({error:'Enter a valid counted quantity.'});
      }
      await client.query('BEGIN');
      const session=await client.query(`
        SELECT * FROM inventory_count_sessions
         WHERE id=$1 AND business_id=$2 FOR UPDATE
      `,[sessionId,ctx.business.id]);
      if(!session.rowCount)throw Object.assign(new Error('Inventory count session not found.'),{status:404});
      if(session.rows[0].status!=='in_progress')throw Object.assign(new Error('Return this count to counting mode before changing quantities.'),{status:409});
      const item=await client.query(`
        UPDATE inventory_count_session_items
           SET counted_quantity=$1,counted_by_account_id=$2,counted_at=NOW()
         WHERE session_id=$3 AND inventory_id=$4
         RETURNING inventory_id
      `,[counted,ctx.me.account.id,sessionId,inventoryId]);
      if(!item.rowCount)throw Object.assign(new Error('Inventory item is not part of this count session.'),{status:404});
      await client.query(`UPDATE inventory_count_sessions SET updated_at=NOW() WHERE id=$1`,[sessionId]);
      const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
      await client.query('COMMIT');
      res.json(payload);
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });

  app.post('/api/inventory/count-sessions/:id/review',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req),sessionId=Number(req.params.id);
      if(!Number.isInteger(sessionId))return res.status(400).json({error:'Invalid count session.'});
      await client.query('BEGIN');
      const session=await client.query(`
        SELECT * FROM inventory_count_sessions
         WHERE id=$1 AND business_id=$2 FOR UPDATE
      `,[sessionId,ctx.business.id]);
      if(!session.rowCount)throw Object.assign(new Error('Inventory count session not found.'),{status:404});
      if(session.rows[0].status==='posted')throw Object.assign(new Error('This count has already been posted.'),{status:409});
      const missing=await client.query(`
        SELECT COUNT(*)::int remaining
          FROM inventory_count_session_items
         WHERE session_id=$1 AND counted_quantity IS NULL
      `,[sessionId]);
      if(Number(missing.rows[0].remaining)>0){
        throw Object.assign(new Error('Count every item before reviewing expected stock and variances.'),{status:409});
      }
      await client.query(`
        UPDATE inventory_count_sessions
           SET status='review',reviewed_at=COALESCE(reviewed_at,NOW()),
               reviewed_by_account_id=$1,updated_at=NOW()
         WHERE id=$2
      `,[ctx.me.account.id,sessionId]);
      const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
      await client.query('COMMIT');
      res.json(payload);
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });

  app.post('/api/inventory/count-sessions/:id/resume',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req),sessionId=Number(req.params.id);
      if(!Number.isInteger(sessionId))return res.status(400).json({error:'Invalid count session.'});
      await client.query('BEGIN');
      const session=await client.query(`
        SELECT * FROM inventory_count_sessions
         WHERE id=$1 AND business_id=$2 FOR UPDATE
      `,[sessionId,ctx.business.id]);
      if(!session.rowCount)throw Object.assign(new Error('Inventory count session not found.'),{status:404});
      if(session.rows[0].status==='posted')throw Object.assign(new Error('A posted count cannot be changed.'),{status:409});
      if(session.rows[0].status==='cancelled')throw Object.assign(new Error('A cancelled count cannot be resumed.'),{status:409});
      await client.query(`
        UPDATE inventory_count_sessions SET status='in_progress',updated_at=NOW() WHERE id=$1
      `,[sessionId]);
      const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
      await client.query('COMMIT');
      res.json(payload);
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });

  app.post('/api/inventory/count-sessions/:id/post',jsonBody,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const ctx=await merchantContext(req),sessionId=Number(req.params.id);
      if(!Number.isInteger(sessionId))return res.status(400).json({error:'Invalid count session.'});
      const approved=new Set((Array.isArray(req.body?.approved_inventory_ids)?req.body.approved_inventory_ids:[])
        .map(Number).filter(Number.isInteger));
      await client.query('BEGIN');
      const session=await client.query(`
        SELECT * FROM inventory_count_sessions
         WHERE id=$1 AND business_id=$2 FOR UPDATE
      `,[sessionId,ctx.business.id]);
      if(!session.rowCount)throw Object.assign(new Error('Inventory count session not found.'),{status:404});
      if(session.rows[0].status==='posted'){
        const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
        await client.query('COMMIT');
        return res.json({...payload,idempotent:true});
      }
      if(session.rows[0].status!=='review')throw Object.assign(new Error('Review the completed count before posting variances.'),{status:409});

      const locationId=session.rows[0].location_id==null?null:Number(session.rows[0].location_id);
      const itemQuery=locationId==null
        ?await client.query(`
          SELECT si.*,i.item,i.inventory_type,i.storage_area_type,i.storage_condition,i.storage_location_label,
                 i.quantity current_quantity,i.quantity canonical_quantity,i.unit current_unit,i.unit_cost current_unit_cost
            FROM inventory_count_session_items si
            JOIN inventory i ON i.id=si.inventory_id AND i.business_id=$2
           WHERE si.session_id=$1
           ORDER BY i.id
           FOR UPDATE OF si,i
        `,[sessionId,ctx.business.id])
        :await client.query(`
          SELECT si.*,i.item,i.inventory_type,i.storage_area_type,i.storage_condition,i.storage_location_label,
                 lb.quantity current_quantity,i.quantity canonical_quantity,i.unit current_unit,i.unit_cost current_unit_cost,
                 l.name location_name
            FROM inventory_count_session_items si
            JOIN inventory i ON i.id=si.inventory_id AND i.business_id=$2
            JOIN inventory_location_balances lb
              ON lb.business_id=$2 AND lb.inventory_id=si.inventory_id AND lb.location_id=$3
            JOIN inventory_storage_locations l ON l.id=lb.location_id AND l.business_id=$2
           WHERE si.session_id=$1
           ORDER BY i.id
           FOR UPDATE OF si,i,lb,l
        `,[sessionId,ctx.business.id,locationId]);
      if(itemQuery.rows.some(row=>row.counted_quantity==null)){
        throw Object.assign(new Error('Count every item before posting.'),{status:409});
      }
      const stale=itemQuery.rows.filter(row=>
        Math.abs(Number(row.current_quantity)-Number(row.expected_quantity))>1e-6||
        String(row.current_unit)!==String(row.unit_snapshot)
      );
      if(stale.length){
        throw Object.assign(new Error('Inventory changed after this count started. Return to counting and recount the affected items before posting.'),{
          status:409,stale_inventory_ids:stale.map(row=>Number(row.inventory_id))
        });
      }
      const variances=itemQuery.rows.filter(row=>Math.abs(Number(row.counted_quantity)-Number(row.expected_quantity))>1e-6);
      const notApproved=variances.filter(row=>!approved.has(Number(row.inventory_id)));
      if(notApproved.length){
        throw Object.assign(new Error('Approve every variance or return to counting before posting.'),{
          status:409,unapproved_inventory_ids:notApproved.map(row=>Number(row.inventory_id))
        });
      }

      const lotTracking=await canUseSupplyLots(client);
      const postedAdjustments=[];
      for(const row of variances){
        const inventoryId=Number(row.inventory_id),countBefore=Number(row.expected_quantity);
        const countAfter=Math.max(0,Number(row.counted_quantity)),delta=countAfter-countBefore;
        const canonicalBefore=Number(row.canonical_quantity??row.current_quantity);
        const canonicalAfter=locationId==null?countAfter:canonicalBefore+delta;
        if(canonicalAfter<-1e-9)throw Object.assign(new Error('Location count variance would make business-total Inventory negative.'),{status:409,inventory_id:inventoryId});
        if(delta<0){
          const reserved=await client.query(`
            SELECT COALESCE(SUM(quantity_reserved),0) reserved
              FROM order_stock_reservations
             WHERE business_id=$1 AND stock_kind='inventory' AND stock_ref_id=$2
               AND state='reserved' AND (expires_at IS NULL OR expires_at>NOW())
          `,[ctx.business.id,inventoryId]);
          if(Number(reserved.rows[0]?.reserved||0)>1e-6){
            throw Object.assign(new Error('This item has stock reserved for an active order. Finish or release that reservation, then recount before reducing physical stock.'),{
              status:409,inventory_id:inventoryId,reserved_quantity:Number(reserved.rows[0].reserved)
            });
          }
        }
        let physicalPlan={ok:true,allocations:[],untracked_used:0},appliedLots=[];
        if(delta<0&&lotTracking){
          if(locationId!=null){
            physicalPlan=await planLocationStockReduction(client,{
              businessId:ctx.business.id,inventoryId,locationId,quantityToRemove:-delta,actorAccountId:ctx.me.account.id
            });
          }else{
            const lots=await inventoryLotRows(client,{businessId:ctx.business.id,inventoryId,lock:true});
            physicalPlan=planPhysicalStockReduction({
              quantityToRemove:-delta,
              inventoryQuantity:canonicalBefore,
              lots,
              explicitLotId:null,
              mode:'count',
              expiredOnly:false,
              now:Date.now()
            });
          }
          if(!physicalPlan.ok){
            throw Object.assign(new Error(locationId!=null
              ?'Location lot quantities cannot be reconciled with this physical count. Recount the location or correct transfer/lot evidence first.'
              :'Lot quantities cannot be reconciled with this physical count. Recount the item or correct lot evidence first.'),{
              status:409,inventory_id:inventoryId,lot_reconciliation:physicalPlan
            });
          }
          appliedLots=await applyPhysicalLotReductions(client,physicalPlan.allocations||[]);
          if(locationId!=null)await applyLocationLotReductions(client,{
            businessId:ctx.business.id,inventoryId,locationId,allocations:physicalPlan.allocations||[]
          });
        }

        await client.query(`
          UPDATE inventory SET quantity=$1,updated_at=NOW()
           WHERE id=$2 AND business_id=$3
        `,[Math.max(0,canonicalAfter),inventoryId,ctx.business.id]);
        if(locationId!=null){
          await client.query(`
            UPDATE inventory_location_balances
               SET quantity=$1,updated_at=NOW()
             WHERE business_id=$2 AND inventory_id=$3 AND location_id=$4
          `,[countAfter,ctx.business.id,inventoryId,locationId]);
        }else{
          await reconcileBusinessInventoryLocations(client,{businessId:ctx.business.id,actorAccountId:ctx.me.account.id});
        }

        if(lotTracking){
          const afterLots=await inventoryLotRows(client,{businessId:ctx.business.id,inventoryId,lock:false});
          const trackedAfter=afterLots.reduce((sum,x)=>sum+Number(x.quantity_remaining_base||0),0);
          if(trackedAfter>Math.max(0,canonicalAfter)+1e-6){
            throw Object.assign(new Error('Lot quantities would exceed the corrected Inventory quantity. Review the count or lot evidence.'),{
              status:409,inventory_id:inventoryId,tracked_quantity:trackedAfter,inventory_quantity:Math.max(0,canonicalAfter)
            });
          }
        }

        const untrackedDelta=delta>0?delta:-(Number(physicalPlan.untracked_used||0));
        const note=cleanText(req.body?.note,220);
        const saved=await client.query(`
          INSERT INTO inventory_adjustments(
            business_id,inventory_id,adjustment_kind,before_quantity,quantity_delta,after_quantity,
            unit,unit_cost_snapshot,estimated_value_delta,note,actor_account_id,untracked_quantity_delta
          ) VALUES($1,$2,'count_correction',$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING *
        `,[
          ctx.business.id,inventoryId,canonicalBefore,delta,Math.max(0,canonicalAfter),row.current_unit,Number(row.current_unit_cost||0),
          delta*Number(row.current_unit_cost||0),
          cleanText(`Inventory ${locationId!=null?'location ':''}count session #${sessionId}${locationId!=null?' · '+(row.location_name||('location '+locationId)):''}${note?' · '+note:''}`,300),
          ctx.me.account.id,untrackedDelta
        ]);
        const adjustmentId=Number(saved.rows[0].id);
        for(const allocation of appliedLots){
          await client.query(`
            INSERT INTO inventory_adjustment_lot_allocations(
              adjustment_id,inventory_id,lot_id,quantity_removed,lot_code_snapshot,lot_state_snapshot,expires_at_snapshot
            ) VALUES($1,$2,$3,$4,$5,$6,$7)
          `,[
            adjustmentId,inventoryId,Number(allocation.lot_id),Number(allocation.quantity),
            cleanText(allocation.supplier_lot_code||allocation.internal_lot_code||'',90),
            cleanText(allocation.lot_state||'',30),allocation.expires_at||null
          ]);
        }
        if(locationId!=null){
          const check=await client.query(`
            SELECT COALESCE(SUM(quantity),0) total
              FROM inventory_location_balances
             WHERE business_id=$1 AND inventory_id=$2
          `,[ctx.business.id,inventoryId]);
          if(Math.abs(Number(check.rows[0].total)-Math.max(0,canonicalAfter))>1e-6){
            throw Object.assign(new Error('Location count posting must conserve business-total stock across locations.'),{status:409,inventory_id:inventoryId});
          }
        }

        await client.query(`
          UPDATE inventory_count_session_items SET posted_adjustment_id=$1
           WHERE session_id=$2 AND inventory_id=$3
        `,[adjustmentId,sessionId,inventoryId]);
        postedAdjustments.push({inventory_id:inventoryId,adjustment_id:adjustmentId,quantity_delta:delta});
      }

      await client.query(`
        UPDATE inventory_count_sessions
           SET status='posted',posted_at=NOW(),posted_by_account_id=$1,updated_at=NOW()
         WHERE id=$2
      `,[ctx.me.account.id,sessionId]);
      const payload=await loadSession(client,{businessId:ctx.business.id,sessionId});
      await client.query('COMMIT');
      res.json({
        ...payload,
        idempotent:false,
        posted_adjustments:postedAdjustments,
        accounting_effect:'inventory_only_no_cash_movement'
      });
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      next(error);
    }finally{client.release()}
  });
}
