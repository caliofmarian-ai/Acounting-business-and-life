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

test('shared JavaScript references are rejected before exponential preflight expansion',()=>{
  const shared={name:'Reusable leaf'};
  const sameLeaf={name:'Lamp',tags:[shared,shared]};
  assert.throws(()=>draft('merchant_non_food',sameLeaf),/Invalid AI catalog JSON/);

  let graph={value:'leaf'};
  for(let depth=0;depth<50;depth++)graph={left:graph,right:graph};
  assert.throws(()=>draft('merchant_non_food',{name:'Lamp',extra:graph}),/Invalid AI catalog JSON/);

  // Duplicate JSON *values* are valid when they are distinct parsed objects.
  const actualJson=JSON.parse('{"name":"Lamp","tags":["safe","safe"],"extra":{"left":{"value":"leaf"},"right":{"value":"leaf"}}}');
  for(const mode of AI_CATALOG_MODES){
    const result=draft(mode,actualJson);
    assert.equal(result.hints.name,'Lamp');
    assert.deepEqual(result.hints.tags,['safe']);
    assert.equal(result.draft_only,true);
    assert.equal(result.publishable,false);
  }
});

test('preflight snapshot prevents Proxy get trap from replacing an approved short hint',()=>{
  let nameReads=0;
  const model=new Proxy({name:'Short name',tags:['safe']},{
    get(target,field,receiver){
      if(field==='name'){nameReads++;return 'X'.repeat(40000);}
      return Reflect.get(target,field,receiver);
    }
  });
  const d=draft('merchant_non_food',model);
  assert.equal(nameReads,0,'only own data descriptors from preflight may be read');
  assert.equal(d.hints.name,'Short name');
  assert.deepEqual(d.hints.tags,['safe']);
  assert.equal(d.publishable,false);
});

