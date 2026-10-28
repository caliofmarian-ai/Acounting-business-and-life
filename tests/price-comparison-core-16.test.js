import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInternalPriceComparison} from '../price-comparison-core.js';

const AS_OF='2026-10-28T00:00:00.000Z';
const group=(overrides={})=>({
  id:'group-1',categoryCode:'packaged_food_drink',
  matchKey:'gtin-verified-123',matchKind:'EXACT_PRODUCT',
  matchEvidenceKind:'gtin',version:1,active:true,reviewed:true,
  unitFamily:'volume',exactQuantityBaseUnits:1000,...overrides
});
const listing=(id,business,priceMinor,overrides={})=>({
  publicListingId:id,merchantBusinessId:business,published:true,available:true,
  comparisonStoreConsent:true,comparisonListingConsent:null,
  currency:'PHP',priceMinor,quantityBaseUnits:1000,unitFamily:'volume',
  categoryCode:'packaged_food_drink',comparisonGroupId:'group-1',
  approvedMatchKey:'gtin-verified-123',approvedMatchVersion:1,
  approvedMatchStatus:'verified',...overrides
});
const calc=(list,match=group(),asOf=AS_OF)=>
  buildInternalPriceComparison({group:match,listings:list,asOf});

test('published Marketplace listing defaults OUT of comparison without explicit consent',()=>{
  const out=calc([listing('a','shop-a',9900,{comparisonStoreConsent:undefined,comparisonListingConsent:undefined})]);
  assert.equal(out.eligibleMerchantCount,0);
  assert.deepEqual(out.badges,[]);
  assert.equal(out.status,'no_opted_in_listings');
});
test('per-listing OFF overrides storefront ON and does not suppress ordinary publication',()=>{
  const excluded=listing('a','shop-a',9000,{comparisonListingConsent:false});
  const out=calc([excluded,listing('b','shop-b',10000)]);
  assert.equal(excluded.published,true);
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['b']);
  assert.deepEqual(out.badges,[]);
});
test('explicit per-listing ON overrides OFF storefront default; malformed override fails closed',()=>{
  const out=calc([
    listing('yes','shop-a',8000,{comparisonStoreConsent:false,comparisonListingConsent:true}),
    listing('no','shop-b',7000,{comparisonStoreConsent:true,comparisonListingConsent:'false'}),
    listing('plain','shop-c',9000,{comparisonStoreConsent:false,comparisonListingConsent:null})
  ]);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['yes']);
});
test('only currently published and available listings can receive a lowest-price badge',()=>{
  const out=calc([
    listing('active','a',11000),
    listing('draft','b',100,{published:false}),
    listing('out-of-stock','c',100,{available:false}),
    listing('other-currency','d',100,{currency:'EUR'})
  ]);
  assert.equal(out.eligibleMerchantCount,1);
  assert.equal(out.listings[0].priceMinor,11000);
  assert.deepEqual(out.badges,[]);
});
test('exact standardized product selects cheapest consented price and explains scope',()=>{
  const out=calc([listing('a','shop-a',12000),listing('b','shop-b',9900),listing('c','shop-c',10500)]);
  assert.equal(out.status,'ready');
  assert.equal(out.kind,'EXACT_PRODUCT');
  assert.equal(out.eligibleMerchantCount,3);
  assert.equal(out.coverage,'opted_in_merchants_only');
  assert.equal(out.asOf,AS_OF);
  assert.equal(out.deliveryIncluded,false);
  assert.equal(out.badges[0].code,'LOWEST_LISTED_PRICE');
  assert.deepEqual(out.badges[0].publicListingIds,['b']);
  assert.equal(out.listings[0].normalizedUnitPriceMinorRounded,'9900');
});
test('a single participating seller never earns an unqualified lowest badge',()=>{
  const out=calc([listing('a','a',100),listing('b','b',90,{comparisonListingConsent:false})]);
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.badges,[]);
});
test('mass normalization compares ₱60/500g against ₱110/kg using exact rational ratios',()=>{
  const g=group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes',
    categoryCode:'fresh_food',matchKey:'tomatoes-type-grade-a',unitFamily:'mass',exactQuantityBaseUnits:undefined});
  const a=listing('a','a',6000,{categoryCode:'fresh_food',approvedMatchKey:'tomatoes-type-grade-a',
    quantityBaseUnits:500,unitFamily:'mass'});
  const b=listing('b','b',11000,{categoryCode:'fresh_food',approvedMatchKey:'tomatoes-type-grade-a',
    quantityBaseUnits:1000,unitFamily:'mass'});
  const out=calc([a,b],g);
  assert.equal(out.unitPricePer,'kg');
  assert.equal(out.listings[0].publicListingId,'b');
  assert.equal(out.listings.find(x=>x.publicListingId==='a').normalizedUnitPriceMinorRounded,'12000');
  assert.equal(out.listings.find(x=>x.publicListingId==='b').normalizedUnitPriceMinorRounded,'11000');
  assert.equal(out.badges[0].code,'LOWEST_UNIT_PRICE');
});
test('volume and item-count families use separate normalized units',()=>{
  const vol=calc([
    listing('small','a',7000,{quantityBaseUnits:500}),
    listing('large','b',12000,{quantityBaseUnits:1000})
  ],group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes'}));
  assert.equal(vol.unitPricePer,'L');
  assert.equal(vol.badges[0].code,'LOWEST_UNIT_PRICE');
  assert.equal(vol.listings[0].publicListingId,'large');
  const countG=group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes',unitFamily:'count'});
  const count=calc([
    listing('a','a',1000,{unitFamily:'count',quantityBaseUnits:2}),
    listing('b','b',700,{unitFamily:'count',quantityBaseUnits:1})
  ],countG);
  assert.equal(count.unitPricePer,'piece');
  assert.equal(count.listings[0].normalizedUnitPriceMinorRounded,'500');
});
test('different merchant-made burgers in same category do not get price-comparison badges',()=>{
  const out=calc([
    listing('chicken-burger','a',9000),listing('crispy-chicken','b',10000)
  ],group({matchKind:'SAME_CATEGORY_ONLY',matchEvidenceKind:undefined}));
  assert.equal(out.status,'category_only');
  assert.equal(out.eligibleMerchantCount,0);
  assert.deepEqual(out.listings,[]);
  assert.deepEqual(out.badges,[]);
});
test('unverified, inactive or unsupported matching groups fail closed',()=>{
  for(const overrides of [{reviewed:false},{active:false},{matchKind:'FUZZY_NAME'},
    {matchEvidenceKind:'name_similarity'},{exactQuantityBaseUnits:null},{version:0}]){
    const out=calc([listing('a','a',100),listing('b','b',200)],group(overrides));
    assert.equal(out.status,'unverified_group');
    assert.deepEqual(out.listings,[]);
  }
});
test('stale group version, wrong group or mismatched product identity cannot join',()=>{
  const out=calc([
    listing('valid','a',10000),
    listing('stale','b',100,{approvedMatchVersion:0}),
    listing('other-group','c',100,{comparisonGroupId:'group-2'}),
    listing('other-product','d',100,{approvedMatchKey:'other-gtin'}),
    listing('unreviewed','e',100,{approvedMatchStatus:'proposed'}),
    listing('other-cat','f',100,{categoryCode:'fresh_food'})
  ]);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['valid']);
});
test('exact-product badge refuses different pack size even with copied match identity',()=>{
  const out=calc([listing('one-litre','a',12000),
    listing('half-litre','b',100,{quantityBaseUnits:500})]);
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.badges,[]);
});
test('duplicate listings from one merchant cannot inflate merchant count or tie count',()=>{
  const out=calc([
    listing('a-expensive','merchant-a',20000),
    listing('a-cheap','merchant-a',9000),
    listing('b','merchant-b',10000)
  ]);
  assert.equal(out.eligibleListingCount,3);
  assert.equal(out.eligibleMerchantCount,2);
  assert.deepEqual(out.badges[0].publicListingIds,['a-cheap']);
});
test('equal cost produces visible shared winners instead of arbitrary one-winner badge',()=>{
  const out=calc([listing('b','b',1000),listing('a','a',1000)]);
  assert.deepEqual(out.badges[0].publicListingIds,['a','b']);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['a','b']);
});
test('normalized price comparison uses exact fractions not rounded display ties',()=>{
  const g=group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes',
    unitFamily:'count'});
  const out=calc([
    listing('three','a',1,{unitFamily:'count',quantityBaseUnits:3}),
    listing('seven','b',2,{unitFamily:'count',quantityBaseUnits:7})
  ],g);
  assert.deepEqual(out.badges[0].publicListingIds,['seven']);
  assert.equal(out.listings[0].normalizedUnitPriceMinorRounded,'0');
  assert.equal(out.listings[1].normalizedUnitPriceMinorRounded,'0');
});
test('private identities, merchant-provided names, reviews and delivery fees never enter output',()=>{
  const out=calc([
    listing('public-1','merchant-a',1000,{customerEmail:'private@example.com',
      homeAddress:'SECRET',productName:'Name spoof',rating:5,deliveryFeeMinor:900}),
    listing('public-2','merchant-b',900)
  ]);
  const json=JSON.stringify(out);
  assert.doesNotMatch(json,/private@example|SECRET|Name spoof|merchant-a|rating|deliveryFeeMinor/);
  assert.deepEqual(out.badges.map(x=>x.code),['LOWEST_LISTED_PRICE']);
});
test('does not mutate caller data, including frozen arrays and records',()=>{
  const items=Object.freeze([Object.freeze(listing('b','b',10000)),
    Object.freeze(listing('a','a',9900))]);
  const g=Object.freeze(group());
  const first=calc(items,g);
  assert.deepEqual(calc(items,g),first);
  assert.equal(first.listings[0].publicListingId,'a');
});
test('malformed financial numbers, units or ids are excluded without coercion',()=>{
  const out=calc([listing('good','a',10000),
    listing('bad-price','b','1'),
    listing('float','c',1.2),
    listing('negative','d',-1),
    listing('zero-quantity','e',100,{quantityBaseUnits:0}),
    listing('wrong-unit','f',100,{unitFamily:'mass'}),
    listing('bad id!','g',100),
    listing('too-large','h',Number.MAX_SAFE_INTEGER+1)
  ]);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['good']);
});
test('timestamp is canonical, invalid and oversized inputs are bounded',()=>{
  assert.throws(()=>calc([],group(),'2026-10-28'),/canonical UTC/);
  assert.throws(()=>calc([],group(),'2026-02-30T00:00:00.000Z'),/canonical UTC/);
  assert.throws(()=>buildInternalPriceComparison({group:group(),listings:new Array(501).fill(null),asOf:AS_OF}),/at most 500/);
  assert.throws(()=>buildInternalPriceComparison({group:group(),listings:null,asOf:AS_OF}),/array/);
});
test('prototype-name unit family cannot bypass the curated family allowlist',()=>{
  const out=calc([listing('a','a',100),listing('b','b',200)],group({unitFamily:'constructor'}));
  assert.equal(out.status,'unverified_group');
  assert.deepEqual(out.badges,[]);
});
test('one public listing ID mapped to two Merchants invalidates the comparison snapshot',()=>{
  const out=calc([listing('same-id','merchant-a',100),listing('same-id','merchant-b',200)]);
  assert.equal(out.status,'ambiguous_listing_identity');
  assert.equal(out.eligibleMerchantCount,0);
  assert.deepEqual(out.listings,[]);
  assert.deepEqual(out.badges,[]);
});
test('calculator has no provider calls, publication mutations, quality-score or external benchmarks',()=>{
  const out=calc([listing('a','a',100),listing('b','b',200)]);
  assert.equal(Object.hasOwn(out,'externalBenchmark'),false);
  assert.equal(Object.hasOwn(out,'qualityBadge'),false);
  assert.equal(Object.hasOwn(out,'settlement'),false);
  assert.equal(Object.hasOwn(out,'publicationAction'),false);
});

