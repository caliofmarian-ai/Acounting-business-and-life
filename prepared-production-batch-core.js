// Durable prepared-production batch ledger helpers.
// This ledger records produced portions and append-only sale/non-sale allocations;
// it is not a second Inventory balance and never deducts ingredients on batch creation.
const positiveId=value=>{
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?value:null;
  if(typeof value!=='string'||!(/^[1-9]\\d*$/.test(value)))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)?n:null;
};
const portions=value=>{
  if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='number'&&!Number.isFinite(value)))return null;
  const text=String(value);
  if(!/^(?:0|[1-9]\\d{0,3})(?:\\.\\d{1,4})?$/.test(text))return null;
  const n=Number(text);
  return n>0&&n<=9999?n:null;
};
const scaled=(value,decimals,label)=>{
  if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='number'&&!Number.isFinite(value)))throw new RangeError(label+' must be a finite decimal.');
  const match=/^(\\d+)(?:\\.(\\d+))?$/.exec(String(value).trim());
  if(!match||match[2]?.length>decimals)throw new RangeError(label+' has invalid precision.');
  return BigInt(match[1])*10n**BigInt(decimals)+BigInt((match[2]||'').padEnd(decimals,'0')||'0');
};
export function parsePreparedProductionBatch(body,expectedBusinessId){
  const businessId=positiveId(body?.business_id),authorizedBusinessId=positiveId(expectedBusinessId);
  if(businessId===null||authorizedBusinessId===null||businessId!==authorizedBusinessId){
    throw Object.assign(new Error('Merchant business changed. Reopen Quick Sale and try again.'),{status:409});
  }
  const productId=positiveId(body?.product_id),producedQuantity=portions(body?.produced_quantity);
  const idempotencyKey=typeof body?.idempotency_key==='string'?body.idempotency_key.trim():'';
  if(productId===null||producedQuantity===null){
    throw Object.assign(new Error('Choose a prepared product and a valid produced portion quantity.'),{status:400});
  }
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)){
    throw Object.assign(new Error('Production batch confirmation key is invalid. Reopen the form.'),{status:400});
  }
  return{businessId,productId,producedQuantity,idempotencyKey};
}
export function parsePreparedProductionBatchId(value){
  if(value==null||value==='')return null;
  const id=positiveId(value);
  if(id===null)throw Object.assign(new Error('Select a valid prepared production batch.'),{status:400});
  return id;
}
export function normalizePreparedBatchComponents(rows){
  if(!Array.isArray(rows)||!rows.length)throw new RangeError('Prepared batch recipe ingredients are required.');
  const seen=new Set();
  return rows.map(row=>{
    const inventoryId=positiveId(row?.inventory_id);
    if(inventoryId===null||seen.has(inventoryId))throw new RangeError('Prepared batch recipe has a missing or duplicate Inventory item.');
    seen.add(inventoryId);
    const item=typeof row.item==='string'?row.item.trim().slice(0,100):'';
    const unit=typeof row.unit==='string'?row.unit.trim().slice(0,20):'';
    const recipeQuantity=scaled(row.recipe_quantity,4,'Recipe quantity');
    const unitCost=scaled(row.unit_cost,6,'Inventory unit cost');
    if(!item||!unit||recipeQuantity<=0n)throw new RangeError('Prepared batch recipe component is incomplete.');
    return{inventory_id:inventoryId,item,unit,recipe_quantity:String(row.recipe_quantity),unit_cost:String(row.unit_cost)};
  });
}
export function preparedBatchUnitCost(components){
  if(!Array.isArray(components)||!components.length)throw new RangeError('Prepared batch recipe ingredients are required.');
  const exact=components.reduce((sum,row)=>sum+
    scaled(row.recipe_quantity,4,'Recipe quantity')*scaled(row.unit_cost,6,'Inventory unit cost'),0n);
  const result=Number(exact)/1e10;
  if(!Number.isFinite(result)||result<0)throw new RangeError('Prepared batch unit cost is invalid.');
  return Number(result.toFixed(6));
}
export function preparedBatchRemaining(produced,sold,nonSale){
  const p=scaled(produced,4,'Produced quantity'),s=scaled(sold,4,'Sold quantity'),n=scaled(nonSale,4,'Non-sale quantity');
  if(p<=0n||s<0n||n<0n||s+n>p)throw new RangeError('Prepared batch allocations exceed its produced quantity.');
  return Number(p-s-n)/10000;
}
