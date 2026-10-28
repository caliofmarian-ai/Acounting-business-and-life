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

function validateAsOf(asOf){
  if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf)||
    !Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString()!==asOf){
    throw new TypeError('asOf must be a canonical UTC ISO timestamp');
  }
}

function validGroup(group){
  if(!isObject(group)||!key(group.id)||!key(group.categoryCode)||
    !key(group.matchKey)||!positive(group.version)||group.active!==true||
    group.reviewed!==true||!MATCH_KINDS.has(group.matchKind)||
    !Object.hasOwn(UNIT_FAMILIES,group.unitFamily))return false;
  if(group.matchKind==='SAME_CATEGORY_ONLY')return true;
  if(!EVIDENCE_KINDS[group.matchKind].has(group.matchEvidenceKind))return false;
  if(group.matchKind==='EXACT_PRODUCT'&&!positive(group.exactQuantityBaseUnits))return false;
  return true;
}

function explicitlyParticipates(row){
  if(row.comparisonListingConsent===true)return true;
  if(row.comparisonListingConsent===false)return false;
  if(row.comparisonListingConsent!==null&&row.comparisonListingConsent!==undefined)return false;
  return row.comparisonStoreConsent===true;
}

function eligible(row,group){
  return isObject(row)&&key(row.publicListingId)&&key(row.merchantBusinessId)&&
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
function roundedUnitPriceMinor(row,factor){
  const denominator=BigInt(row.quantityBaseUnits);
  return ((BigInt(row.priceMinor)*factor+denominator/2n)/denominator).toString();
}
function empty(group,asOf,status){
  // Never reflect rejected/untrusted group metadata into a public projection.
  const knownGroup=status!=='unverified_group';
  return {status,groupId:knownGroup&&key(group?.id)?group.id:null,
    kind:knownGroup&&MATCH_KINDS.has(group?.matchKind)?group.matchKind:null,
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
  if(!Array.isArray(listings)||listings.length>500){
    throw new TypeError('listings must be an array of at most 500 server-loaded entries');
  }
  if(!validGroup(group))return empty(group,asOf,'unverified_group');
  if(group.matchKind==='SAME_CATEGORY_ONLY')return empty(group,asOf,'category_only');
  const bestByMerchant=new Map();
  const seenPublicIds=new Set();
  let eligibleListingCount=0;
  for(const listing of listings){
    // Reject duplicate public identities *before* checking consent. Otherwise
    // a stale opt-in row could override a revoked opt-out row for the same ID,
    // or two differently priced joins could select an invented lowest price.
    if(isObject(listing)&&key(listing.publicListingId)){
      if(seenPublicIds.has(listing.publicListingId)){
        return empty(group,asOf,'ambiguous_listing_identity');
      }
      seenPublicIds.add(listing.publicListingId);
    }
    if(!eligible(listing,group))continue;
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
    groupId:group.id,
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
      normalizedUnitPriceMinorRounded:roundedUnitPriceMinor(row,unit.factor),
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
