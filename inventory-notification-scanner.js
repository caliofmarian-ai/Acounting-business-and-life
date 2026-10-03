import {inventoryAvailabilityRows} from './inventory-lot-runtime.js';
import {businessNotificationRecipients,emitNotificationEvent} from './notification-core.js';

const SIGNALS=new Set(['low_stock','out_of_stock','expiring_soon','expired','held']);
const DAY_MS=24*60*60*1000;
const num=v=>Number(v||0);
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);

export async function ensureInventoryNotificationSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_notification_states (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      signal_code TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      episode INTEGER NOT NULL DEFAULT 0 CHECK(episode>=0),
      last_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      activated_at TIMESTAMPTZ,
      cleared_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,entity_type,entity_id,signal_code),
      CHECK(entity_type IN ('inventory_item','inventory_lot')),
      CHECK(signal_code IN ('low_stock','out_of_stock','expiring_soon','expired','held'))
    );
    CREATE INDEX IF NOT EXISTS inventory_notification_states_active_idx
      ON inventory_notification_states(business_id,active,signal_code);
  `);
}

export function inventoryAttentionSignals({businessId,inventoryRows=[],lotRows=[],now=Date.now()}={}){
  const bid=Number(businessId),signals=[];
  for(const row of Array.isArray(inventoryRows)?inventoryRows:[]){
    const usable=num(row.usable_quantity??row.quantity),threshold=num(row.reorder_level);
    if(usable<=0){
      signals.push({
        business_id:bid,entity_type:'inventory_item',entity_id:Number(row.id),signal_code:'out_of_stock',
        priority:'high',
        data:{action:'open_inventory',business_id:bid,inventory_id:Number(row.id),item:clean(row.item),unit:clean(row.unit||row.base_unit,30),usable_quantity:usable,physical_quantity:num(row.physical_quantity??row.quantity),blocked_quantity:num(row.blocked_quantity),reorder_level:threshold}
      });
    }else if(usable<=threshold){
      signals.push({
        business_id:bid,entity_type:'inventory_item',entity_id:Number(row.id),signal_code:'low_stock',
        priority:'normal',
        data:{action:'open_inventory',business_id:bid,inventory_id:Number(row.id),item:clean(row.item),unit:clean(row.unit||row.base_unit,30),usable_quantity:usable,physical_quantity:num(row.physical_quantity??row.quantity),blocked_quantity:num(row.blocked_quantity),reorder_level:threshold}
      });
    }
  }
  for(const lot of Array.isArray(lotRows)?lotRows:[]){
    const remaining=num(lot.quantity_remaining_base);
    if(remaining<=0)continue;
    const state=clean(lot.lot_state||'available',30).toLowerCase();
    const exp=lot.expires_at?new Date(lot.expires_at).getTime():null;
    const common={
      action:'open_inventory',business_id:bid,inventory_id:Number(lot.inventory_id),lot_id:Number(lot.id),
      item:clean(lot.item_name),lot_code:clean(lot.supplier_lot_code||lot.internal_lot_code||('Lot '+lot.id),90),
      lot_state:state,quantity:remaining,unit:clean(lot.base_unit,30),
      expiry_text:exp&&Number.isFinite(exp)?new Date(exp).toISOString().slice(0,10):''
    };
    if(!['available','depleted'].includes(state)){
      signals.push({business_id:bid,entity_type:'inventory_lot',entity_id:Number(lot.id),signal_code:'held',priority:'high',data:common});
      continue;
    }
    if(exp&&Number.isFinite(exp)&&exp<=Number(now)){
      signals.push({business_id:bid,entity_type:'inventory_lot',entity_id:Number(lot.id),signal_code:'expired',priority:'high',data:common});
    }else if(exp&&Number.isFinite(exp)&&exp<=Number(now)+3*DAY_MS){
      signals.push({business_id:bid,entity_type:'inventory_lot',entity_id:Number(lot.id),signal_code:'expiring_soon',priority:'high',data:common});
    }
  }
  return signals;
}

async function activateSignal(pool,signal){
  if(!SIGNALS.has(signal.signal_code))return null;
  const payload=JSON.stringify(signal.data||{});
  const inserted=await pool.query(`
    INSERT INTO inventory_notification_states(
      business_id,entity_type,entity_id,signal_code,active,episode,last_payload,activated_at,cleared_at,updated_at
    ) VALUES($1,$2,$3,$4,TRUE,1,$5::jsonb,NOW(),NULL,NOW())
    ON CONFLICT(business_id,entity_type,entity_id,signal_code) DO NOTHING
    RETURNING episode
  `,[signal.business_id,signal.entity_type,signal.entity_id,signal.signal_code,payload]);
  if(inserted.rowCount)return{activated:true,episode:Number(inserted.rows[0].episode)};
  const reactivated=await pool.query(`
    UPDATE inventory_notification_states
       SET active=TRUE,episode=episode+1,last_payload=$5::jsonb,activated_at=NOW(),cleared_at=NULL,updated_at=NOW()
     WHERE business_id=$1 AND entity_type=$2 AND entity_id=$3 AND signal_code=$4 AND active=FALSE
     RETURNING episode
  `,[signal.business_id,signal.entity_type,signal.entity_id,signal.signal_code,payload]);
  if(reactivated.rowCount)return{activated:true,episode:Number(reactivated.rows[0].episode)};
  await pool.query(`
    UPDATE inventory_notification_states
       SET last_payload=$5::jsonb,updated_at=NOW()
     WHERE business_id=$1 AND entity_type=$2 AND entity_id=$3 AND signal_code=$4
  `,[signal.business_id,signal.entity_type,signal.entity_id,signal.signal_code,payload]);
  return{activated:false,episode:null};
}

async function clearInactiveSignals(pool,businessId,currentKeys){
  const {rows}=await pool.query(`
    SELECT entity_type,entity_id,signal_code
      FROM inventory_notification_states
     WHERE business_id=$1 AND active=TRUE
  `,[Number(businessId)]);
  for(const row of rows){
    const key=`${row.entity_type}:${row.entity_id}:${row.signal_code}`;
    if(currentKeys.has(key))continue;
    await pool.query(`
      UPDATE inventory_notification_states
         SET active=FALSE,cleared_at=NOW(),updated_at=NOW()
       WHERE business_id=$1 AND entity_type=$2 AND entity_id=$3 AND signal_code=$4 AND active=TRUE
    `,[Number(businessId),row.entity_type,Number(row.entity_id),row.signal_code]);
  }
}

async function lotRowsForBusiness(pool,businessId){
  try{
    const {rows}=await pool.query(`
      SELECT id,business_id,inventory_id,item_name,internal_lot_code,supplier_lot_code,
             COALESCE(to_jsonb(supply_lots)->>'lot_state','available') lot_state,
             base_unit,quantity_remaining_base,expires_at
        FROM supply_lots
       WHERE business_id=$1 AND inventory_id IS NOT NULL AND quantity_remaining_base>0
    `,[Number(businessId)]);
    return rows;
  }catch(error){
    if(['42P01','42703'].includes(String(error?.code||'')))return[];
    throw error;
  }
}

export async function scanInventoryNotifications(pool,{now=Date.now()}={}){
  await ensureInventoryNotificationSchema(pool);
  const businesses=await pool.query(`SELECT DISTINCT business_id FROM inventory ORDER BY business_id`);
  let emitted=0,activated=0;
  for(const b of businesses.rows){
    const businessId=Number(b.business_id);
    const [inventoryRows,lotRows,recipients]=await Promise.all([
      inventoryAvailabilityRows(pool,{businessId}),
      lotRowsForBusiness(pool,businessId),
      businessNotificationRecipients(pool,businessId,'merchant')
    ]);
    const signals=inventoryAttentionSignals({businessId,inventoryRows,lotRows,now});
    const keys=new Set(signals.map(s=>`${s.entity_type}:${s.entity_id}:${s.signal_code}`));
    for(const signal of signals){
      const state=await activateSignal(pool,signal);
      if(!state?.activated)continue;
      activated++;
      if(!recipients.length)continue;
      const eventCode='inventory.'+signal.signal_code;
      await emitNotificationEvent(pool,{
        eventKey:`inventory:${businessId}:${signal.entity_type}:${signal.entity_id}:${signal.signal_code}:episode:${state.episode}`,
        eventCode,
        sourceService:'inventory',
        entityType:signal.entity_type,
        entityId:String(signal.entity_id),
        category:'operational',
        priority:signal.priority||'normal',
        mandatory:false,
        emailDefault:false,
        pushDefault:true,
        data:signal.data,
        recipients
      });
      emitted++;
    }
    await clearInactiveSignals(pool,businessId,keys);
  }
  return{businesses:businesses.rowCount,activated,emitted};
}
