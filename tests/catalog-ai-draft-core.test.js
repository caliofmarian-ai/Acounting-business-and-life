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
    for(const invalid of [null,'',43,[],{},'invalid-category',' '.repeat(4),'x'.repeat(81)]){
      assert.throws(()=>draft(mode,{catalog_category_code:invalid}),/categor|mode|Supplier/i);
    }
  }
  assert.throws(()=>draft('supplier_catalog',{catalog_category_code:'prepared_food'}),/Supplier catalog/);
  assert.throws(()=>draft('merchant_prepared_food',{catalog_category_code:'fresh_food'}),/does not match/);
});

test('malformed category identifiers never become trusted taxonomy by sanitization',()=>{
  for(const [mode,raw] of [
    ['merchant_prepared_food','<prepared_food>'],
    ['merchant_prepared_food','prepared_food'+String.fromCharCode(10)],
    ['merchant_fresh_food',' fresh_food'],
    ['merchant_packaged_food','packaged_food_drink>'],
    ['merchant_non_food','<furniture_home>'],
    ['merchant_non_food','furniture_home'+String.fromCharCode(9)],
    ['merchant_non_food',' furniture_home'],
  ])assert.throws(()=>draft(mode,{catalog_category_code:raw}),/Invalid AI catalog category/);
  assert.equal(draft('merchant_prepared_food',{catalog_category_code:'prepared_food'}).hints.catalog_category_code,'prepared_food');
  assert.equal(draft('merchant_non_food',{catalog_category_code:'furniture_home'}).hints.catalog_category_code,'furniture_home');
});

test('prototype-inherited model suggestions never appear as actual JSON hints',()=>{
  // Non-enumerable prototype pollution can arise elsewhere in a JS process.
  // Restore it synchronously so no test or application state is changed.
  const injected={
    catalog_category_code:'furniture_home',
    name:'INHERITED_PHANTOM_PRODUCT',
    description:'INHERITED_PHANTOM_DESCRIPTION',
    tags:['inherited-phantom-tag'],
    category:'INHERITED_SUPPLIER_CATEGORY',
    variant_attributes:{color:'INHERITED_PHANTOM_COLOR'},
    ingredients:['INHERITED_PHANTOM_FOOD']
  };
  const original=new Map(Object.keys(injected).map(k=>[k,Object.getOwnPropertyDescriptor(Object.prototype,k)]));
  try{
    for(const [k,value] of Object.entries(injected))
      Object.defineProperty(Object.prototype,k,{value,configurable:true,enumerable:false,writable:true});
    const draftNoCategory=draft('merchant_non_food',{title:'Real title'});
    assert.equal(draftNoCategory.hints.name,'Real title');
    assert.equal(draftNoCategory.hints.catalog_category_code,null);
    assert.equal(draftNoCategory.hints.description,'');
    assert.deepEqual(draftNoCategory.hints.tags,[]);
    assert.deepEqual(draftNoCategory.hints.variant_attributes,[]);
    const supplier=draft('supplier_catalog',{name:'Genuine supplier item'});
    assert.equal(supplier.hints.supplier_category_text,'');
    const food=draft('merchant_prepared_food',{ingredients:[{}]});
    assert.deepEqual(food.ingredient_names,[]);
    const ownFields=draft('merchant_non_food',{
      name:'Genuine lamp',catalog_category_code:'furniture_home',tags:['genuine']
    });
    assert.equal(ownFields.hints.name,'Genuine lamp');
    assert.equal(ownFields.hints.catalog_category_code,'furniture_home');
    assert.deepEqual(ownFields.hints.tags,['genuine']);
  }finally{
    for(const [k,descriptor] of original){
      if(descriptor)Object.defineProperty(Object.prototype,k,descriptor);
      else delete Object.prototype[k];
    }
  }
});

