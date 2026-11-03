import test from 'node:test';
import assert from 'node:assert/strict';
import {applyVoiceOrderTurn,voiceDraftForQuote} from '../merchant-voice-order-core.js';

const catalog=[
  {id:1,name:'Chicken Adobo',source_kind:'marketplace_product',active:true,available:true,selling_price:150,variant_mode:false,modifier_groups:[]},
  {id:2,name:'Rice',source_kind:'product',active:true,available:true,selling_price:25,modifier_groups:[]},
  {id:3,name:'Juice',source_kind:'marketplace_product',active:true,available:true,selling_price:30,modifier_groups:[]}
];
const context={businessId:7,sessionId:'device-session-A',catalog};
const op=(action,data={})=>({action,product_name:null,quantity:null,variant_name:null,modifier_names:[],customer_name:null,line_reference:null,...data});
const act=(operations,previousDraft=null,extra={})=>applyVoiceOrderTurn({...context,previousDraft,turn:{operations},...extra});
const seed=()=>act([
  op('set_customer',{customer_name:'Ana'}),op('add',{product_name:'Chicken Adobo',quantity:3}),
  op('add',{product_name:'Rice',quantity:1}),op('add',{product_name:'Juice',quantity:2})
]).draft;

test('one multi-item conversational turn prepares a named PHP draft, never a sale',()=>{
  const x=act([op('set_customer',{customer_name:'Ana'}),op('add',{product_name:'Chicken Adobo',quantity:3}),op('add',{product_name:'Rice',quantity:1}),op('add',{product_name:'Juice',quantity:2})]);
  assert.equal(x.can_create,false);assert.equal(x.needs_clarification,false);
  assert.equal(x.draft.status,'unposted_draft');assert.equal(x.draft.customer_name,'Ana');
  assert.equal(x.draft.subtotal_centavos,53500);
  assert.deepEqual(x.draft.lines.map(x=>[x.name,x.quantity]),[['Chicken Adobo',3],['Rice',1],['Juice',2]]);
  assert.match(x.draft.readback,/Not confirmed or paid/);
  assert.deepEqual(voiceDraftForQuote(x.draft).items.map(x=>[x.source_kind,x.product_id,x.quantity]),[
    ['marketplace_product',1,3],['product',2,1],['marketplace_product',3,2]
  ]);
});
test('multiple turns can correct quantity, decrease and remove without mutating earlier draft',()=>{
  const original=seed();
  const next=act([op('set_quantity',{product_name:'Juice',quantity:4}),op('remove',{product_name:'Rice'})],original).draft;
  assert.deepEqual(next.lines.map(x=>[x.name,x.quantity]),[['Chicken Adobo',3],['Juice',4]]);
  assert.equal(next.subtotal_centavos,57000);
  assert.equal(original.lines.length,3);assert.equal(original.lines[2].quantity,2);
  const final=act([op('decrease',{product_name:'Juice',quantity:1})],next).draft;
  assert.equal(final.lines[1].quantity,3);assert.equal(final.subtotal_centavos,54000);
});
test('one clearly referenced last added product can be corrected; multiple additions cannot',()=>{
  const first=act([op('add',{product_name:'Rice',quantity:2})]).draft;
  assert.equal(first.last_added_line_key,first.lines[0].line_key);
  const corrected=act([op('set_quantity',{line_reference:'last',quantity:5})],first).draft;
  assert.equal(corrected.lines[0].quantity,5);
  const ambiguity=act([op('set_quantity',{line_reference:'last',quantity:4})],seed());
  assert.equal(ambiguity.needs_clarification,true);assert.equal(ambiguity.reason,'LINE_UNCLEAR');
});
test('unknown product in a multi-action turn rolls back ALL changes in that turn',()=>{
  const prior=act([op('add',{product_name:'Rice',quantity:2})]).draft;
  const result=act([op('set_customer',{customer_name:'Nora'}),op('add',{product_name:'Chicken Adobo',quantity:2}),op('add',{product_name:'Unlisted Sushi',quantity:3})],prior);
  assert.equal(result.reason,'PRODUCT_UNKNOWN');assert.equal(result.needs_clarification,true);
  assert.deepEqual(result.draft.lines.map(x=>[x.name,x.quantity]),[['Rice',2]]);assert.equal(result.draft.customer_name,'');
});
test('catalog name collision between source identities cannot be guessed',()=>{
  const both=[...catalog,{id:1,source_kind:'product',name:'Chicken Adobo',selling_price:90,available:true}];
  const r=act([op('add',{product_name:'Chicken Adobo',quantity:1})],null,{catalog:both});
  assert.equal(r.reason,'PRODUCT_AMBIGUOUS');assert.equal(r.draft.lines.length,0);
});
test('ambiguous shorthand and pronouns ask a question instead of guessing',()=>{
  const both=[...catalog,{id:9,source_kind:'marketplace_product',name:'Chicken Adobo Special',selling_price:180,available:true}];
  const ambiguous=act([op('add',{product_name:'adobo',quantity:1})],null,{catalog:both});
  assert.equal(ambiguous.reason,'PRODUCT_AMBIGUOUS');
  const reference=act([op('add',{product_name:'those',quantity:3})]);
  assert.equal(reference.reason,'PRODUCT_UNCLEAR');
});
test('business, operator session and cross-business product boundaries fail closed',()=>{
  const p=seed();
  assert.throws(()=>act([op('readback')],p,{businessId:9}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>act([op('readback')],p,{sessionId:'another-device'}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>act([op('readback')],null,{catalog:[{...catalog[0],business_id:999}]}),{code:'CROSS_BUSINESS_CATALOG'});
  assert.throws(()=>act([op('readback')],null,{sessionId:''}),{code:'VOICE_CONTEXT_REQUIRED'});
});
test('unavailable product and non-integer or excessive quantities are always rejected',()=>{
  const unavailable=act([op('add',{product_name:'Rice',quantity:1})],null,{catalog:[{...catalog[1],available:false}]});
  assert.equal(unavailable.reason,'PRODUCT_UNAVAILABLE');
  for(const n of [0,-1,1.5,1000,NaN,'three']){
    const r=act([op('add',{product_name:'Rice',quantity:n})]);
    assert.equal(r.reason,'QUANTITY_UNCLEAR');
  }
});
test('AI-supplied prices, stock/payment instructions or forged IDs cannot affect draft truth',()=>{
  const r=act([op('add',{product_name:'Rice',quantity:1,unit_price_centavos:1,paid:true,product_id:999})]);
  assert.equal(r.draft.lines[0].unit_price_centavos,2500);
  for(const action of ['create','pay','refund','reserve_stock','mark_paid']){
    assert.equal(act([op(action)]).reason,'VOICE_ACTION_FORBIDDEN');
  }
  assert.equal(r.draft.status,'unposted_draft');
});
test('required variant and required modifier selection must be spoken and validated',()=>{
  const complex={id:10,source_kind:'marketplace_product',name:'Burger Meal',selling_price:100,active:true,available:true,variant_mode:true,
    variants:[{id:42,variant_key:'large',price_override:125,in_stock:true,active:true},{id:43,variant_key:'small',in_stock:false,active:true}],
    modifier_groups:[{id:5,name:'Sauce',min_select:1,max_select:1,options:[{id:7,name:'Extra sauce',price_delta:15,active:true}]}]};
  const c=[complex];
  assert.equal(act([op('add',{product_name:'Burger Meal',quantity:2})],null,{catalog:c}).reason,'VARIANT_REQUIRED');
  assert.equal(act([op('add',{product_name:'Burger Meal',quantity:2,variant_name:'large'})],null,{catalog:c}).reason,'MODIFIER_SELECTION_REQUIRED');
  assert.equal(act([op('add',{product_name:'Burger Meal',quantity:2,variant_name:'small',modifier_names:['Extra sauce']})],null,{catalog:c}).reason,'VARIANT_UNAVAILABLE');
  const valid=act([op('add',{product_name:'Burger Meal',quantity:2,variant_name:'large',modifier_names:['Extra sauce']})],null,{catalog:c});
  assert.equal(valid.needs_clarification,false);
  assert.deepEqual(valid.draft.lines.map(x=>[x.variant_id,x.modifier_option_ids,x.unit_price_centavos]),[[42,[7],14000]]);
  assert.equal(valid.draft.subtotal_centavos,28000);
  assert.equal(voiceDraftForQuote(valid.draft).items[0].variant_id,42);
});
test('previous draft is revalidated against live Catalog, including price changes',()=>{
  const old=seed();
  const changed=catalog.map(p=>p.id===2?{...p,selling_price:35}:p);
  const now=act([op('readback')],old,{catalog:changed}).draft;
  assert.equal(now.subtotal_centavos,54500);assert.equal(now.lines[1].unit_price_centavos,3500);
  assert.throws(()=>act([op('readback')],old,{catalog:catalog.filter(p=>p.id!==3)}),{code:'DRAFT_PRODUCT_STALE'});
});
test('clear and readback do not record financial operations; clear mixed with others is rejected',()=>{
  const prior=seed();
  const read=act([op('readback')],prior).draft;
  assert.equal(read.subtotal_centavos,53500);
  const clear=act([op('clear')],read).draft;
  assert.equal(clear.lines.length,0);assert.equal(clear.customer_name,'');
  assert.throws(()=>voiceDraftForQuote(clear),{code:'DRAFT_EMPTY'});
  assert.equal(act([op('clear'),op('add',{product_name:'Rice',quantity:1})],prior).reason,'VOICE_CLEAR_UNCLEAR');
});
test('line removal and quantity setting cannot affect ambiguous or absent products',()=>{
  const previous=seed();
  assert.equal(act([op('remove',{product_name:'Burger Meal'})],previous).reason,'PRODUCT_UNKNOWN');
  assert.equal(act([op('set_quantity',{product_name:'Rice',quantity:5})]).reason,'LINE_UNKNOWN');
  const limit=act([op('decrease',{product_name:'Rice',quantity:8})],previous);
  assert.equal(limit.reason,'QUANTITY_UNCLEAR');
});