test('preflight snapshot is authoritative for category, tags, ingredients and attribute hints',()=>{
  let reads=0;
  const model=new Proxy({
    name:'Real food',catalog_category_code:'prepared_food',
    tags:['legitimate'],ingredients:[{name:'Fish',quantity:9}]
  },{
    get(target,field,receiver){
      if(['catalog_category_code','tags','ingredients'].includes(field)){
        reads++;
        if(field==='catalog_category_code')return 'fresh_food';
        if(field==='tags')return ['forged'];
        return [{name:'INJECTED',quantity:999}];
      }
      return Reflect.get(target,field,receiver);
    }
  });
  const food=draft('merchant_prepared_food',model);
  assert.equal(reads,0,'untrusted original is never reread after snapshot');
  assert.equal(food.hints.catalog_category_code,'prepared_food');
  assert.deepEqual(food.hints.tags,['legitimate']);
  assert.deepEqual(food.ingredient_names,['Fish']);
  const ordinary=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',
    variant_attributes:{color:'Blue'},tags:['safe','safe']
  });
  assert.deepEqual(ordinary.hints.tags,['safe']);
  assert.deepEqual(ordinary.hints.variant_attributes,[
    {code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
});

test('oversized AI trees fail during traversal without serializing an unbounded object',()=>{
  const original=JSON.stringify;
  let primitiveCalls=0;
  try{
    JSON.stringify=function(value,...args){
      if(value!==null&&typeof value==='object')
        throw new Error('Cannot stringify the entire unbounded model object');
      primitiveCalls++;
      return original.call(this,value,...args);
    };
    assert.throws(()=>draft('supplier_catalog',{name:'X'.repeat(2_000_000)}),/32 KiB/);
    assert.equal(draft('supplier_catalog',{name:'Safe item'}).hints.name,'Safe item');
    assert.throws(()=>draft('supplier_catalog',{
      tags:Array.from({length:500},()=> 'A'.repeat(100))
    }),/32 KiB/);
    assert.ok(primitiveCalls>0&&primitiveCalls<500,
      'aggregate byte cap stops before all values are serialized');
  }finally{
    JSON.stringify=original;
  }
});

test('streamed JSON byte count includes string escaping, Unicode and container punctuation',()=>{
  const slash=String.fromCharCode(92);
  const inside=slash.repeat(16378);
  const outside=slash.repeat(16379);
  assert.equal(Buffer.byteLength(JSON.stringify({name:inside}),'utf8'),32767);
  assert.equal(Buffer.byteLength(JSON.stringify({name:outside}),'utf8'),32769);
  assert.doesNotThrow(()=>draft('supplier_catalog',{name:inside}));
  assert.throws(()=>draft('supplier_catalog',{name:outside}),/32 KiB/);
  const emoji=String.fromCodePoint(0x1f600).repeat(8190);
  assert.equal(Buffer.byteLength(JSON.stringify({name:emoji}),'utf8'),32771);
  assert.throws(()=>draft('supplier_catalog',{name:emoji}),/32 KiB/);
});

test('Unicode bidi formatting controls cannot reorder unverified product display hints',()=>{
  const food=draft('merchant_prepared_food',{
    name:'Chicken\u202eAdobo',
    description:'Stew\u2066 with rice',
    tags:['spicy\u200fhot'],
    ingredients:[{name:'Fish\u202c Sauce'}]
  });
  assert.equal(food.hints.name,'Chicken Adobo');
  assert.equal(food.hints.description,'Stew with rice');
  assert.deepEqual(food.hints.tags,['spicy hot']);
  assert.deepEqual(food.ingredient_names,['Fish Sauce']);
  const nonFood=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',
    variant_attributes:{color:'Red\u2069Blue'}
  });
  assert.deepEqual(nonFood.hints.variant_attributes,[
    {code:'color',value:'Red Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  const hints=JSON.stringify({food:food.hints,ingredients:food.ingredient_names,nonFood:nonFood.hints});
  assert.doesNotMatch(hints,/[\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/);
  const ordinary=draft('supplier_catalog',{name:'Kape ☕ – ₱100'});
  assert.equal(ordinary.hints.name,'Kape ☕ – ₱100');
});


test('typed V3 numeric and boolean suggestions remain unverified display hints',()=>{
  const modelOutput={catalog_category_code:'furniture_home',variant_attributes:{
    color:'Blue',width_cm:90.5,assembly_required:true,weight_kg:12.25,
    warranty_months:36,material:42}};
  const d=draft('merchant_non_food',modelOutput);
  assert.deepEqual(d.hints.variant_attributes,[
    {code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'width_cm',value:'90.5',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'assembly_required',value:'true',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'weight_kg',value:'12.25',authority:'UNVERIFIED_MODEL_SUGGESTION'}]);
  assert.equal(d.model_authority,'UNVERIFIED');
  assert.equal(d.canonical_write_payload,false);
  assert.equal(d.publishable,false);
  assert.equal(modelOutput.variant_attributes.width_cm,90.5);
  assert.equal(modelOutput.variant_attributes.assembly_required,true);
});
test('invalid typed attribute suggestions fail closed without coercing unrelated types',()=>{
  const d=draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{width_cm:-5,weight_kg:false,assembly_required:1,
      color:true,material:'Plywood',height_cm:0}});
  assert.deepEqual(d.hints.variant_attributes,[
    {code:'material',value:'Plywood',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'height_cm',value:'0',authority:'UNVERIFIED_MODEL_SUGGESTION'}]);
  assert.throws(()=>draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{width_cm:Infinity}}),/Invalid AI catalog JSON/);
  assert.throws(()=>draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{width_cm:NaN}}),/Invalid AI catalog JSON/);
});

