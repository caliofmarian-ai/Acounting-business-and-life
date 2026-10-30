import test from 'node:test';
import assert from 'node:assert/strict';
import {installMerchantVoiceOrderRoutes,chargeVoiceOrderQuota} from '../merchant-voice-order-routes.js';
const op=(action,fields={})=>({action,product_name:null,quantity:null,variant_name:null,modifier_names:[],customer_name:null,line_reference:null,...fields});
const catalog=[{id:2,source_kind:'marketplace_product',name:'Rice',active:true,available:true,selling_price:25,modifier_groups:[]}];
function rig({businesses=[7],flag=true,configured=true,turns=[{operations:[op('set_customer',{customer_name:'Ana'}),op('add',{product_name:'Rice',quantity:3})]}],interpreter=null,charge=null,catalogItems=catalog,authorization='Bearer test-token'}={}){
  const handlers=new Map(),method=(verb)=>(path,...args)=>handlers.set(`${verb} ${path}`,args.at(-1));
  const app={get:method('GET'),post:method('POST')},calls=[];
  installMerchantVoiceOrderRoutes(app,{db:{},env:{ORDER_VOICE_UI_ENABLED:flag?'1':'0',ORDER_VOICE_AI_ENABLED:configured?'1':'0',ORDER_VOICE_AI_MODEL:'test-model',OPENAI_API_KEY:'fake'},
    requireMerchant:async(req,bid)=>{calls.push(['auth',bid]);if(!req.headers?.authorization)throw Object.assign(new Error('Unauthorized'),{status:401});if(!businesses.includes(bid))throw Object.assign(new Error('Not allowed'),{status:403});return{me:{account:{id:44}},business:{id:bid}}},
    catalogForBusiness:async bid=>{calls.push(['catalog',bid]);return catalogItems},
    interpret:interpreter|| (async({transcript})=>{calls.push(['provider',transcript]);return turns.shift()}),
    chargeQuota:charge|| (async()=>{calls.push(['quota'])}),secret:Buffer.from('test-secret')
  });
  const request=async(verb,path,{business_id=7,consent=true,transcript='three rice',previous_draft=null,headers={authorization}}={})=>{
    let status=200,payload=null,respHeaders={};const res={set:(k,v)=>{respHeaders[k]=v;return res},status:(s)=>{status=s;return res},json:(x)=>{payload=x;return res}};
    const req={headers,query:{business_id},body:{business_id,consent,transcript,previous_draft}};
    await handlers.get(`${verb} ${path}`)(req,res);
    return {status,payload,headers:respHeaders};
  };
  return {request,calls};
}
test('authenticated Merchant can request capabilities without publishing provider secrets',async()=>{
  const {request}=rig();const x=await request('GET','/api/orders/voice/capabilities');
  assert.equal(x.status,200);assert.equal(x.payload.enabled,true);assert.equal(x.payload.creates_orders,false);
  assert.equal(JSON.stringify(x).includes('fake'),false);assert.equal(x.headers['Cache-Control'],'private, no-store');
});
test('a normal AI turn gives a corrected server-Catalog PHP draft, never an order',async()=>{
  const {request,calls}=rig();const x=await request('POST','/api/orders/voice/turn');
  assert.equal(x.status,200);assert.equal(x.payload.draft.status,'unposted_draft');assert.equal(x.payload.draft.customer_name,'Ana');
  assert.equal(x.payload.draft.subtotal_centavos,7500);assert.equal(x.payload.can_create,false);
  assert.deepEqual(calls.map(x=>x[0]),['auth','catalog','quota','provider']);
});
test('wrong business and unsigned session are denied before provider or quota',async()=>{
  const obj=rig();const x=await obj.request('POST','/api/orders/voice/turn',{business_id:999});
  assert.equal(x.status,403);assert.deepEqual(obj.calls,['auth'].map(x=>[x,999]));
  const y=await obj.request('POST','/api/orders/voice/turn',{headers:{authorization:''}});
  assert.equal(y.status,401);assert.equal(obj.calls.filter(x=>x[0]==='provider').length,0);
});
test('feature flags, missing consent and empty transcript fail closed',async()=>{
  for(const cfg of [{flag:false},{configured:false}]){const a=rig(cfg);const v=await a.request('POST','/api/orders/voice/turn');assert.equal(v.status,503);assert.equal(a.calls.filter(x=>x[0]==='provider').length,0)}
  const obj=rig();assert.equal((await obj.request('POST','/api/orders/voice/turn',{consent:false})).status,403);
  assert.equal((await obj.request('POST','/api/orders/voice/turn',{transcript:' '.repeat(4)})).status,400);
});
test('faked draft prices and forged product identities are ignored/rejected',async()=>{
  const rigged=rig({turns:[{operations:[op('add',{product_name:'Rice',quantity:1})]},{operations:[op('readback')]}]});
  const first=await rigged.request('POST','/api/orders/voice/turn');
  const bad={...first.payload.draft,lines:first.payload.draft.lines.map(x=>({...x,unit_price_centavos:1,product_id:999}))};
  const second=await rigged.request('POST','/api/orders/voice/turn',{previous_draft:bad});
  assert.equal(second.status,409);assert.equal(rigged.calls.filter(x=>x[0]==='provider').length,1);
});
test('session or merchant context change invalidates previous draft BEFORE provider call',async()=>{
  const obj=rig({turns:[{operations:[op('add',{product_name:'Rice',quantity:1})]}]});
  const first=await obj.request('POST','/api/orders/voice/turn');
  const second=await obj.request('POST','/api/orders/voice/turn',{previous_draft:first.payload.draft,headers:{authorization:'Bearer new-device-token'}});
  assert.equal(second.status,409);assert.equal(second.payload.code,'VOICE_CONTEXT_STALE');assert.equal(obj.calls.filter(x=>x[0]==='provider').length,1);
});
test('clarification leaves all lines unchanged, displays question and does not create orders',async()=>{
  const obj=rig({turns:[{operations:[op('add',{product_name:'Unknown',quantity:4})]}]});
  const x=await obj.request('POST','/api/orders/voice/turn');assert.equal(x.status,200);assert.equal(x.payload.needs_clarification,true);assert.equal(x.payload.draft.lines.length,0);
});
test('missing or empty Catalog blocks model request',async()=>{
  const a=rig({catalogItems:[]});const x=await a.request('POST','/api/orders/voice/turn');assert.equal(x.status,409);assert.equal(a.calls.filter(v=>v[0]==='provider').length,0);
});
test('provider failure never discloses credentials, transcript or model payload',async()=>{
  const a=rig({interpreter:async()=>{throw Object.assign(new Error('model secret test transcript'),{status:503})}});
  const x=await a.request('POST','/api/orders/voice/turn');assert.equal(x.status,503);assert.equal(x.payload.code,'ORDER_VOICE_UNAVAILABLE');assert.equal(JSON.stringify(x).includes('model secret'),false);
});
test('abuse quota rejects before external AI, preserves HTTP 429',async()=>{
  const a=rig({charge:async()=>{throw Object.assign(new Error('No more calls'),{status:429,code:'ORDER_VOICE_RATE_LIMIT'})}});
  const x=await a.request('POST','/api/orders/voice/turn');assert.equal(x.status,429);assert.equal(x.headers['Retry-After'],'60');assert.equal(a.calls.filter(v=>v[0]==='provider').length,0);
});
test('daily and minute quotas are charged atomically and rolled back on limit',async()=>{
  let calls=0,commits=0,rollbacks=0, released=0;const db={connect:async()=>({
    query:async(text)=>{if(text==='COMMIT')commits++;if(text==='ROLLBACK')rollbacks++;if(text.startsWith('INSERT')){calls++;return{rowCount:calls===2?0:1}}return{rowCount:0}},release:()=>{released++}
  })};
  await assert.rejects(chargeVoiceOrderQuota(db,{businessId:7,accountId:44}),{status:429});
  assert.equal(commits,0);assert.equal(rollbacks,1);assert.equal(released,1);
});
test('insecure session omitted from request cannot reach provider',async()=>{
  const a=rig();const x=await a.request('POST','/api/orders/voice/turn',{headers:{}});assert.equal(x.status,401);assert.equal(a.calls.some(v=>v[0]==='provider'),false);
});