test('duplicate same-seller public listing identity cannot invent a cheap price',()=>{
  const out=calc([listing('same','merchant-a',12000),listing('same','merchant-a',1),
    listing('other','merchant-b',10000)]);
  assert.equal(out.status,'ambiguous_listing_identity');
  assert.deepEqual(out.badges,[]);
  assert.deepEqual(out.listings,[]);
});

test('stale opt-in and revoked opt-out copies of one listing fail closed',()=>{
  const out=calc([
    listing('reused','merchant-a',100,{comparisonListingConsent:true}),
    listing('reused','merchant-a',100,{comparisonListingConsent:false}),
    listing('other','merchant-b',1000)
  ]);
  assert.equal(out.status,'ambiguous_listing_identity');
  assert.equal(out.eligibleMerchantCount,0);
  assert.deepEqual(out.badges,[]);
});

test('duplicate identical server projection is rejected instead of counted twice',()=>{
  const row=listing('duplicated','merchant-a',15000);
  const out=calc([row,{...row},listing('other','merchant-b',16000)]);
  assert.equal(out.status,'ambiguous_listing_identity');
  assert.deepEqual(out.badges,[]);
});

test('rejected group metadata never reflects arbitrary object or internal group ID',()=>{
  const rejected=calc([listing('a','a',100),listing('b','b',200)],
    group({active:false,id:'internal-identifier',matchKind:{private:'DO_NOT_EXPOSE'}}));
  assert.equal(rejected.status,'unverified_group');
  assert.equal(rejected.groupId,null);
  assert.equal(rejected.kind,null);
  assert.doesNotMatch(JSON.stringify(rejected),/DO_NOT_EXPOSE|internal-identifier/);
});