test('V3 select attributes retain only canonical enum suggestions',()=>{
  const good=draft('merchant_non_food',{
    catalog_category_code:'clothing_fashion',
    variant_attributes:{target_audience:' Women ',color:'Blue'}
  });
  assert.deepEqual(good.hints.variant_attributes,[
    {code:'target_audience',value:'women',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  for(const bad of ['fictional','kids<script>','Unisex'+String.fromCharCode(0x202e),
    'men or women',true,5,[],{}]){
    const got=draft('merchant_non_food',{
      catalog_category_code:'clothing_fashion',
      variant_attributes:{target_audience:bad,color:'Blue'}
    });
    assert.deepEqual(got.hints.variant_attributes,[
      {code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'}
    ],'invalid select suggestion: '+JSON.stringify(bad));
  }
  const other=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',variant_attributes:{target_audience:'women'}
  });
  assert.deepEqual(other.hints.variant_attributes,[]);
  assert.equal(good.draft_only,true);
  assert.equal(good.publishable,false);
  assert.equal(good.canonical_write_payload,false);
});

test('V3 typed numeric and Boolean string hints reject unfit model values',()=>{
  const got=draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{width_cm:'huge',length_cm:'-5',height_cm:'Infinity',
      weight_kg:'1 kg',assembly_required:'maybe',material:'Plywood',color:'Oak'}});
  assert.deepEqual(got.hints.variant_attributes,[
    {code:'material',value:'Plywood',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'color',value:'Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  assert.equal(got.draft_only,true);
  assert.equal(got.publishable,false);
});
test('V3 typed numeric and Boolean strings are normalized only when canonical-compatible',()=>{
  const got=draft('merchant_non_food',{catalog_category_code:'furniture_home',
    variant_attributes:{width_cm:'0.50',height_cm:' 90 ',weight_kg:12.25,
      assembly_required:'false',material:'Plywood'}});
  assert.deepEqual(got.hints.variant_attributes,[
    {code:'width_cm',value:'0.5',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'height_cm',value:'90',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'weight_kg',value:'12.25',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'assembly_required',value:'false',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'material',value:'Plywood',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  const other=draft('merchant_non_food',{catalog_category_code:'jewellery_accessories',
    variant_attributes:{customizable:'true',weight_kg:'-0.5',material:'Silver'}});
  assert.deepEqual(other.hints.variant_attributes,[
    {code:'customizable',value:'true',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'material',value:'Silver',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  assert.equal(got.model_authority,'UNVERIFIED');
  assert.equal(got.canonical_write_payload,false);
});

test('untrusted invisible word boundaries are visible while ordinary emoji joins survive',()=>{
  for(const hidden of ['\u200b','\u2060']){
    const d=draft('merchant_non_food',{
      catalog_category_code:'furniture_home',
      name:'Bacoor'+hidden+'Outlet',
      description:'Wood'+hidden+'finish',
      tags:['home'+hidden+'office'],
      variant_attributes:{color:'Light'+hidden+'Oak',width_cm:'1'+hidden+'2'}
    });
    assert.equal(d.hints.name,'Bacoor Outlet');
    assert.equal(d.hints.description,'Wood finish');
    assert.deepEqual(d.hints.tags,['home office']);
    assert.deepEqual(d.hints.variant_attributes,[
      {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
    ]);
    assert.equal(d.publishable,false);
    assert.equal(d.canonical_write_payload,false);
  }
  const emoji=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',name:'Chef 👩‍🍳',
    variant_attributes:{color:'Blue'}
  });
  assert.equal(emoji.hints.name,'Chef 👩‍🍳');
  assert.deepEqual(emoji.hints.variant_attributes,[
    {code:'color',value:'Blue',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
});

test('additional invisible model formatting controls are displayed as boundaries, not trusted typed values',()=>{
  // A model may hide word boundaries with default-ignorable marks other than
  // U+200B/U+2060. They must not survive as invisible catalogue hints.
  for(const hidden of ['\u00ad','\u034f','\u180e','\u200c','\u2061','\u2064','\u206a']){
    const result=draft('merchant_non_food',{
      catalog_category_code:'furniture_home',
      name:'Bacoor'+hidden+'Outlet',
      description:'Natural'+hidden+'wood',
      tags:['home'+hidden+'office'],
      variant_attributes:{color:'Light'+hidden+'Oak',width_cm:'1'+hidden+'2'}
    });
    assert.equal(result.hints.name,'Bacoor Outlet');
    assert.equal(result.hints.description,'Natural wood');
    assert.deepEqual(result.hints.tags,['home office']);
    assert.deepEqual(result.hints.variant_attributes,[
      {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
    ]);
    const select=draft('merchant_non_food',{
      catalog_category_code:'clothing_fashion',
      variant_attributes:{target_audience:'wo'+hidden+'men'}
    });
    assert.deepEqual(select.hints.variant_attributes,[]);
    assert.equal(result.draft_only,true);
    assert.equal(result.publishable,false);
    assert.equal(result.canonical_write_payload,false);
  }
  // Do not break the ordinary zero-width joiner used in emoji sequences.
  assert.equal(draft('merchant_non_food',{
    catalog_category_code:'furniture_home',name:'Chef 👩‍🍳'
  }).hints.name,'Chef 👩‍🍳');
});


test('non-emoji zero-width joiners cannot hide AI display words or typed category hints',()=>{
  const d=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',
    name:'Bacoor\u200dOutlet',
    description:'Natural\u200dWood',
    tags:['home\u200doffice'],
    variant_attributes:{
      color:'Light\u200dOak',
      width_cm:'1\u200d2'
    }
  });
  assert.equal(d.hints.name,'Bacoor Outlet');
  assert.equal(d.hints.description,'Natural Wood');
  assert.deepEqual(d.hints.tags,['home office']);
  assert.deepEqual(d.hints.variant_attributes,[
    {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  assert.deepEqual(draft('merchant_prepared_food',{
    ingredients:['Fish\u200dSauce']
  }).ingredient_names,['Fish Sauce']);
  assert.deepEqual(draft('merchant_non_food',{
    catalog_category_code:'clothing_fashion',
    variant_attributes:{target_audience:'wo\u200dmen'}
  }).hints.variant_attributes,[]);
  for(const emoji of ['👩‍🍳','👩🏽‍💻','👩‍❤️‍👩']){
    assert.equal(draft('merchant_non_food',{name:'Chef '+emoji}).hints.name,'Chef '+emoji);
  }
  assert.equal(d.draft_only,true);
  assert.equal(d.publishable,false);
  assert.equal(d.canonical_write_payload,false);
});

test('Hangul fillers and Braille blank do not disguise unverified display-hint word boundaries',()=>{
  // These visually blank characters are not JavaScript whitespace; leaving
  // them unchanged can make different names look identical to a reviewer.
  for(const hidden of ['\u115f','\u1160','\u2800','\u3164','\uffa0']){
    const d=draft('merchant_non_food',{
      catalog_category_code:'furniture_home',
      name:'Bacoor'+hidden+'Outlet',
      description:'Natural'+hidden+'wood',
      tags:['home'+hidden+'office'],
      variant_attributes:{color:'Light'+hidden+'Oak',width_cm:'1'+hidden+'2'}
    });
    assert.equal(d.hints.name,'Bacoor Outlet');
    assert.equal(d.hints.description,'Natural wood');
    assert.deepEqual(d.hints.tags,['home office']);
    assert.deepEqual(d.hints.variant_attributes,[
      {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
    ]);
    assert.equal(d.state,'REVIEW_REQUIRED');
    assert.equal(d.publishable,false);
    assert.equal(d.canonical_write_payload,false);
  }
  const emoji=draft('merchant_prepared_food',{name:'Chef 👩🏽‍💻',
    ingredients:['Fish']});
  assert.equal(emoji.hints.name,'Chef 👩🏽‍💻');
  assert.deepEqual(emoji.ingredient_names,['Fish']);
  assert.equal(emoji.draft_only,true);
});

test('blank model name falls back to valid sanitized title, with the primary name still preferred',()=>{
  for(const malformedName of ['   ', '\u200b', '<>', 42, {untrusted:true}]){
    const suggestion=draft('merchant_non_food',{
      catalog_category_code:'furniture_home',name:malformedName,title:'Bright Oak Table'
    });
    assert.equal(suggestion.hints.name,'Bright Oak Table');
    assert.equal(suggestion.state,'REVIEW_REQUIRED');
    assert.equal(suggestion.publishable,false);
    assert.equal(suggestion.canonical_write_payload,false);
  }
  const sanitizedTitle=draft('merchant_non_food',{
    name:'  ',title:'Bright\u200dOak Table',catalog_category_code:'furniture_home'
  });
  assert.equal(sanitizedTitle.hints.name,'Bright Oak Table');
  assert.equal(draft('merchant_non_food',{
    name:'Primary Lamp',title:'Secondary Table',catalog_category_code:'furniture_home'
  }).hints.name,'Primary Lamp');
  assert.equal(draft('merchant_non_food',{
    name:'  ',title:'  ',catalog_category_code:'furniture_home'
  }).hints.name,'');
});


test('model Unicode review hints preserve complete emoji and never expose lone surrogate halves',()=>{
  const almostFull='A'.repeat(119);
  const truncated=draft('merchant_non_food',{
    name:almostFull+'😀',description:'D'.repeat(599)+'😀',
    tags:['Clean😀','Bad\uD800value','Leading\uDC00value']
  });
  assert.equal(truncated.hints.name,almostFull);
  assert.equal(truncated.hints.description,'D'.repeat(599));
  assert.deepEqual(truncated.hints.tags,['Clean😀','Bad value','Leading value']);
  const fits=draft('merchant_non_food',{name:'A'.repeat(118)+'😀',
    description:'D'.repeat(598)+'😀'});
  assert.equal(fits.hints.name,'A'.repeat(118)+'😀');
  assert.equal(fits.hints.description,'D'.repeat(598)+'😀');
  const jsonSuggestion=JSON.parse('{"name":"\\ud800","title":"Philippine mango"}');
  const fallback=draft('merchant_non_food',jsonSuggestion);
  assert.equal(fallback.hints.name,'Philippine mango');
  for(const d of [truncated,fits,fallback]){
    assert.equal(d.publishable,false);
    assert.equal(d.canonical_write_payload,false);
    assert.equal(d.state,'REVIEW_REQUIRED');
  }
});

test('C1 nonprinting controls cannot be hidden inside model review hints',()=>{
  // U+0085 NEXT LINE and other C1 control codes are not JavaScript whitespace.
  // They must not survive as invisible bytes in untrusted displayed labels.
  for(const hidden of ['\u0085','\u008e','\u009c','\u009f']){
    const d=draft('merchant_non_food',{
      catalog_category_code:'furniture_home',
      name:'Bacoor'+hidden+'Outlet',
      description:'Natural'+hidden+'wood',
      tags:['home'+hidden+'office'],
      variant_attributes:{color:'Light'+hidden+'Oak',width_cm:'1'+hidden+'2'}
    });
    assert.equal(d.hints.name,'Bacoor Outlet');
    assert.equal(d.hints.description,'Natural wood');
    assert.deepEqual(d.hints.tags,['home office']);
    assert.deepEqual(d.hints.variant_attributes,[
      {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'}
    ],'typed C1 control hint must be dropped, not converted');
    assert.equal(d.state,'REVIEW_REQUIRED');
    assert.equal(d.publishable,false);
    assert.equal(d.canonical_write_payload,false);
  }
  assert.equal(draft('merchant_prepared_food',{name:'Chef 👩‍🍳'}).hints.name,'Chef 👩‍🍳');
});

test('unknown model attribute keys cannot crowd valid V3 hints out of the bounded draft',()=>{
  const manyUnknown={};
  for(let i=0;i<50;i++)manyUnknown['unrecognized_'+i]='untrusted';
  manyUnknown.color='Light Oak';
  manyUnknown.width_cm='90';
  manyUnknown.warranty_months='60';
  const d=draft('merchant_non_food',{
    catalog_category_code:'furniture_home',variant_attributes:manyUnknown
  });
  assert.deepEqual(d.hints.variant_attributes,[
    {code:'color',value:'Light Oak',authority:'UNVERIFIED_MODEL_SUGGESTION'},
    {code:'width_cm',value:'90',authority:'UNVERIFIED_MODEL_SUGGESTION'}
  ]);
  assert.equal(d.state,'REVIEW_REQUIRED');
  assert.equal(d.publishable,false);
  assert.equal(d.canonical_write_payload,false);
});
