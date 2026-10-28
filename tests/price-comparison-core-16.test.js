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
