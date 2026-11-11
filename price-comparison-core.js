/**
 * Internal marketplace price-comparison calculation V1A (#16).
 *
 * This is an inert, provider-free calculation helper, NOT an API or a matcher.
 * The caller MUST load merchant publication, current price, explicit comparison
 * consent and reviewed match membership from authorized server-side records.
 * Never accept group approval, opt-in or business identity from a client body.
 */
const UNIT_FAMILIES=Object.freeze({
  mass: Object.freeze({base:'g',per:'kg',factor:1000n}),
  volume: Object.freeze({base:'ml',per:'L',factor:1000n}),
  count: Object.freeze({base:'piece',per:'piece',factor:1n})
});
const MATCH_KINDS=new Set(['EXACT_PRODUCT','COMPARABLE_PRODUCT','SAME_CATEGORY_ONLY']);
const EVIDENCE_KINDS=Object.freeze({
  EXACT_PRODUCT:new Set(['gtin','manufacturer_model','manual_review']),
  COMPARABLE_PRODUCT:new Set(['structured_attributes','manual_review'])
});
const key=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const lexical=(a,b)=>a<b?-1:a>b?1:0;
// Approval, publication, business binding and consent must originate from
// explicit server snapshot fields, never from an inherited/prototype default.
// Server projections must contain own *data* properties, not accessors that
// can return different consent, identity or price values across validation/use.
const isOwnData=(record,field)=>{
  const descriptor=Object.getOwnPropertyDescriptor(record,field);
  return descriptor!==undefined&&Object.hasOwn(descriptor,'value');
};
const hasAllOwn=(record,fields)=>fields.every(field=>isOwnData(record,field));
// Read each server-projected field exactly once. A Proxy can expose a safe
// own-data descriptor while returning an unrelated value on a later `get`;
// authorization, consent and prices must use the same immutable observation.
function ownDataSnapshot(record,fields){
  if(!isObject(record))return null;
  const data=Object.create(null);
  let valid=true;
  for(const field of fields){
    let descriptor;
    try{descriptor=Object.getOwnPropertyDescriptor(record,field)}catch{return null}
    if(descriptor){
      if(Object.hasOwn(descriptor,'value'))data[field]=descriptor.value;
      else valid=false;
    }
  }
  // Keep plain identity data for duplicate detection even when an optional
  // field is an accessor. Such a row cannot participate in comparisons.
  return {data,valid};
}
const GROUP_PROOF_FIELDS=Object.freeze([
  'id','categoryCode','matchKey','matchKind','version','active','reviewed','unitFamily'
]);
const LISTING_PROOF_FIELDS=Object.freeze([
  'publicListingId','merchantBusinessId','published','available','currency',
  'priceMinor','quantityBaseUnits','unitFamily','categoryCode','comparisonGroupId',
  'approvedMatchKey','approvedMatchVersion','approvedMatchStatus'
]);
const GROUP_SNAPSHOT_FIELDS=Object.freeze([
  ...GROUP_PROOF_FIELDS,'matchEvidenceKind','exactQuantityBaseUnits'
]);
const LISTING_SNAPSHOT_FIELDS=Object.freeze([
  ...LISTING_PROOF_FIELDS,'comparisonStoreConsent','comparisonListingConsent'
]);

function validateAsOf(asOf){
  if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf)||
    !Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString()!==asOf){
    throw new TypeError('asOf must be a canonical UTC ISO timestamp');
  }
}

function validGroup(group){
  if(!isObject(group)||!hasAllOwn(group,GROUP_PROOF_FIELDS)||!key(group.id)||!key(group.categoryCode)||
    !key(group.matchKey)||!positive(group.version)||group.active!==true||
    group.reviewed!==true||!MATCH_KINDS.has(group.matchKind)||
    !Object.hasOwn(UNIT_FAMILIES,group.unitFamily))return false;
  if(group.matchKind==='SAME_CATEGORY_ONLY')return true;
  if(!isOwnData(group,'matchEvidenceKind')||!EVIDENCE_KINDS[group.matchKind].has(group.matchEvidenceKind))return false;
  if(group.matchKind==='EXACT_PRODUCT'&&(!isOwnData(group,'exactQuantityBaseUnits')||!positive(group.exactQuantityBaseUnits)))return false;
  return true;
}