test('inherited toJSON at root or nested levels never hides oversized JSON',()=>{
  const original=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
  try{
    Object.defineProperty(Object.prototype,'toJSON',{
      configurable:true,writable:true,value(){return {name:'tiny'};}
    });
    assert.throws(()=>draft('merchant_non_food',{
      name:'X'.repeat(40000),catalog_category_code:'furniture_home'
    }),/32 KiB/);
    assert.throws(()=>draft('merchant_non_food',{
      name:'Normal',variant_attributes:{color:'X'.repeat(40000)}
    }),/32 KiB/);
    const valid=draft('merchant_non_food',{
      name:'Genuine',catalog_category_code:'furniture_home',tags:['safe']
    });
    assert.equal(valid.hints.name,'Genuine');
    assert.equal(valid.hints.catalog_category_code,'furniture_home');
    assert.deepEqual(valid.hints.tags,['safe']);
  }finally{
    if(original)Object.defineProperty(Object.prototype,'toJSON',original);
    else delete Object.prototype.toJSON;
  }
});
test('own serializers, accessors and non-JSON nested values fail closed',()=>{
  assert.throws(()=>draft('merchant_non_food',{
    name:'X'.repeat(40000),toJSON(){return {name:'tiny'};}
  }),/Invalid AI catalog JSON/);
  const accessor={catalog_category_code:'furniture_home'};
  Object.defineProperty(accessor,'name',{enumerable:true,get(){return 'hidden';}});
  assert.throws(()=>draft('merchant_non_food',accessor),/Invalid AI catalog JSON/);
  assert.throws(()=>draft('merchant_non_food',{
    name:'Item',variant_attributes:{color:()=> 'secret'}
  }),/Invalid AI catalog JSON/);
});
test('32 KiB boundary is measured from actual UTF-8 JSON data',()=>{
  const overhead=Buffer.byteLength(JSON.stringify({name:''}),'utf8');
  assert.doesNotThrow(()=>draft('merchant_non_food',{name:'A'.repeat(32768-overhead)}));
  assert.throws(()=>draft('merchant_non_food',{name:'A'.repeat(32769-overhead)}),/32 KiB/);
  assert.throws(()=>draft('merchant_non_food',{name:'😀'.repeat(9000)}),/32 KiB/);
});


test('non-JSON hidden own fields and extra array properties cannot evade preflight',()=>{
  const oversizedHidden={};
  Object.defineProperty(oversizedHidden,'name',{
    enumerable:false,value:'X'.repeat(40000)
  });
  assert.throws(()=>draft('merchant_non_food',oversizedHidden),/Invalid AI catalog JSON/);

  let accessorRan=false;
  const hiddenGetter={};
  Object.defineProperty(hiddenGetter,'name',{
    enumerable:false,get(){accessorRan=true;return 'injected suggestion';}
  });
  assert.throws(()=>draft('merchant_non_food',hiddenGetter),/Invalid AI catalog JSON/);
  assert.equal(accessorRan,false,'preflight must not execute a hidden getter');

  const nested={name:'Lamp',variant_attributes:{color:'Blue'}};
  Object.defineProperty(nested.variant_attributes,'hidden',{
    enumerable:false,value:'X'.repeat(40000)
  });
  assert.throws(()=>draft('merchant_non_food',nested),/Invalid AI catalog JSON/);

  const arrayExtra={name:'Lamp',tags:['safe']};
  arrayExtra.tags.extra='not JSON array data';
  assert.throws(()=>draft('merchant_non_food',arrayExtra),/Invalid AI catalog JSON/);

  const symbolExtra={name:'Lamp'};
  symbolExtra[Symbol('private')]='not a JSON field';
  assert.throws(()=>draft('merchant_non_food',symbolExtra),/Invalid AI catalog JSON/);

  // Real parsed JSON (the provider contract) remains valid across all five modes.
  for(const mode of AI_CATALOG_MODES){
    const value=JSON.parse('{"name":"Real item","tags":["valid"]}');
    const normalized=draft(mode,value);
    assert.equal(normalized.hints.name,'Real item');
    assert.deepEqual(normalized.hints.tags,['valid']);
    assert.equal(normalized.publishable,false);
  }
});
