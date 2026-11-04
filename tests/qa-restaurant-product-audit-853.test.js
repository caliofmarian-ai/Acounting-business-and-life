import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRestaurantBacoorProductSnapshots as audit} from '../qa/restaurant-bacoor-product-audit-853.js';

// Only test snapshots: this suite never connects to an actual QA or Production DB.
const plan={mode:'DRY_RUN_ONLY',executable:false,sourceOnly:true,
  fixtureKey:'qa-ph-restaurant-bacoor',manifestSha256:'a'.repeat(64),
  target:{businessId:null,accountId:null},
  recipeProducts:Array.from({length:10},(_,i)=>({bodyTemplate:{
    name:'Dish '+i,category:'Food',product_kind:'prepared_recipe',selling_price:150+i,active:false}})),
  privateCatalog:Array.from({length:10},(_,i)=>({bodyTemplate:{
    name:'Dish '+i,description:'Description '+i,category:'Food',product_kind:'prepared_food',
    selling_price:150+i,unit_code:'portion',quantity_per_unit:1,published:false,
    price_comparison_override:false}}))};
const sample=()=>({targetBusinessId:11,
  recipeProducts:plan.recipeProducts.map((x,i)=>({id:100+i,business_id:11,...x.bodyTemplate})),
  catalogProducts:plan.privateCatalog.map((x,i)=>({id:200+i,business_id:11,...x.bodyTemplate,
    active:true,inventory_id:null,stock_tracked:false,stock_quantity:null}))});
const copy=()=>structuredClone(sample());
const reject=(mutate,pattern=/QA product audit refused/)=>{
  const data=copy();mutate(data);
  assert.throws(()=>audit(plan,data),pattern);
};

test('empty or exact 10+10 snapshots are read-only diagnostics, never permission to seed',()=>{
  assert.deepEqual(audit(plan,{targetBusinessId:11,recipeProducts:[],catalogProducts:[]}),{
    status:'EMPTY_UNAPPROVED',executable:false,recipeProducts:0,catalogProducts:0,
    gate:'NO WRITES: separately verify isolated QA authority and lock both stores'});
  const result=audit(plan,copy());
  assert.equal(result.status,'EXACT_PRIVATE_PRODUCT_SNAPSHOTS_ONLY');
  assert.equal(result.executable,false);
  assert.deepEqual([result.recipeProducts,result.catalogProducts],[10,10]);
  assert.doesNotMatch(JSON.stringify(result),/"id"|"business_id"|"bodyTemplate"/);
});

test('rejects missing/partial/extra rows, missing business origin and wrong plan',()=>{
  reject(x=>x.catalogProducts=[]);
  reject(x=>x.recipeProducts.pop());
  reject(x=>x.catalogProducts.push(structuredClone(x.catalogProducts[0])));
  reject(x=>delete x.targetBusinessId);
  reject(x=>x.recipeProducts=null);
  assert.throws(()=>audit({...plan,executable:true},copy()),/non-executable V1 plan/);
  assert.throws(()=>audit({...plan,target:{businessId:11,accountId:null}},copy()),/non-executable V1 plan/);
});

test('rejects cross-tenant records, duplicate IDs/names and unknown products in each distinct store',()=>{
  reject(x=>x.recipeProducts[0].business_id=12);
  reject(x=>x.catalogProducts[0].business_id=12);
  reject(x=>x.recipeProducts[1].id=x.recipeProducts[0].id);
  reject(x=>x.catalogProducts[1].id=x.catalogProducts[0].id);
  reject(x=>x.recipeProducts[1].name=x.recipeProducts[0].name);
  reject(x=>x.catalogProducts[1].name=x.catalogProducts[0].name.toUpperCase());
  reject(x=>x.recipeProducts[0].name='Other restaurant');
  reject(x=>x.catalogProducts[0].name='Other restaurant');
});

test('rejects altered price, category, type, product visibility and catalog stock/provenance',()=>{
  reject(x=>x.recipeProducts[0].selling_price='149.99');
  reject(x=>x.catalogProducts[0].selling_price='149.99');
  reject(x=>x.recipeProducts[0].active=true);
  reject(x=>x.catalogProducts[0].published=true);
  reject(x=>x.catalogProducts[0].active=false);
  reject(x=>x.catalogProducts[0].price_comparison_override=true);
  reject(x=>x.catalogProducts[0].inventory_id=99);
  reject(x=>x.catalogProducts[0].stock_tracked=true);
  reject(x=>x.catalogProducts[0].stock_quantity=4);
  reject(x=>x.catalogProducts[0].unit_code='kg');
  reject(x=>x.catalogProducts[0].quantity_per_unit=2);
  reject(x=>x.catalogProducts[0].description='Updated');
  reject(x=>x.recipeProducts[0].product_kind='fresh_direct');
  reject(x=>x.catalogProducts[0].category='Other');
  reject(x=>x.recipeProducts[0].selling_price='NaN');
});

test('accepts PostgreSQL decimal/string bigint representations but not malformed IDs',()=>{
  const data=copy();
  data.targetBusinessId='11';
  data.recipeProducts[0].business_id='11';
  data.catalogProducts[0].business_id='11';
  data.recipeProducts[0].selling_price='150.00';
  data.catalogProducts[0].selling_price='150.00';
  data.catalogProducts[0].quantity_per_unit='1.000000';
  assert.equal(audit(plan,data).executable,false);
  reject(x=>x.catalogProducts[0].id='0002');
  reject(x=>x.catalogProducts[0].selling_price='1e2');
});