test('even a valid reviewed group never publishes its internal group identifier',()=>{
  const privateId='private-review-group-division-74';
  const curated=group({id:privateId});
  const input=[
    listing('public-a','merchant-a',9900,{comparisonGroupId:privateId}),
    listing('public-b','merchant-b',11000,{comparisonGroupId:privateId})
  ];
  const result=calc(input,curated);
  assert.equal(result.status,'ready');
  assert.equal(result.groupId,null);
  assert.deepEqual(result.badges[0].publicListingIds,['public-a']);
  assert.doesNotMatch(JSON.stringify(result),/private-review-group-division-74/);
});

test('category-only and rejected duplicate projections do not publish valid group IDs',()=>{
  const privateId='private-review-group-division-83';
  const curated=group({id:privateId});
  const input=[
    listing('same','merchant-a',9900,{comparisonGroupId:privateId}),
    listing('same','merchant-b',11000,{comparisonGroupId:privateId})
  ];
  const rejected=calc(input,curated);
  const categoryOnly=calc(input,group({
    id:privateId,matchKind:'SAME_CATEGORY_ONLY',matchEvidenceKind:undefined
  }));
  assert.equal(rejected.status,'ambiguous_listing_identity');
  assert.equal(categoryOnly.status,'category_only');
  for(const result of [rejected,categoryOnly]){
    assert.equal(result.groupId,null);
    assert.doesNotMatch(JSON.stringify(result),/private-review-group-division-83/);
    assert.deepEqual(result.badges,[]);
  }
});

