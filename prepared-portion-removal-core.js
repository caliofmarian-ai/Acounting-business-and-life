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
  if(!Number.isFinite(quantity)||quantity<=0)throw new RangeError('Quantity must be positive.');
  const unrounded=components.reduce((sum,c)=>{
    const perPortion=Number(c.recipe_quantity),unitCost=Number(c.unit_cost);
    if(!Number.isFinite(perPortion)||perPortion<=0||!Number.isFinite(unitCost)||unitCost<0){
      throw new RangeError('Recipe quantity and inventory unit cost must be valid.');
    }
    return sum+perPortion*unitCost*quantity;
  },0);
  return Math.round((unrounded+Number.EPSILON)*100)/100;
}
