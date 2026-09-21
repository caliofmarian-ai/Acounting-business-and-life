const finite=(v,label)=>{
  const n=Number(v);
  if(!Number.isFinite(n))throw new TypeError(`${label} must be finite`);
  return n;
};
const positive=(v,label)=>{
  const n=finite(v,label);
  if(n<=0)throw new RangeError(`${label} must be greater than zero`);
  return n;
};
const nonNegative=(v,label)=>{
  const n=finite(v,label);
  if(n<0)throw new RangeError(`${label} cannot be negative`);
  return n;
};

export function unconfirmedPacks({orderedPacks,confirmedPacks}={}){
  const ordered=nonNegative(orderedPacks,'orderedPacks');
  const confirmed=nonNegative(confirmedPacks,'confirmedPacks');
  return Math.max(0,ordered-confirmed);
}

export function validateBackorderProposal({orderedPacks,confirmedPacks,proposedPacks}={}){
  const proposed=positive(proposedPacks,'proposedPacks');
  const remaining=unconfirmedPacks({orderedPacks,confirmedPacks});
  if(remaining<=0)throw new RangeError('Purchase order item has no unconfirmed remainder');
  if(proposed>remaining+1e-9)throw new RangeError('Backorder proposal exceeds unconfirmed remainder');
  return{proposed_packs:proposed,unconfirmed_remainder:remaining};
}

export function validateSubstitutionProposal({
  orderedPacks,confirmedPacks,proposedPacks,pricePerPack
}={}){
  const proposed=positive(proposedPacks,'proposedPacks');
  const price=nonNegative(pricePerPack,'pricePerPack');
  const remaining=unconfirmedPacks({orderedPacks,confirmedPacks});
  if(remaining<=0)throw new RangeError('Purchase order item has no unconfirmed remainder');
  if(proposed>remaining+1e-9)throw new RangeError('Substitution proposal exceeds unconfirmed remainder');
  return{
    proposed_packs:proposed,
    price_per_pack:Math.round((price+Number.EPSILON)*100)/100,
    unconfirmed_remainder:remaining
  };
}

export function exceptionStateAfterMerchantDecision({currentState,accept}={}){
  if(currentState!=='proposed')throw new RangeError('Only a proposed exception may receive a Merchant decision');
  return accept?'merchant_accepted':'merchant_declined';
}

export function backorderFulfilmentDelta({state,orderedPacks,confirmedPacks,proposedPacks}={}){
  if(state!=='merchant_accepted')throw new RangeError('Merchant-accepted backorder required before fulfilment');
  const validated=validateBackorderProposal({orderedPacks,confirmedPacks,proposedPacks});
  return{
    add_confirmed_packs:validated.proposed_packs,
    new_confirmed_packs:Number(confirmedPacks)+validated.proposed_packs,
    ordered_packs:Number(orderedPacks)
  };
}
