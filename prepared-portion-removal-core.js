// Prepared recipe portions removed without a sale: never create a cash transaction.
export const PREPARED_REMOVAL_REASONS=Object.freeze({
  owner_consumption:'Owner consumption',
  damaged:'Damaged prepared food',
  spoilage:'Spoiled prepared food',
  quality_rejected:'Rejected at quality control'
});
export const preparedRemovalTreatment=reason=>reason==='owner_consumption'?'noncash_owner_draw':'noncash_product_loss';
export function parsePreparedRemoval(body,expectedBusinessId){
  const businessId=Number(body?.business_id);
  if(!Number.isSafeInteger(businessId)||businessId!==Number(expectedBusinessId)){
    throw Object.assign(new Error('Merchant business changed. Reopen Quick Sale and try again.'),{status:409});
  }
  const productId=Number(body?.product_id),quantity=Number(body?.quantity);
  const reason=String(body?.reason||'').trim();
  const idempotencyKey=String(body?.idempotency_key||'').trim();
  if(!Number.isSafeInteger(productId)||productId<1||!Number.isFinite(quantity)||quantity<=0||quantity>9999||
     Math.abs(quantity*10000-Math.round(quantity*10000))>1e-7||
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