function explicitlyParticipates(row){
  if(Object.hasOwn(row,'comparisonListingConsent')&&!isOwnData(row,'comparisonListingConsent'))return false;
  const override=isOwnData(row,'comparisonListingConsent')?row.comparisonListingConsent:undefined;
  if(override===true)return true;
  if(override===false)return false;
  if(override!==null&&override!==undefined)return false;
  return isOwnData(row,'comparisonStoreConsent')&&row.comparisonStoreConsent===true;
}

function eligible(row,group){
  return isObject(row)&&hasAllOwn(row,LISTING_PROOF_FIELDS)&&key(row.publicListingId)&&key(row.merchantBusinessId)&&
    row.published===true&&row.available===true&&explicitlyParticipates(row)&&
    row.currency==='PHP'&&nonnegative(row.priceMinor)&&positive(row.quantityBaseUnits)&&
    row.unitFamily===group.unitFamily&&row.categoryCode===group.categoryCode&&
    row.comparisonGroupId===group.id&&row.approvedMatchKey===group.matchKey&&
    row.approvedMatchVersion===group.version&&row.approvedMatchStatus==='verified'&&
    (group.matchKind!=='EXACT_PRODUCT'||row.quantityBaseUnits===group.exactQuantityBaseUnits);
}

function compareCost(a,b,kind){
  if(kind==='EXACT_PRODUCT')return a.priceMinor<b.priceMinor?-1:a.priceMinor>b.priceMinor?1:0;
  // Cross-multiply integer minor units. Rounded display values never choose a winner.
  const left=BigInt(a.priceMinor)*BigInt(b.quantityBaseUnits);
  const right=BigInt(b.priceMinor)*BigInt(a.quantityBaseUnits);
  return left<right?-1:left>right?1:0;
}
// Preserve the exact minor-unit fraction as well as the rounded presentation.
// A positive sub-cent unit price may round to zero but is never actually free.
function normalizedUnitPriceBreakdown(row,factor){
  const numerator=BigInt(row.priceMinor)*factor;
  const denominator=BigInt(row.quantityBaseUnits);
  return {
    normalizedUnitPriceMinorRounded:((numerator+denominator/2n)/denominator).toString(),
    normalizedUnitPriceMinorNumerator:numerator.toString(),
    normalizedUnitPriceMinorDenominator:denominator.toString(),
    normalizedUnitPriceBelowOneCent:numerator>0n&&numerator<denominator
  };
}
function empty(group,asOf,status){
  // Server-curated group identifiers are internal even when a group is verified;
  // never reflect them into any public projection (including error statuses).
  const knownGroup=status!=='unverified_group';
  return {status,groupId:null,
    kind:knownGroup&&isObject(group)&&isOwnData(group,'matchKind')&&
      MATCH_KINDS.has(group.matchKind)?group.matchKind:null,
    asOf,coverage:'opted_in_merchants_only',deliveryIncluded:false,
    eligibleMerchantCount:0,unitPricePer:null,listings:[],badges:[]};
}

/**
 * @param {object} params
 * @param {object} params.group server-curated, verified match group
 * @param {object[]} params.listings server-loaded published listing snapshots
 * @param {string} params.asOf server-supplied canonical ISO UTC observation time
 */
