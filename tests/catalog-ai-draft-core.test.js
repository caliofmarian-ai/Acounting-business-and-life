import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_CATALOG_MODES,normalizeAiCatalogDraft as norm} from '../catalog-ai-draft-core.js';
const draft=(mode='merchant_non_food',modelOutput={name:'Lamp',catalog_category_code:'furniture_home'})=>norm({mode,modelOutput});
test('all five modes are inert and unpublishable',()=>{
  assert.equal(AI_CATALOG_MODES.length,5);
  for(const mode of AI_CATALOG_MODES){const d=draft(mode,{name:'Review item'});assert.equal(d.draft_only,true);
    assert.equal(d.publishable,false);assert.equal(d.canonical_write_payload,false);assert.equal(d.model_authority,'UNVERIFIED');}
});
test('unknown modes, types, cycles and giant JSON fail closed',()=>{
  assert.throws(()=>draft('fictional',{}),/mode/);
  for(const x of [null,[],42,'text'])assert.throws(()=>draft('merchant_non_food',x),/JSON object/);
  assert.throws(()=>draft('merchant_non_food',{name:'X'.repeat(40000)}),/32 KiB/);
  const x={};x.self=x;assert.throws(()=>draft('merchant_non_food',x),/JSON/);
});
test('model price, stock, account, expiry, warranty and publish assertions are discarded',()=>{
  const d=draft('merchant_non_food',{name:'Lamp',price:179,stock:54321,account_id:8765,inventory_id:5678,
    expiry_date:'2035-05-05',certification:'fabricated',published:true,warranty:'fake',payout_destination:'secret'});
  const j=JSON.stringify(d);
  for(const v of ['179','54321','8765','5678','2035-05-05','fabricated','fake','secret'])assert.equal(j.includes(v),false,v);
  assert.ok(d.withheld_fields.includes('price'));assert.ok(d.withheld_fields.includes('stock'));
});
test('prepared ingredients are names only; never quantity, unit or recipe write',()=>{
  const d=draft('merchant_prepared_food',{catalog_category_code:'prepared_food',
    ingredients:[{name:'Fish',quantity:400,unit:'g'}, {name:'Water',quantity:1,unit:'L'}],recipe_cost:145});
  assert.deepEqual(d.ingredient_names,['Fish','Water']);
  assert.equal(JSON.stringify(d).includes('400'),false);
  assert.ok(d.required_review.includes('ingredient_quantities_in_canonical_recipe_editor'));
});
test('each food behavior is restricted to its own canonical food category',()=>{
  for(const [mode,code] of [['merchant_prepared_food','prepared_food'],['merchant_fresh_food','fresh_food'],['merchant_packaged_food','packaged_food_drink']]){
    assert.equal(draft(mode,{catalog_category_code:code}).hints.catalog_category_code,code);
    assert.throws(()=>draft(mode,{catalog_category_code:'furniture_home'}),/does not match/);
  }
});
test('nonfood category and attributes reuse canonical V3 definitions, no warranty',()=>{
  const d=draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{color:'Blue',width_cm:'90',warranty_months:'120',other:'secret'}});
  assert.equal(d.hints.catalog_category_code,'furniture_home');
  assert.deepEqual(d.hints.variant_attributes,[{code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'width_cm',value:'90',authority:'UNVERIFIED_MODEL_SUGGESTION'}]);
  assert.throws(()=>draft('merchant_non_food',{catalog_category_code:'prepared_food'}),/does not match/);
});
test('Supplier never borrows Merchant category, ingredients or business authority',()=>{
  const d=draft('supplier_catalog',{category:'Components',
    ingredients:['Fish'],pack_name:'24 units',base_unit:'unit',business_id:7});
  assert.equal(d.hints.catalog_category_code,null);assert.equal(d.hints.supplier_category_text,'Components');
  assert.deepEqual(d.ingredient_names,[]);assert.equal(d.hints.pack_name,'24 units');assert.equal(JSON.stringify(d).includes('business_id":7'),false);
});
test('malicious markup, control characters and prototype/evidence spoofing are inert',()=>{
  const d=draft('merchant_non_food',JSON.parse('{"name":"<img> Product","description":"<script>alert</script>","__proto__":{"admin":true},"evidence":"confirmed","published":true}'));
  assert.equal(/[<>]/.test(JSON.stringify(d.hints)),false);
  assert.equal(d.model_authority,'UNVERIFIED');assert.equal(Object.prototype.admin,undefined);
  assert.equal(JSON.stringify(d).includes('confirmed'),false);
});
test('model input unchanged and repeated normalization deterministic',()=>{
  const m={name:'Lemon ',tags:['fruit','FRUIT','fresh'],ingredients:[{name:'Lemon',quantity:4}],stock:100};
  const before=JSON.stringify(m),a=draft('merchant_prepared_food',m);
  assert.deepEqual(draft('merchant_prepared_food',m),a);
  assert.equal(JSON.stringify(m),before);assert.deepEqual(a.hints.tags,['fruit','fresh']);
});

test('provided mismatched or invalid category fails closed; absent category remains reviewable',()=>{
  for(const mode of AI_CATALOG_MODES){
    assert.equal(draft(mode,{name:'Unknown'}).hints.catalog_category_code,null);
    for(const invalid of [43,[],{},'invalid-category',' '.repeat(4),'x'.repeat(81)]){
      assert.throws(()=>draft(mode,{catalog_category_code:invalid}),/categor|mode|Supplier/i);
    }
  }
  assert.throws(()=>draft('supplier_catalog',{catalog_category_code:'prepared_food'}),/Supplier catalog/);
  assert.throws(()=>draft('merchant_prepared_food',{catalog_category_code:'fresh_food'}),/does not match/);
});
