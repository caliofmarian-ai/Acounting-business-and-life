const EPS=1e-9;
const DAY_MS=24*60*60*1000;

function finiteNonNegative(value,name){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new RangeError(`${name} must be zero or greater`);
  return n;
}
function dateMs(value){
  if(value==null||value==='')return null;
  const ms=new Date(value).getTime();
  return Number.isFinite(ms)?ms:null;
}

export function inventoryLotExpiryStatus(expiresAt,{now=Date.now(),soonDays=3}={}){
  const exp=dateMs(expiresAt);
  if(exp==null)return expiresAt?'invalid':'no_expiry';
  const delta=exp-Number(now);
  if(delta<=0)return'expired';
  if(delta<=Math.max(0,Number(soonDays)||0)*DAY_MS)return'expiring_soon';
  return'ok';
}

export function sortFefoLots(lots=[]){
  return [...lots].sort((a,b)=>{
    const ae=dateMs(a.expires_at),be=dateMs(b.expires_at);
    if(ae!=null&&be!=null&&ae!==be)return ae-be;
    if(ae!=null&&be==null)return-1;
    if(ae==null&&be!=null)return 1;
    const ar=dateMs(a.received_at)||dateMs(a.created_at)||0;
    const br=dateMs(b.received_at)||dateMs(b.created_at)||0;
    if(ar!==br)return ar-br;
    return Number(a.id||0)-Number(b.id||0);
  });
}

export function planFefoAllocation({
  quantityNeeded,
  inventoryQuantity,
  lots=[],
  now=Date.now()
}={}){
  const needed=finiteNonNegative(quantityNeeded,'quantityNeeded');
  const stock=finiteNonNegative(inventoryQuantity,'inventoryQuantity');
  const positiveLots=(Array.isArray(lots)?lots:[])
    .map(l=>({...l,quantity_remaining_base:Number(l.quantity_remaining_base||0)}))
    .filter(l=>Number.isFinite(l.quantity_remaining_base)&&l.quantity_remaining_base>EPS);
  const trackedTotal=positiveLots.reduce((sum,l)=>sum+l.quantity_remaining_base,0);
  const untrackedAvailable=Math.max(0,stock-trackedTotal);
  const eligible=sortFefoLots(positiveLots.filter(l=>{
    const state=String(l.lot_state||'available');
    if(state!=='available')return false;
    return inventoryLotExpiryStatus(l.expires_at,{now})!=='expired';
  }));
  const eligibleTotal=eligible.reduce((sum,l)=>sum+l.quantity_remaining_base,0);
  const usable=Math.min(stock,untrackedAvailable+eligibleTotal);
  if(needed>usable+EPS){
    return{
      ok:false,
      required:needed,
      inventory_quantity:stock,
      usable_quantity:usable,
      lot_tracked_quantity:trackedTotal,
      eligible_lot_quantity:eligibleTotal,
      untracked_quantity:untrackedAvailable,
      blocked_quantity:Math.max(0,needed-usable),
      allocations:[],
      untracked_used:0
    };
  }
  let remaining=needed;
  const allocations=[];
  for(const lot of eligible){
    if(remaining<=EPS)break;
    const use=Math.min(remaining,lot.quantity_remaining_base);
    if(use>EPS)allocations.push({lot_id:Number(lot.id),quantity:use,expires_at:lot.expires_at||null});
    remaining-=use;
  }
  const untrackedUsed=Math.max(0,remaining);
  if(untrackedUsed>untrackedAvailable+EPS){
    throw new RangeError('FEFO allocation could not reconcile tracked and untracked stock');
  }
  return{
    ok:true,
    required:needed,
    inventory_quantity:stock,
    usable_quantity:usable,
    lot_tracked_quantity:trackedTotal,
    eligible_lot_quantity:eligibleTotal,
    untracked_quantity:untrackedAvailable,
    allocations,
    untracked_used:untrackedUsed
  };
}

export function planPhysicalStockReduction({
  quantityToRemove,
  inventoryQuantity,
  lots=[],
  explicitLotId=null,
  mode='loss',
  expiredOnly=false,
  now=Date.now()
}={}){
  const needed=finiteNonNegative(quantityToRemove,'quantityToRemove');
  const stock=finiteNonNegative(inventoryQuantity,'inventoryQuantity');
  if(needed>stock+EPS)return{ok:false,reason:'aggregate_shortage',required:needed,available:stock,allocations:[],untracked_used:0};

  const positiveLots=(Array.isArray(lots)?lots:[])
    .map(l=>({...l,quantity_remaining_base:Number(l.quantity_remaining_base||0)}))
    .filter(l=>Number.isFinite(l.quantity_remaining_base)&&l.quantity_remaining_base>EPS);
  const trackedTotal=positiveLots.reduce((sum,l)=>sum+l.quantity_remaining_base,0);
  const untrackedAvailable=Math.max(0,stock-trackedTotal);
  let remaining=needed,untrackedUsed=0;
  const allocations=[];

  const takeFromLot=lot=>{
    if(remaining<=EPS)return;
    const use=Math.min(remaining,lot.quantity_remaining_base);
    if(use>EPS){
      allocations.push({
        lot_id:Number(lot.id),
        quantity:use,
        expires_at:lot.expires_at||null,
        lot_state:String(lot.lot_state||'available'),
        internal_lot_code:lot.internal_lot_code||'',
        supplier_lot_code:lot.supplier_lot_code||''
      });
      remaining-=use;
    }
  };

  if(explicitLotId!=null){
    const lot=positiveLots.find(l=>Number(l.id)===Number(explicitLotId));
    if(!lot)return{ok:false,reason:'lot_not_found',required:needed,available:0,allocations:[],untracked_used:0};
    if(expiredOnly&&inventoryLotExpiryStatus(lot.expires_at,{now})!=='expired'){
      return{ok:false,reason:'lot_not_expired',required:needed,available:lot.quantity_remaining_base,allocations:[],untracked_used:0};
    }
    if(lot.quantity_remaining_base+EPS<needed){
      return{ok:false,reason:'lot_shortage',required:needed,available:lot.quantity_remaining_base,allocations:[],untracked_used:0};
    }
    takeFromLot(lot);
  }else if(mode==='count'){
    untrackedUsed=Math.min(remaining,untrackedAvailable);
    remaining-=untrackedUsed;
    for(const lot of sortFefoLots(positiveLots)){
      if(remaining<=EPS)break;
      takeFromLot(lot);
    }
  }else{
    const candidates=sortFefoLots(expiredOnly
      ?positiveLots.filter(l=>inventoryLotExpiryStatus(l.expires_at,{now})==='expired')
      :positiveLots);
    for(const lot of candidates){
      if(remaining<=EPS)break;
      takeFromLot(lot);
    }
    if(remaining>EPS){
      untrackedUsed=Math.min(remaining,untrackedAvailable);
      remaining-=untrackedUsed;
    }
  }

  if(remaining>EPS){
    return{
      ok:false,
      reason:expiredOnly?'expired_stock_shortage':'physical_stock_reconciliation_shortage',
      required:needed,
      available:needed-remaining,
      allocations:[],
      untracked_used:0
    };
  }
  return{
    ok:true,
    required:needed,
    inventory_quantity:stock,
    tracked_quantity:trackedTotal,
    untracked_quantity:untrackedAvailable,
    allocations,
    untracked_used:untrackedUsed
  };
}

