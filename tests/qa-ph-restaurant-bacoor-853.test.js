import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {computeRecipeBatch,measurementUnit} from '../merchant-catalog-core.js';

const fixtureBytes=readFileSync(new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url));
const fixture=JSON.parse(fixtureBytes.toString('utf8'));

test('the V1 company-test restaurant fixture has the reviewed, pinned Git blob identity',()=>{
  // Git blob SHA-1 is a repository content identifier, not a legal/security
  // approval. Any baseline change requires deliberate review and a new pin.
  const gitBlob=createHash('sha1').update(`blob ${fixtureBytes.length}\0`).update(fixtureBytes).digest('hex');
  assert.equal(gitBlob,'e9d508f9500ab79eb181288b87067e89f82b2acb');
});
const stockByCode=new Map(fixture.inventory.map((entry,index)=>[
  entry.code,{...entry,id:index+1,item:entry.name,unit:entry.baseUnit,base_unit:entry.baseUnit,
    measurement_family:entry.measurementFamily,unit_cost:entry.unitCostPHP}
]));
const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const compile=recipe=>computeRecipeBatch({
  yield_quantity:recipe.yieldServings,yield_unit:'unit',
  selling_quantity:1,selling_unit:'unit',
  inventory:[...stockByCode.values()],
  components:recipe.ingredients.map(({ingredientCode,quantity,unit})=>({
    inventory_id:stockByCode.get(ingredientCode)?.id,quantity,unit
  }))
});

test('restaurant stays English PH and non-commercial, private and draft',()=>{
  assert.equal(fixture.schemaVersion,'ph-restaurant-qa-v1');
  assert.equal(fixture.fixtureKey,'qa-ph-restaurant-bacoor');
  assert.equal(fixture.business.name,'QA PH Restaurant — Bacoor');
  assert.equal(fixture.business.locale,'en-PH');
  assert.equal(fixture.business.countryCode,'PH');
  assert.equal(fixture.business.currency,'PHP');
  assert.equal(fixture.business.cityPsgcCode,'0402103000');
  assert.equal(fixture.business.barangayPsgcCode,'0402103028');
  assert.equal(fixture.business.merchantDomain,'food');
  assert.equal(fixture.business.testOnly,true);
  assert.equal(fixture.business.storefront.publicationStatus,'draft');
  for(const value of Object.values(fixture.business.storefront))
    if(typeof value==='boolean')assert.equal(value,false);
  assert.match(fixture.costing.basis,/synthetic/i);
});

test('inventory keys are unique, quantities bounded and PHP base units supported',()=>{
  assert.equal(fixture.inventory.length,37);
  assert.equal(stockByCode.size,fixture.inventory.length);
  for(const item of fixture.inventory){
    assert.match(item.code,/^[a-z][a-z0-9-]*$/);
    assert.ok(item.name&&item.unitCostPHP>=0);
    assert.ok(item.onHandBase>0&&item.reorderAtBase>=0&&item.reorderAtBase<item.onHandBase);
    assert.equal(measurementUnit(item.baseUnit)?.family,item.measurementFamily);
  }
});

test('10 Filipino prepared recipes have complete English descriptions and no duplicates',()=>{
  assert.equal(fixture.recipes.length,10);
  assert.equal(new Set(fixture.recipes.map(r=>r.code)).size,10);
  for(const recipe of fixture.recipes){
    assert.ok(recipe.name.length>4&&recipe.description.length>25);
    assert.ok(recipe.preparationSteps.length>=3);
    assert.equal(recipe.yieldServings,4);
    assert.equal(recipe.allergenReviewRequired,true);
    assert.ok(recipe.sellingPricePHP>0);
    assert.equal(new Set(recipe.ingredients.map(i=>i.ingredientCode)).size,recipe.ingredients.length);
    assert.ok(recipe.ingredients.length>=7);
    for(const ingredient of recipe.ingredients){
      const item=stockByCode.get(ingredient.ingredientCode);
      assert.ok(item,'unknown ingredient '+ingredient.ingredientCode);
      assert.equal(ingredient.unit,item.baseUnit);
      assert.ok(ingredient.quantity>0);
    }
  }
});

test('canonical batch engine reproduces all published hypothetical ingredient costs',()=>{
  for(const recipe of fixture.recipes){
    const result=compile(recipe);
    assert.equal(result.sale_units_per_batch,4);
    assert.equal(money(result.batch_cost),recipe.simulatedCost.batchPHP,recipe.code);
    assert.equal(money(result.cost_per_sale_unit),recipe.simulatedCost.perPortionPHP,recipe.code);
    assert.equal(money(recipe.sellingPricePHP-recipe.simulatedCost.perPortionPHP),
      recipe.simulatedCost.grossContributionPerPortionPHP,recipe.code);
    assert.ok(result.components.every(c=>c.batch_cost>=0&&c.per_sale_quantity>0));
    assert.ok(recipe.simulatedCost.perPortionPHP<recipe.sellingPricePHP);
  }
});

test('one batch of every recipe fits the independent synthetic inventory snapshot',()=>{
  const usage=new Map();
  for(const recipe of fixture.recipes)
    for(const ingredient of recipe.ingredients)
      usage.set(ingredient.ingredientCode,(usage.get(ingredient.ingredientCode)||0)+ingredient.quantity);
  for(const item of fixture.inventory)
    assert.ok((usage.get(item.code)||0)<=item.onHandBase,'insufficient '+item.code);
});

test('manifest is inert: no session, orders, credentials, public listing or payment actions',()=>{
  const raw=JSON.stringify(fixture);
  for(const prohibited of ['AUTH_TOKEN','TOKEN_SECRET','api_key','https://','published:true',
    'payment_reference','customer_email','customer_phone'])
    assert.ok(!raw.includes(prohibited),prohibited);
  assert.equal(fixture.costing.batchServings,4);
  assert.deepEqual(compile(fixture.recipes[0]),compile(fixture.recipes[0]));
});
