import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildRestaurantBacoorDryRunPlan} from '../qa/restaurant-bacoor-dry-run-853.js';

const fixture=JSON.parse(readFileSync(new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(fixture);
test('dry-run plan contains 37 scoped ingredient and 10+10 private product and recipe mappings without an executable ID',()=>{
  const plan=buildRestaurantBacoorDryRunPlan(copy());
  assert.equal(plan.mode,'DRY_RUN_ONLY');
  assert.match(plan.manifestSha256,/^[a-f0-9]{64}$/);
  assert.equal(plan.manifestSha256,createHash('sha256').update(JSON.stringify(fixture)).digest('hex'));
  const modified=copy();modified.inventory[0].name='Chicken meat (new unapproved baseline)';
  assert.notEqual(buildRestaurantBacoorDryRunPlan(modified).manifestSha256,plan.manifestSha256);
  assert.equal(plan.executable,false);
  assert.equal(plan.target.businessId,null);
  assert.equal(plan.target.accountId,null);
  assert.equal(plan.inventory.length,37);
  assert.equal(plan.recipeProducts.length,10);
  assert.equal(plan.privateCatalog.length,10);
  assert.equal(plan.recipeBatches.length,10);
  assert.equal(new Set([...plan.inventory,...plan.recipeProducts,...plan.privateCatalog,...plan.recipeBatches]
    .map(item=>item.logicalKey)).size,67);
  assert.ok(plan.inventory.every(row=>row.bodyTemplate.inventory_type==='ingredient'));
  assert.ok(plan.recipeProducts.every(row=>row.bodyTemplate.active===false&&
    row.bodyTemplate.product_kind==='prepared_recipe'));
  assert.ok(plan.privateCatalog.every(row=>row.bodyTemplate.published===false&&
    row.bodyTemplate.price_comparison_override===false&&row.bodyTemplate.business_id===null&&
    row.bodyTemplate.product_kind==='prepared_food'));
  assert.ok(plan.recipeBatches.every(row=>row.recipeProductId===null&&
    row.bodyTemplate.components.every(c=>c.inventory_id===null&&c.inventoryLogicalKey)));
  assert.match(plan.idempotency,/NEVER_RESET_EXISTING_STOCK/);
  assert.deepEqual(buildRestaurantBacoorDryRunPlan(copy()),plan,'deterministic plan');
});

test('current scoped HTTP route contracts are acknowledged, but templates are never requests',()=>{
  const plan=buildRestaurantBacoorDryRunPlan(copy());
  const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
  const marketplace=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
  assert.match(accounting,/app\.post\('\/api\/inventory'/);
  assert.match(accounting,/ON CONFLICT\(business_id,item\) DO UPDATE SET/);
  assert.match(accounting,/app\.post\('\/api\/products'/);
  assert.match(accounting,/app\.put\('\/api\/products\/:id\/recipe-batch'/);
  assert.match(marketplace,/app\.post\('\/api\/merchant\/storefront\/products'/);
  assert.deepEqual(Object.values(plan.routeContracts).map(x=>x.source).sort(),
    ['server-business-accounting.js','server-business-accounting.js',
      'server-business-accounting.js','server-marketplace.js'].sort());
  const text=JSON.stringify(plan);
  assert.doesNotMatch(text,/https:\/\/|paymongo|customer_email|customer_phone|secret_key/i);
  assert.ok(plan.prerequisites.some(line=>/UPSERT/.test(line)));
  assert.ok(plan.prerequisites.some(line=>/distinct application stores/.test(line)));
});

test('fails closed if storefront/region/locale or company-test restrictions are weakened',()=>{
  const bad=[
    x=>x.business.testOnly=false,
    x=>x.business.locale='ro-RO',
    x=>x.business.cityPsgcCode='UNKNOWN',
    x=>x.business.storefront.publicationStatus='published',
    x=>x.business.storefront.cashEnabled=true,
    x=>x.business.storefront.onlineEnabled=true,
    x=>x.business.storefront.deliveryEnabled=true,
    x=>x.business.storefront.priceComparisonEnabled=true,
    x=>x.costing.basis='quoted live supplier costs'
  ];
  for(const mutate of bad){
    const x=copy();mutate(x);
    assert.throws(()=>buildRestaurantBacoorDryRunPlan(x),/dry-run refused/);
  }
});

test('fails closed on duplicate ingredient/dish keys, unknown components or stock resets disguised as fixture updates',()=>{
  const bad=[
    x=>x.inventory[1].code=x.inventory[0].code,
    x=>x.inventory[1].name=x.inventory[0].name,
    x=>x.recipes[1].code=x.recipes[0].code,
    x=>x.recipes[1].name=x.recipes[0].name,
    x=>x.recipes[0].ingredients[0].ingredientCode='not-in-inventory',
    x=>x.recipes[0].ingredients[0].quantity=Infinity,
    x=>x.recipes[0].ingredients[0].unit='kg',
    x=>x.inventory[0].onHandBase=1,
    x=>x.inventory[0].unitCostPHP=NaN,
    x=>x.recipes[0].sellingPricePHP=-1
  ];
  for(const mutate of bad){
    const x=copy();mutate(x);
    assert.throws(()=>buildRestaurantBacoorDryRunPlan(x),/dry-run refused/);
  }
});

test('read-only plan rejects synthetic cost, ingredient price or selling-price drift',()=>{
  const mutations=[
    x=>{x.inventory[0].unitCostPHP+=0.01;},
    x=>{x.recipes[0].ingredients[0].quantity+=1;},
    x=>{x.recipes[0].simulatedCost.batchPHP+=0.01;},
    x=>{x.recipes[0].simulatedCost.perPortionPHP+=0.01;},
    x=>{x.recipes[0].simulatedCost.grossContributionPerPortionPHP+=0.01;},
    x=>{x.recipes[0].sellingPricePHP+=1;},
    x=>{x.recipes[0].simulatedCost=null;}
  ];
  for(const mutate of mutations){
    const x=copy();mutate(x);
    assert.throws(()=>buildRestaurantBacoorDryRunPlan(x),/dry-run refused/);
  }
});

test('count-unit ingredients must be positive whole pieces, never fractional',()=>{
  const x=copy();
  const countPart=x.recipes[0].ingredients.find(p=>p.unit==='unit');
  assert.ok(countPart,'fixture must include a count-unit ingredient');
  countPart.quantity=0.5;
  assert.throws(()=>buildRestaurantBacoorDryRunPlan(x),/dry-run refused: invalid recipe quantity\/unit/);
});
