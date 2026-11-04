// Prepared recipe portions removed without a sale: never create a cash transaction.
export const PREPARED_REMOVAL_REASONS=Object.freeze({
  owner_consumption:'Owner consumption',
  damaged:'Damaged prepared food',
  spoilage:'Spoiled prepared food',
  quality_rejected:'Rejected at quality control'
});
export const preparedRemovalTreatment=reason=>reason==='owner_consumption'?'noncash_owner_draw':'noncash_product_loss';
const preparedPositiveId=value=>{
  // JSON identity must not be implicitly coerced from booleans, arrays or objects.
  if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='string'&&!/^\d+$/.test(value)))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
};
const preparedPortions=value=>{
  if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='number'&&!Number.isFinite(value)))return null;
  // Match the 4-decimal recipe/stock contract exactly: no exponent, coercion
  // or epsilon tolerance that could post different quantities to DB and ledger.
  const text=String(value);
  if(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/.test(text))return null;
  const n=Number(text);
  return n>0&&n<=9999?n:null;
};
export function parsePreparedRemoval(body,expectedBusinessId){
  const businessId=preparedPositiveId(body?.business_id);
  if(businessId===null||businessId!==Number(expectedBusinessId)){
    throw Object.assign(new Error('Merchant business changed. Reopen Quick Sale and try again.'),{status:409});
  }
  const productId=preparedPositiveId(body?.product_id),quantity=preparedPortions(body?.quantity);
  const reason=typeof body?.reason==='string'?body.reason.trim():'';
  const idempotencyKey=typeof body?.idempotency_key==='string'?body.idempotency_key.trim():'';
  if(productId===null||quantity===null||
     !Object.hasOwn(PREPARED_REMOVAL_REASONS,reason)){
    throw Object.assign(new Error('Choose a prepared product, a valid portion quantity and a removal reason.'),{status:400});
  }
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)){
    throw Object.assign(new Error('Removal confirmation key is invalid. Reopen the form.'),{status:400});
  }
  return{businessId,productId,quantity,reason,idempotencyKey,treatment:preparedRemovalTreatment(reason)};
}
export function estimatedPreparedRemovalCost(components,quantity){
  // Decimal scales match PostgreSQL recipe/quantity (4dp) and unit cost (6dp).
  // Multiply and aggregate exactly before rounding once to PHP cents.
  const scaled=(value,decimals,label)=>{
    if((typeof value!=='number'&&typeof value!=='string')||
       (typeof value==='number'&&!Number.isFinite(value))){
      throw new RangeError(label+' must be a finite decimal.');
    }
    const match=/^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
    if(!match||match[2]?.length>decimals)throw new RangeError(label+' has invalid precision.');
    return BigInt(match[1])*10n**BigInt(decimals)+BigInt((match[2]||'').padEnd(decimals,'0')||'0');
  };
  const portions=scaled(quantity,4,'Quantity');
  if(portions<=0n)throw new RangeError('Quantity must be positive.');
  if(!Array.isArray(components)||!components.length)throw new RangeError('Recipe ingredients are required.');
  let exact=0n;
  for(const component of components){
    const perPortion=scaled(component.recipe_quantity,4,'Recipe quantity');
    const unitCost=scaled(component.unit_cost,6,'Inventory unit cost');
    if(perPortion<=0n)throw new RangeError('Recipe quantity must be positive.');
    exact+=perPortion*unitCost*portions;
  }
  // Exact amount is in 10^-14 PHP; positive half-cent rounds up once.
  const cents=(exact*100n+50000000000000n)/100000000000000n;
  if(cents>99999999999999n)throw new RangeError('Estimated removal cost exceeds NUMERIC(14,2).');
  return Number(cents)/100;
}
