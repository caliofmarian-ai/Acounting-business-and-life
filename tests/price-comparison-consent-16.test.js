import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeStoreComparisonConsent as store,normalizeListingComparisonConsent as listing} from '../price-comparison-consent-core.js';
import {buildInternalPriceComparison} from '../price-comparison-core.js';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('store comparison is OFF by default and an unrelated edit preserves prior opt-in',()=>{
  assert.deepEqual(store({}),{provided:false,value:false});
  assert.deepEqual(store({store_name:'Updated'},true),{provided:false,value:true});
  assert.deepEqual(store({store_name:'Updated'},false),{provided:false,value:false});
});
test('explicit storefront OFF is never coerced to ON by a truthy string',()=>{
  for(const input of [false,'false']){
    assert.deepEqual(store({price_comparison_enabled:input},true),{provided:true,value:false});
  }
  for(const input of [true,'true']){
    assert.deepEqual(store({price_comparison_enabled:input},false),{provided:true,value:true});
  }
});
test('ambiguous storefront consent input is rejected rather than activated',()=>{
  for(const input of [null,undefined,0,1,'0','1','False','off','yes','',[],{},['false']]){
    assert.throws(()=>store({price_comparison_enabled:input}),{status:400},String(input));
  }
});
test('listing choice distinguishes inherited, opt-IN and opt-OUT and persists prior choice',()=>{
  assert.deepEqual(listing({}),{provided:false,value:null});
  assert.deepEqual(listing({},true),{provided:false,value:true});
  assert.deepEqual(listing({},false),{provided:false,value:false});
  assert.deepEqual(listing({price_comparison_override:null},true),{provided:true,value:null});
  for(const [input,expected] of [[true,true],['true',true],[false,false],['false',false]]){
    assert.deepEqual(listing({price_comparison_override:input}),{provided:true,value:expected});
  }
});
test('ambiguous listing value and accessor-backed choices cannot authorize comparison',()=>{
  for(const input of [0,1,'yes','off','False',[],{},['false']]){
    assert.throws(()=>listing({price_comparison_override:input}),{status:400},String(input));
  }
  const accessor={};let reads=0;
  Object.defineProperty(accessor,'price_comparison_override',{get(){reads++;return true}});
  assert.throws(()=>listing(accessor),{status:400});
  assert.equal(reads,0);
});
test('prototype-inherited opt-ins never become explicit Merchant consent',()=>{
  const inheritedStore=Object.create({price_comparison_enabled:true});
  const inheritedListing=Object.create({price_comparison_override:true});
  assert.deepEqual(store(inheritedStore),{provided:false,value:false});
  assert.deepEqual(listing(inheritedListing),{provided:false,value:null});
});
test('strict choices feed existing comparison gate: revocation removes badge without hiding products',()=>{
  const group={id:'g',categoryCode:'packaged_food_drink',matchKey:'gtin',matchKind:'EXACT_PRODUCT',
    matchEvidenceKind:'gtin',version:1,active:true,reviewed:true,unitFamily:'count',exactQuantityBaseUnits:1};
  const make=(id,shop,price,storeFlag,override)=>({
    publicListingId:id,merchantBusinessId:shop,published:true,available:true,
    currency:'PHP',priceMinor:price,quantityBaseUnits:1,unitFamily:'count',
    categoryCode:'packaged_food_drink',comparisonGroupId:'g',approvedMatchKey:'gtin',
    approvedMatchVersion:1,approvedMatchStatus:'verified',
    comparisonStoreConsent:storeFlag,comparisonListingConsent:override
  });
  const first=make('a','shop-a',100,true,null);
  const second=make('b','shop-b',110,true,null);
  const compare=()=>buildInternalPriceComparison({group,listings:[first,second],asOf:'2026-10-29T00:00:00.000Z'});
  assert.equal(compare().badges.length,1);
  first.comparisonListingConsent=listing({price_comparison_override:'false'},null).value;
  assert.equal(first.published,true);
  assert.equal(compare().badges.length,0);
  assert.deepEqual(compare().listings.map(row=>row.publicListingId),['b']);
  first.comparisonStoreConsent=store({price_comparison_enabled:'false'},true).value;
  first.comparisonListingConsent=listing({price_comparison_override:true},false).value;
  assert.equal(compare().badges.length,1,'an explicit listing opt-in may override storefront OFF');
});
test('Merchant server routes use strict parsing; omitted storefront consent is preserved atomically',()=>{
  const server=source('server-marketplace.js');
  assert.match(server,/normalizeStoreComparisonConsent\(req\.body\|\|\{\},current\?\.price_comparison_enabled\)/);
  assert.match(server,/price_comparison_enabled=CASE WHEN \$23::boolean THEN EXCLUDED\.price_comparison_enabled ELSE merchant_storefronts\.price_comparison_enabled END/);
  assert.match(server,/normalizeListingComparisonConsent\(req\.body\|\|\{\}\)/);
  assert.match(server,/normalizeListingComparisonConsent\(req\.body\|\|\{\},old\.price_comparison_override\)/);
  assert.match(server,/merchant_storefronts\.xmin::text=\$24::text/);
  assert.match(server,/req\.body\.price_comparison_expected_version!==old\.comparison_version/);
  assert.match(server,/SELECT \*,xmin::text AS comparison_version FROM marketplace_products/);
  assert.doesNotMatch(server,/Boolean\(req\.body\?\.price_comparison_enabled\)/);
  assert.doesNotMatch(server,/Boolean\(req\.body\.price_comparison_override\)/);
});
test('private Merchant catalog create and edit expose explicit three-way choices',()=>{
  const ui=source('public/marketplace-ui.js');
  assert.match(ui,/id="merchantCatalogCreateCompare"/);
  assert.match(ui,/id="catalogEditCompare"/);
  assert.match(ui,/option value="inherit"/);
  assert.match(ui,/option value="on"/);
  assert.match(ui,/option value="off"/);
  assert.match(ui,/price_comparison_override:comparisonChoiceFromSelect\('merchantCatalogCreateCompare'\)/);
  assert.match(ui,/price_comparison_override:comparisonConsentChanged\(p\.price_comparison_override\?\?null,comparisonChoiceFromSelect\('catalogEditCompare'\)\)/);
  assert.match(ui,/id="storeCompare"/);
  assert.match(ui,/data-initial-version=/);
  assert.match(ui,/price_comparison_expected_version:p\.comparison_version/);
});

