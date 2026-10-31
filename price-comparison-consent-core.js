/**
 * Source-only comparison consent parsing (#16).
 * This normalizes explicit Merchant choices; caller MUST authenticate business
 * ownership and persist the result. It never approves product match groups.
 */
function error(label,allowInherit=false){
  return Object.assign(new TypeError(label+' must be explicit true/false'+(allowInherit?' or null (follow storefront)':'')+'.'),{status:400});
}
function parseChoice(value,label,allowInherit){
  if(value===true||value===false)return value;
  if(value==='true')return true;
  if(value==='false')return false;
  if(allowInherit&&value===null)return null;
  throw error(label,allowInherit);
}
function snapshotChoice(input,field,current,label,allowInherit){
  if(!input||typeof input!=='object'||Array.isArray(input)){
    throw Object.assign(new TypeError('Consent request must be a JSON object.'),{status:400});
  }
  const descriptor=Object.getOwnPropertyDescriptor(input,field);
  if(!descriptor)return{provided:false,value:current};
  if(!Object.hasOwn(descriptor,'value'))throw error(label,allowInherit);
  return{provided:true,value:parseChoice(descriptor.value,label,allowInherit)};
}
/** Storefront choice defaults to OFF; omitted choice preserves the stored value. */
export function normalizeStoreComparisonConsent(input={},stored=false){
  return snapshotChoice(input,'price_comparison_enabled',stored===true,
    'Storefront price comparison consent',false);
}
/** Null follows storefront; explicit listing ON/OFF overrides it. */
export function normalizeListingComparisonConsent(input={},stored=null){
  const prior=stored===true?true:stored===false?false:null;
  return snapshotChoice(input,'price_comparison_override',prior,
    'Listing price comparison consent',true);
}