test('rounded-zero positive prices have an exact ratio, distinct from a real free item',()=>{
  const g=group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes',
    unitFamily:'count'});
  const result=calc([
    listing('three','merchant-a',1,{unitFamily:'count',quantityBaseUnits:3}),
    listing('seven','merchant-b',2,{unitFamily:'count',quantityBaseUnits:7})
  ],g);
  assert.deepEqual(result.badges[0].publicListingIds,['seven']);
  assert.deepEqual(result.listings.map(x=>x.normalizedUnitPriceMinorRounded),['0','0']);
  assert.deepEqual(result.listings.map(x=>[
    x.normalizedUnitPriceMinorNumerator,x.normalizedUnitPriceMinorDenominator
  ]),[['2','7'],['1','3']]);
  assert.deepEqual(result.listings.map(x=>x.normalizedUnitPriceBelowOneCent),[true,true]);
  const free=calc([
    listing('zero','merchant-a',0,{unitFamily:'count',quantityBaseUnits:5}),
    listing('nonzero','merchant-b',1,{unitFamily:'count',quantityBaseUnits:3})
  ],g);
  assert.equal(free.listings[0].normalizedUnitPriceMinorNumerator,'0');
  assert.equal(free.listings[0].normalizedUnitPriceBelowOneCent,false);
  assert.equal(free.listings[1].normalizedUnitPriceMinorRounded,'0');
  assert.equal(free.listings[1].normalizedUnitPriceBelowOneCent,true);
});

