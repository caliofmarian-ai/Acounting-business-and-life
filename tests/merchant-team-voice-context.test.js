import test from 'node:test';
import assert from 'node:assert/strict';
import {installMerchantVoiceOrderRoutes} from '../merchant-voice-order-routes.js';

const rice={id:12,source_kind:'marketplace_product',name:'Rice',selling_price:25,
 active:true,available:true,category:'Food',variants:[],modifier_groups:[]};
const op=(action,fields={})=>({action,product_name:null,quantity:null,variant_name:null,
 modifier_names:[],customer_name:null,line_reference:null,...fields});
function rig({operator='mother',deny=false}={}){
 const handler=new Map(),calls=[];
 const app={get:(p,fn)=>handler.set('GET '+p,fn),post:(p,...f)=>handler.set('POST '+p,f.at(-1))};
 const shifts={mother:{operator_id:'ff2e1257-f3cf-4a12-a1b4-1d100deede18',shift_id:'b9a5376f-ec33-42a1-a624-912109f0dd1a',name:'Mother'},
  daughter:{operator_id:'fc76c197-e2ec-4ab2-b9ac-5f6cb6442c6d',shift_id:'23521c3e-447a-4af7-870b-38376f8d9d90',name:'Daughter'}};
 let selected=operator;
 installMerchantVoiceOrderRoutes(app,{
   db:{query:async()=>({rows:[]})},
   env:{MERCHANT_TEAM_ENABLED:'1',ORDER_VOICE_UI_ENABLED:'1',ORDER_VOICE_AI_ENABLED:'1',ORDER_VOICE_CREATE_ENABLED:'1',
     ORDER_VOICE_AI_MODEL:'fake',OPENAI_API_KEY:'fake'},
   secret:Buffer.from('test-voice-secret-at-least-32-bytes'),
   teamEnabled:()=>true,
   operatorResolver:async(req,{permission})=>{
     calls.push(['operator',selected,permission]);
     if(deny)throw Object.assign(new Error('This worker cannot order'),{status:403,code:'TEAM_PERMISSION_DENIED'});
     return shifts[selected];
   },
   requireMerchant:async(_req,businessId)=>({me:{account:{id:31}},business:{id:businessId}}),
   catalogForBusiness:async()=>[rice],
   snapshotsForBusiness:async({items})=>items.map(i=>({source_kind:i.source_kind,source_id:i.product_id,
     name_snapshot:'Rice',quantity:i.quantity,catalog_variant_id:null,modifier_snapshot_json:{groups:[]},
     unit_price_snapshot:25,line_total:25*i.quantity})),
   chargeQuota:async()=>{},
   interpret:async()=>({operations:[op('add',{product_name:'Rice',quantity:2})]}),
   confirmationReady:()=>true,passkeyReady:()=>true
 });
 async function request(method,path,{draft=null}={}){
  let status=200,body=null;
  const res={set(){return res},status(n){status=n;return res},json(v){body=v;return res}};
  const req={method,query:{business_id:8},body:{business_id:8,consent:true,transcript:'two rice',previous_draft:draft,draft},
   headers:{authorization:'Bearer signed-in-main-account-session-at-least-30-characters','x-merchant-team-shift':'some-session'}};
  await handler.get(`${method} ${path}`)(req,res);
  return{status,body};
 }
 return{request,setOperator:name=>{selected=name},calls};
}
test('two family operators share same Merchant Catalog but have distinct voice session bindings',async()=>{
 const a=rig();
 const first=await a.request('POST','/api/orders/voice/turn');
 assert.equal(first.status,200);
 assert.equal(first.body.draft.lines[0].quantity,2);
 assert.equal(first.body.operator_id,'ff2e1257-f3cf-4a12-a1b4-1d100deede18');
 const firstSession=first.body.draft.session_id;
 a.setOperator('daughter');
 const second=await a.request('POST','/api/orders/voice/turn');
 assert.equal(second.status,200);
 assert.notEqual(second.body.draft.session_id,firstSession);
 assert.equal(second.body.operator_id,'fc76c197-e2ec-4ab2-b9ac-5f6cb6442c6d');
 const stolen=await a.request('POST','/api/orders/voice/turn',{draft:first.body.draft});
 assert.equal(stolen.status,409);
 assert.equal(stolen.body.code,'VOICE_CONTEXT_STALE');
});
test('team mode hides account-level passkey confirmation until individual operator write authorization exists',async()=>{
 const t=rig();const caps=await t.request('GET','/api/orders/voice/capabilities');
 assert.equal(caps.status,200);
 assert.equal(caps.body.team_enabled,true);
 assert.equal(caps.body.can_confirm_order,false);
 assert.equal(caps.body.passkey_enrollment_available,false);
});
test('operator permission is checked before AI receives any instruction',async()=>{
 const t=rig({deny:true});const attempt=await t.request('POST','/api/orders/voice/turn');
 assert.equal(attempt.status,403);assert.equal(attempt.body.code,'TEAM_PERMISSION_DENIED');
});
