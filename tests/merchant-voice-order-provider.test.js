import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceOrderAIConfig,VOICE_ORDER_TURN_SCHEMA,interpretVoiceOrderText} from '../merchant-voice-order-provider.js';

const env={ORDER_VOICE_AI_ENABLED:'1',ORDER_VOICE_AI_MODEL:'test-model',OPENAI_API_KEY:'mock-private-key'};
const valid={operations:[{action:'add',product_name:'Chicken Adobo',quantity:3,variant_name:null,modifier_names:[],customer_name:null,line_reference:null},
  {action:'set_customer',product_name:null,quantity:null,variant_name:null,modifier_names:[],customer_name:'Ana',line_reference:null}]};
const catalog=[{name:'Chicken Adobo',active:true,available:true,variants:[],modifier_groups:[],selling_price:100}];
const request=(overrides={})=>({transcript:'Tatlong chicken adobo para kay Ana',catalog,consent:true,env,...overrides});
const good=turn=>async(_url,options)=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({status:'completed',output_text:JSON.stringify(turn)})});

test('provider requires deliberate enablement, model, key and voice-data consent',async()=>{
  assert.equal(voiceOrderAIConfig({}).ready,false);
  assert.equal(voiceOrderAIConfig({...env,ORDER_VOICE_AI_ENABLED:'0'}).ready,false);
  await assert.rejects(interpretVoiceOrderText(request({consent:false,fetchImpl:good(valid)})),{code:'ORDER_VOICE_AI_CONSENT_REQUIRED'});
  await assert.rejects(interpretVoiceOrderText(request({env:{},fetchImpl:good(valid)})),{code:'ORDER_VOICE_AI_NOT_CONFIGURED'});
});
test('bounded Responses request sends no prices, IDs, raw audio, payment or storage',async()=>{
  let payload,headers,url;
  const fetchImpl=async(u,opts)=>{url=u;headers=opts.headers;payload=JSON.parse(opts.body);return good(valid)(u,opts)};
  const answer=await interpretVoiceOrderText(request({priorLines:[{name:'Rice',quantity:1,unit_price_centavos:12345}],fetchImpl}));
  assert.deepEqual(answer,valid);assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal(headers.Authorization,'Bearer mock-private-key');assert.equal(payload.store,false);
  assert.equal(payload.background,false);assert.equal(payload.text.format.strict,true);
  assert.deepEqual(payload.text.format.schema,VOICE_ORDER_TURN_SCHEMA);
  const sent=payload.input[1].content[0].text;
  assert.match(sent,/Chicken Adobo/);assert.match(sent,/Tatlong/);
  assert.doesNotMatch(sent,/unit_price|selling_price|payment|12345|business_id|product_id/);
});
test('unsupported model action or injected payment instruction is refused locally',async()=>{
  const unauthorized={operations:[{...valid.operations[0],action:'pay'}]};
  await assert.rejects(interpretVoiceOrderText(request({fetchImpl:good(unauthorized)})),{code:'ORDER_VOICE_AI_INVALID_OUTPUT'});
  await assert.rejects(interpretVoiceOrderText(request({fetchImpl:good({operations:[{...valid.operations[0],price:0}]})})),{code:'ORDER_VOICE_AI_INVALID_OUTPUT'});
});
test('provider fails closed on incomplete, malformed, oversized or failed responses',async()=>{
  for(const fetchImpl of [
    async()=>({ok:false}),async()=>{throw Error('timeout')},
    async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({status:'incomplete'})}),
    async()=>({ok:true,headers:{get:()=>null},text:async()=>'{'}),
    async()=>({ok:true,headers:{get:()=>200000},text:async()=>''})
  ])await assert.rejects(interpretVoiceOrderText(request({fetchImpl})),error=>error.code?.startsWith('ORDER_VOICE_AI_'));
});
test('unrelated conversation yields empty safe operations, not a fabricated order',async()=>{
  const response=await interpretVoiceOrderText(request({transcript:'Hello, how are you?',fetchImpl:good({operations:[]})}));
  assert.deepEqual(response,{operations:[]});
});
test('transcript, catalog and draft are size-limited before any external request',async()=>{
  for(const overrides of [
    {transcript:' '},{transcript:'x'.repeat(1501)},
    {catalog:Array.from({length:401},(_,i)=>({name:'Product '+i,active:true,available:true}))},
    {priorLines:Array.from({length:51},()=>({name:'Rice'}))}
  ])await assert.rejects(interpretVoiceOrderText(request({...overrides,fetchImpl:()=>{throw Error('should not request')}})),error=>error.code?.startsWith('ORDER_VOICE_AI_'));
});