test('exact ratio correctly scales cents per kg without rounding away price differences',()=>{
  const g=group({matchKind:'COMPARABLE_PRODUCT',matchEvidenceKind:'structured_attributes',
    unitFamily:'mass',categoryCode:'fresh_food'});
  const output=calc([
    listing('three-kg','merchant-a',1,{unitFamily:'mass',quantityBaseUnits:3000,categoryCode:'fresh_food'}),
    listing('seven-kg','merchant-b',2,{unitFamily:'mass',quantityBaseUnits:7000,categoryCode:'fresh_food'})
  ],g);
  assert.equal(output.unitPricePer,'kg');
  assert.equal(output.listings[0].publicListingId,'seven-kg');
  assert.equal(output.listings[0].normalizedUnitPriceMinorNumerator,'2000');
  assert.equal(output.listings[0].normalizedUnitPriceMinorDenominator,'7000');
  assert.equal(output.listings[0].normalizedUnitPriceBelowOneCent,true);
  assert.deepEqual(output.badges[0].publicListingIds,['seven-kg']);
});

test('review authority must be explicit own fields, never inherited from a group prototype',()=>{
  for(const field of ['id','categoryCode','matchKey','matchKind','version','active','reviewed',
    'unitFamily','matchEvidenceKind','exactQuantityBaseUnits']){
    const curated=group();
    const trustedValue=curated[field];
    delete curated[field];
    Object.setPrototypeOf(curated,{[field]:trustedValue});
    const out=calc([listing('a','a',1),listing('b','b',2)],curated);
    assert.equal(out.status,'unverified_group',field);
    assert.deepEqual(out.badges,[],field);
  }
});

test('inherited publication and match proofs cannot authorize a public price badge',()=>{
  const required=['publicListingId','merchantBusinessId','published','available','currency',
    'priceMinor','quantityBaseUnits','unitFamily','categoryCode','comparisonGroupId',
    'approvedMatchKey','approvedMatchVersion','approvedMatchStatus'];
  for(const field of required){
    const forged=listing('forged','a',1);
    const inheritedValue=forged[field];
    delete forged[field];
    Object.setPrototypeOf(forged,{[field]:inheritedValue});
    const out=calc([forged,listing('legitimate','b',100)]);
    assert.equal(out.eligibleMerchantCount,1,field);
    assert.deepEqual(out.badges,[],field);
    assert.deepEqual(out.listings.map(x=>x.publicListingId),['legitimate'],field);
  }
});

test('prototype-inherited consent cannot turn an unconsented listing ON',()=>{
  const fromStore=listing('inherited-store','a',1);
  delete fromStore.comparisonStoreConsent;
  Object.setPrototypeOf(fromStore,{comparisonStoreConsent:true});
  const fromListing=listing('inherited-listing','c',1,{
    comparisonStoreConsent:false,comparisonListingConsent:true
  });
  delete fromListing.comparisonListingConsent;
  Object.setPrototypeOf(fromListing,{comparisonListingConsent:true});
  const out=calc([fromStore,fromListing,listing('legitimate','b',100)]);
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['legitimate']);
  assert.deepEqual(out.badges,[]);
});

test('explicit own listing opt-in still overrides an absent storefront default',()=>{
  const optedIn=listing('opted-in','a',1,{comparisonListingConsent:true});
  delete optedIn.comparisonStoreConsent;
  const out=calc([optedIn,listing('other','b',2)]);
  assert.equal(out.eligibleMerchantCount,2);
  assert.deepEqual(out.badges[0].publicListingIds,['opted-in']);
});

test('accessor-backed prices cannot change after validation and manufacture a negative lowest badge',()=>{
  const changing=listing('changing','seller-a',10);
  let reads=0;
  Object.defineProperty(changing,'priceMinor',{enumerable:true,get(){
    reads++;
    return reads===1?10:-10000;
  }});
  const out=calc([changing,listing('ordinary','seller-b',20)]);
  assert.equal(reads,0);
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['ordinary']);
  assert.deepEqual(out.badges,[]);
});