export function buildInternalPriceComparison({group,listings,asOf}={}){
  validateAsOf(asOf);
  // Array iteration can be overridden to inject unlimited rows unrelated to the
  // bounded server-projected index slots (including invented low-price sellers).
  // Capture native array length from its own data descriptor, never via a
  // user-provided iterator or a Proxy 'get' trap.
  if(!Array.isArray(listings)){
    throw new TypeError('listings must be an array of at most 500 server-loaded entries');
  }
  let lengthSlot;
  try{lengthSlot=Object.getOwnPropertyDescriptor(listings,'length')}catch{
    throw new TypeError('listings length must be an own data slot');
  }
  const listingCount=lengthSlot?.value;
  if(!Object.hasOwn(lengthSlot??{},'value')||
    !Number.isSafeInteger(listingCount)||listingCount<0||listingCount>500){
    throw new TypeError('listings must be an array of at most 500 server-loaded entries');
  }
  const groupSnapshot=ownDataSnapshot(group,GROUP_SNAPSHOT_FIELDS);
  group=groupSnapshot?.valid?groupSnapshot.data:null;
  if(!validGroup(group))return empty(group,asOf,'unverified_group');
  if(group.matchKind==='SAME_CATEGORY_ONLY')return empty(group,asOf,'category_only');
  const bestByMerchant=new Map();
  const seenPublicIds=new Set();
  let eligibleListingCount=0;
  for(let index=0;index<listingCount;index++){
    let entry;
    try{entry=Object.getOwnPropertyDescriptor(listings,String(index))}catch{
      throw new TypeError('listings entries must be own data slots');
    }
    if(entry&&!Object.hasOwn(entry,'value')){
      throw new TypeError('listings entries must be own data slots');
    }
    const rawListing=entry?.value;
    const listingSnapshot=ownDataSnapshot(rawListing,LISTING_SNAPSHOT_FIELDS);
    const listing=listingSnapshot?.data??null;
    // Reject duplicate public identities *before* checking consent. Otherwise
    // a stale opt-in row could override a revoked opt-out row for the same ID,
    // or two differently priced joins could select an invented lowest price.
    if(isObject(listing)&&isOwnData(listing,'publicListingId')&&key(listing.publicListingId)){
      if(seenPublicIds.has(listing.publicListingId)){
        return empty(group,asOf,'ambiguous_listing_identity');
      }
      seenPublicIds.add(listing.publicListingId);
    }
    if(!listingSnapshot?.valid||!eligible(listing,group))continue;
    eligibleListingCount++;
    const candidate={
      publicListingId:listing.publicListingId,
      merchantBusinessId:listing.merchantBusinessId,
      priceMinor:listing.priceMinor,
      quantityBaseUnits:listing.quantityBaseUnits
    };
    const previous=bestByMerchant.get(candidate.merchantBusinessId);
    if(!previous||compareCost(candidate,previous,group.matchKind)<0||
      (compareCost(candidate,previous,group.matchKind)===0&&
        lexical(candidate.publicListingId,previous.publicListingId)<0)){
      bestByMerchant.set(candidate.merchantBusinessId,candidate);
    }
  }
  const rows=[...bestByMerchant.values()].sort((a,b)=>
    compareCost(a,b,group.matchKind)||lexical(a.publicListingId,b.publicListingId));
  const canAward=rows.length>=2;
  const winners=canAward?rows.filter(row=>compareCost(row,rows[0],group.matchKind)===0)
    .map(row=>row.publicListingId):[];
  const unit=UNIT_FAMILIES[group.unitFamily];
  const badgeCode=group.matchKind==='EXACT_PRODUCT'?'LOWEST_LISTED_PRICE':'LOWEST_UNIT_PRICE';
  return {
    status:rows.length?'ready':'no_opted_in_listings',
    groupId:null,
    kind:group.matchKind,
    asOf,
    coverage:'opted_in_merchants_only',
    deliveryIncluded:false,
    eligibleMerchantCount:rows.length,
    eligibleListingCount,
    unitPricePer:unit.per,
    listings:rows.map(row=>({
      publicListingId:row.publicListingId,
      currency:'PHP',
      priceMinor:row.priceMinor,
      quantityBaseUnits:row.quantityBaseUnits,
      ...normalizedUnitPriceBreakdown(row,unit.factor),
      receivesLowestPriceBadge:winners.includes(row.publicListingId)
    })),
    badges:canAward?[{
      code:badgeCode,
      publicListingIds:winners,
      eligibleMerchantCount:rows.length,
      comparisonAsOf:asOf,
      deliveryIncluded:false
    }]:[]
  };
}
