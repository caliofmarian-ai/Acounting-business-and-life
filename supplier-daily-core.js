export const SUPPLIER_TODAY_BUCKETS=Object.freeze({
  new_orders:new Set(['sent','supplier_received']),
  prepare:new Set(['accepted','partially_accepted','preparing']),
  ready:new Set(['ready_for_pickup','out_for_delivery','delivered','partially_received']),
  completed:new Set(['received'])
});

function asDate(value){
  if(value==null||value==='')return null;
  if(value instanceof Date)return Number.isNaN(value.getTime())?null:value;
  const d=new Date(value);
  return Number.isNaN(d.getTime())?null:d;
}

export function supplierTodayBucket(status){
  const s=String(status||'');
  for(const [bucket,set] of Object.entries(SUPPLIER_TODAY_BUCKETS)){
    if(set.has(s))return bucket;
  }
  return null;
}

function dateKey(value){
  if(value==null||value==='')return null;
  const d=value instanceof Date?value:new Date(value);
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}

export function supplierOrderAttention(order,{now=new Date()}={}){
  const signals=[];
  const status=String(order?.status||'');
  if(status==='partially_accepted')signals.push('PARTIAL_ACCEPTANCE_FOLLOW_UP');

  const ready=asDate(order?.supplier_ready_at);
  if(ready&&ready.getTime()<now.getTime()&&SUPPLIER_TODAY_BUCKETS.prepare.has(status)){
    signals.push('READY_TIME_OVERDUE');
  }

  const eta=asDate(order?.supplier_delivery_eta);
  if(eta&&eta.getTime()<now.getTime()&&status==='out_for_delivery'){
    signals.push('DELIVERY_ETA_OVERDUE');
  }

  if(['delivered','partially_received'].includes(status))signals.push('AWAITING_MERCHANT_RECEIPT');

  const outstanding=Number(order?.commercial_outstanding||0);
  const dueKey=dateKey(order?.earliest_due_date);
  const todayKey=dateKey(now);
  if(outstanding>0&&dueKey&&todayKey&&dueKey<todayKey){
    signals.push('RECEIVABLE_OVERDUE');
  }

  return signals;
}

export function supplierCatalogAttention(item,{today=new Date()}={}){
  const signals=[];
  const availability=String(item?.availability_status||'available');
  if(availability==='limited')signals.push('LIMITED');
  if(availability==='unavailable')signals.push('UNAVAILABLE');
  const restock=asDate(item?.expected_restock_date);
  if(restock&&restock.getTime()<new Date(today.toISOString().slice(0,10)+'T23:59:59Z').getTime()
    &&availability!=='available'){
    signals.push('RESTOCK_DATE_PASSED');
  }
  return signals;
}

export function summarizeSupplierToday({
  orders=[],
  rfqs=[],
  returns=[],
  catalog=[],
  now=new Date()
}={}){
  const sections={new_orders:[],prepare:[],ready:[],completed:[]};
  let receivableTotal=0,overdueReceivableTotal=0;
  const merchantBalances=new Set();
  let overdueTiming=0;

  for(const order of orders){
    const bucket=supplierTodayBucket(order.status);
    const signals=supplierOrderAttention(order,{now});
    const row={...order,attention_signals:signals};
    if(bucket)sections[bucket].push(row);
    const outstanding=Math.max(0,Number(order.commercial_outstanding||0));
    receivableTotal+=outstanding;
    if(outstanding>0)merchantBalances.add(Number(order.business_id));
    if(signals.includes('RECEIVABLE_OVERDUE'))overdueReceivableTotal+=outstanding;
    if(signals.includes('READY_TIME_OVERDUE')||signals.includes('DELIVERY_ETA_OVERDUE'))overdueTiming++;
  }

  const catalogAttention=catalog.map(item=>({
    ...item,attention_signals:supplierCatalogAttention(item,{today:now})
  })).filter(x=>x.attention_signals.length);

  return{
    sections,
    rfqs,
    returns,
    catalog_attention:catalogAttention,
    counts:{
      new_orders:sections.new_orders.length,
      prepare:sections.prepare.length,
      ready:sections.ready.length,
      completed:sections.completed.length,
      rfqs:rfqs.length,
      returns:returns.length,
      catalog_attention:catalogAttention.length,
      merchant_balances:merchantBalances.size,
      overdue_timing:overdueTiming
    },
    money:{
      receivable_total:Math.round(receivableTotal*100)/100,
      overdue_receivable_total:Math.round(overdueReceivableTotal*100)/100
    }
  };
}