test('stale private form saves omit unchanged consent and cannot reverse a remote withdrawal',()=>{
  const ui=source('public/marketplace-ui.js');
  // Execute the real browser helper in an isolated Node scope, not a replica.
  const declaration=ui.match(/function comparisonConsentChanged\([^)]*\)\{[^}]*\}/)?.[0];
  assert.ok(declaration,'Merchant UI must declare change-only consent serialization');
  const changed=Function('"use strict";'+declaration+';return comparisonConsentChanged;')();
  assert.match(ui,/id="storeCompare" type="checkbox" data-initial-consent=/);
  assert.ok(ui.includes("const initial=compare?.dataset?.initialConsent"));
  assert.ok(ui.includes('price_comparison_enabled:comparisonUpdate?Boolean(compare.checked):undefined'));
  assert.match(ui,/price_comparison_override:comparisonConsentChanged\(p\.price_comparison_override\?\?null,/);

  // An older tab saw true; another tab has since revoked consent in PostgreSQL.
  // Saving unrelated fields must not send the obsolete true as a new opt-in.
  const staleStoreJson=JSON.stringify({store_name:'Unrelated edit',
    price_comparison_enabled:changed(true,true)});
  const staleStorePayload=JSON.parse(staleStoreJson);
  assert.equal(Object.hasOwn(staleStorePayload,'price_comparison_enabled'),false);
  assert.deepEqual(store(staleStorePayload,false),{provided:false,value:false});

  const staleListingJson=JSON.stringify({name:'Unrelated product edit',
    price_comparison_override:changed(true,true)});
  const staleListingPayload=JSON.parse(staleListingJson);
  assert.equal(Object.hasOwn(staleListingPayload,'price_comparison_override'),false);
  assert.deepEqual(listing(staleListingPayload,false),{provided:false,value:false});

  // Real user changes are still explicit; inherit remains a deliberate null.
  assert.deepEqual(store(JSON.parse(JSON.stringify({price_comparison_enabled:changed(false,true)})),false),
    {provided:true,value:true});
  assert.deepEqual(store(JSON.parse(JSON.stringify({price_comparison_enabled:changed(true,false)})),true),
    {provided:true,value:false});
  assert.deepEqual(listing(JSON.parse(JSON.stringify({price_comparison_override:changed(true,null)})),true),
    {provided:true,value:null});
  assert.deepEqual(listing(JSON.parse(JSON.stringify({price_comparison_override:changed(null,false)})),null),
    {provided:true,value:false});
});

test('Catalog comparison choice requires an explicit recognized selector value',()=>{
  const ui=source('public/marketplace-ui.js');
  // Execute the browser helper from source; do not duplicate the parser.
  const start=ui.indexOf('function comparisonChoiceFromSelect(id){');
  const end=ui.indexOf('}',start);
  assert.ok(start>=0&&end>start,'Merchant UI must declare its comparison choice parser');
  const declaration=ui.slice(start,end+1);
  const choose=value=>Function('document','"use strict";'+declaration+';return comparisonChoiceFromSelect;')({
    getElementById:()=>value===undefined?null:{value}
  })('catalogEditCompare');
  for(const [value,expected] of [['inherit',null],['on',true],['off',false]]){
    assert.equal(choose(value),expected);
  }
  // Old helper silently mapped every unknown value to null/inherit; if a
  // listing was explicitly OFF while storefront was ON, this re-included it.
  for(const invalid of [undefined,'','unknown','true','false','INHERIT']){
    assert.throws(()=>choose(invalid),{name:'TypeError',message:/valid price comparison participation/});
  }
  assert.deepEqual(listing({price_comparison_override:choose('off')},true),
    {provided:true,value:false});
  assert.deepEqual(listing({price_comparison_override:choose('inherit')},false),
    {provided:true,value:null});
});

test('existing Merchant tables gain idempotent opt-in columns before any consent request',()=>{
  const server=source('server-marketplace.js');
  const upgrades=[
    ['merchant_storefronts','ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS price_comparison_enabled BOOLEAN NOT NULL DEFAULT FALSE;'],
    ['marketplace_products','ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_comparison_override BOOLEAN;']
  ];
  const route=server.indexOf("app.put('/api/merchant/storefront'");
  for(const [table,upgrade] of upgrades){
    const create=server.indexOf('CREATE TABLE IF NOT EXISTS '+table+' (');
    const migration=server.indexOf(upgrade);
    assert.ok(create>=0&&migration>create&&migration<route,table+' must upgrade older database tables before use');
    assert.equal(server.indexOf(upgrade,migration+upgrade.length),-1,table+' upgrade must occur once');
  }
});