test('accessor-backed listing/store consent is rejected without evaluating getters',()=>{
  const listingConsent=listing('listing-accessor','seller-a',1);
  const storeConsent=listing('store-accessor','seller-c',1);
  let listingReads=0;
  let storeReads=0;
  Object.defineProperty(listingConsent,'comparisonListingConsent',{enumerable:true,get(){
    listingReads++;
    return true;
  }});
  delete storeConsent.comparisonListingConsent;
  Object.defineProperty(storeConsent,'comparisonStoreConsent',{enumerable:true,get(){
    storeReads++;
    return true;
  }});
  const out=calc([listingConsent,storeConsent,listing('ordinary','seller-b',20)]);
  assert.equal(listingReads,0);
  assert.equal(storeReads,0);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['ordinary']);
  assert.deepEqual(out.badges,[]);
});

test('accessor-backed group review and evidence are never invoked',()=>{
  for(const field of ['reviewed','matchEvidenceKind','exactQuantityBaseUnits','matchKind']){
    const curated=group();
    let reads=0;
    Object.defineProperty(curated,field,{enumerable:true,get(){reads++;return group()[field];}});
    const out=calc([listing('a','a',1),listing('b','b',2)],curated);
    assert.equal(reads,0,field);
    assert.equal(out.status,'unverified_group',field);
    assert.equal(out.kind,null,field);
    assert.deepEqual(out.badges,[],field);
  }
});

test('accessor-backed public identity is excluded before duplicate checking without invoking getter',()=>{
  const row=listing('flapping','seller-a',1);
  let reads=0;
  Object.defineProperty(row,'publicListingId',{enumerable:true,get(){reads++;return 'ordinary';}});
  const out=calc([row,listing('ordinary','seller-b',20)]);
  assert.equal(reads,0);
  assert.equal(out.status,'ready');
  assert.equal(out.eligibleMerchantCount,1);
  assert.deepEqual(out.listings.map(x=>x.publicListingId),['ordinary']);
  assert.deepEqual(out.badges,[]);
});

test('Proxy cannot change an approved listing price between validation and ranking',()=>{
  const source=listing('proxy-price','seller-a',20);
  let priceReads=0;
  const deceptive=new Proxy(source,{get(target,field,receiver){
    if(field==='priceMinor'){priceReads++;return priceReads===1?20:-10000}
    return Reflect.get(target,field,receiver);
  }});
  const out=calc([deceptive,listing('ordinary','seller-b',10)]);
  assert.equal(priceReads,0,'snapshot must never invoke an untrusted get trap');
  assert.deepEqual(out.badges[0].publicListingIds,['ordinary']);
  assert.equal(out.listings.find(x=>x.publicListingId==='proxy-price').priceMinor,20);
  assert.ok(out.listings.every(x=>x.priceMinor>=0));
});

test('Proxy cannot forge a reviewed group when its own data says unreviewed',()=>{
  const unreviewed=group({reviewed:false});
  let reviewReads=0;
  const deceptive=new Proxy(unreviewed,{get(target,field,receiver){
    if(field==='reviewed'){reviewReads++;return true}
    return Reflect.get(target,field,receiver);
  }});
  const rejected=calc([listing('a','seller-a',100),listing('b','seller-b',200)],deceptive);
  assert.equal(reviewReads,0);
  assert.equal(rejected.status,'unverified_group');
  assert.deepEqual(rejected.badges,[]);
});

test('duplicate listing identity remains rejected even if an optional consent field is accessor-backed',()=>{
  const invalid=listing('same-id','seller-a',100);
  let consentReads=0;
  Object.defineProperty(invalid,'comparisonListingConsent',{enumerable:true,get(){
    consentReads++;return false;
  }});
  const out=calc([listing('same-id','seller-b',1),invalid]);
  assert.equal(consentReads,0);
  assert.equal(out.status,'ambiguous_listing_identity');
  assert.deepEqual(out.badges,[]);
});
