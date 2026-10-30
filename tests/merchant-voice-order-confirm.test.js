import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {installMerchantVoiceOrderConfirmation,requireVoiceOperatorStepUp} from '../merchant-voice-order-confirm.js';
import {authoritativeVoiceOrderQuote} from '../merchant-voice-order-quote.js';
import {safeSessionId} from '../merchant-voice-order-routes.js';
import {signV2SessionToken} from '../auth-session-core.js';
const quoteSecret=Buffer.from('a'.repeat(32)),tokenSecret='tests-only-example-token-secret';
const token=signV2SessionToken(tokenSecret,44,'session-a',{issued:Date.parse('2026-10-30T23:00:00Z')});
const now=new Date('2026-10-30T23:01:00Z');
const req=(overrides={})=>({headers:{authorization:'Bearer '+token},
  body:{business_id:7,operator_confirmed:true,request_key:'voice_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},...overrides});
const snapshot={source_kind:'marketplace_product',source_id:11,name_snapshot:'Rice',quantity:2,
  catalog_variant_id:null,modifier_snapshot_json:{groups:[]},unit_price_snapshot:35,line_total:70};
const order={id:501,business_id:7,order_number:'BL-20261031-00501',payment_status:'unpaid',order_status:'awaiting_customer_presence',currency_code:'PHP',subtotal:70,total:70};
function signed(){const r=req(),sessionId=safeSessionId(r,44,7,quoteSecret);
  return authoritativeVoiceOrderQuote({draft:{status:'unposted_draft',business_id:7,session_id:sessionId,customer_name:'Ana',
    lines:[{source_kind:'marketplace_product',product_id:11,quantity:2,variant_id:null,modifier_option_ids:[]}]},
    snapshots:[snapshot],accountId:44,sessionId,businessId:7,secret:quoteSecret,now:new Date('2026-10-30T23:00:20Z')});}
function db({verified=true,revoked=false}={}){
  const state=new Map();const actions=[];
  return {state,actions,async connect(){let pending=null;return{
    async query(sql,params=[]){actions.push(String(sql).slice(0,130));
      if(sql==='BEGIN')return{rowCount:0};
      if(sql==='ROLLBACK'){pending=null;return{rowCount:0}};
      if(sql==='COMMIT'){if(pending)state.set(pending.key,pending.data);return{rowCount:0}};
      if(sql.includes('INSERT INTO merchant_voice_order_submissions')){
        const k=params.slice(0,3).join(':');
        if(state.has(k))return{rowCount:0,rows:[]};
        pending={key:k,data:{quote_hash:params[3],order_id:null}};return{rowCount:1,rows:[{request_key:params[2]}]};
      }
      if(sql.includes('SELECT quote_hash,order_id')){
        const old=state.get(params.join(':'));return{rowCount:old?1:0,rows:old?[old]:[]};
      }
      if(sql.includes('SELECT step_up_verified_at'))return{rowCount:revoked?0:1,rows:revoked?[]:[{step_up_verified_at:verified?'2026-10-30T23:00:55Z':null}]};
      if(sql.includes('UPDATE merchant_voice_order_submissions')){
        pending.data.order_id=params[3];return{rowCount:1,rows:[{order_id:params[3]}]};
      }
      throw Error('Unexpected SQL '+sql.slice(0,110));
    },release(){} }}}
}
function setup({disabled=false,accountId=44,businessId=7,verified=true,mutateCanonical=false,clock=now}={}){
  const handlers={},store=db({verified}),created=[],catalogCalls=[],velocity=[];
  const app={post:(path,...args)=>handlers[path]=args.at(-1)};
  installMerchantVoiceOrderConfirmation(app,{db:store,quoteSecret,tokenSecret,
    requireMerchant:async()=>({me:{account:{id:accountId}},business:{id:businessId}}),
    canonicalSnapshots:async(_client,p)=>{catalogCalls.push(p);return[{...snapshot,line_total:mutateCanonical?80:70}]},
    createCanonicalOrder:async params=>{created.push(params);return{id:501}},orderDetail:async()=>order,
    checkCreateVelocity:async context=>velocity.push(context),
    env:{ORDER_VOICE_UI_ENABLED:'1',ORDER_VOICE_AI_ENABLED:'1',ORDER_VOICE_CREATE_ENABLED:disabled?'0':'1'},now:()=>clock});
  const call=async body=>{
    let status=0,output=null;
    const res={set(){return this},status(n){status=n;return this},json(data){output=data;return this}};
    const input=req({body:{...req().body,signed_quote:signed(),...body}});
    await handlers['/api/orders/voice/confirm'](input,res);
    return{status,body:output};
  };
  return{store,created,catalogCalls,velocity,call};
}
test('voice confirm is disabled by default even for signed draft',async()=>{
  const f=setup({disabled:true}),r=await f.call({});assert.equal(r.status,503);assert.equal(r.body.code,'VOICE_CREATE_DISABLED');assert.equal(f.created.length,0);
});
test('explicit secure confirmation creates once; replay returns original unpaid order',async()=>{
  const f=setup(),first=await f.call({}),again=await f.call({});
  assert.equal(first.status,201);assert.equal(again.status,200);assert.equal(first.body.replayed,false);assert.equal(again.body.replayed,true);
  assert.equal(first.body.order_status,'awaiting_customer_presence');assert.equal(first.body.payment_status,'unpaid');
  assert.equal(f.created.length,1);assert.equal(f.velocity.length,1);assert.deepEqual(f.velocity[0],{accountId:44,businessId:7});
  assert.equal(f.created[0].counterPresence,false);
  assert.equal(f.created[0].client!==undefined,true);assert.equal(f.catalogCalls.length,1);
});
test('required explicit operator button confirmation and same merchant account/business',async()=>{
  const f=setup();assert.equal((await f.call({operator_confirmed:false})).status,400);
  assert.equal((await setup({accountId:45}).call({})).status,409);
  assert.equal((await setup({businessId:8}).call({})).status,403);
  assert.equal(f.created.length,0);
});
test('stale Catalog amount causes atomic rollback and no durable idempotency claim',async()=>{
  const f=setup({mutateCanonical:true}),r=await f.call({});
  assert.equal(r.status,409);assert.equal(r.body.code,'VOICE_QUOTE_STALE');assert.equal(f.created.length,0);assert.equal(f.store.state.size,0);
});
test('revoked or unverified step-up cannot create a voice order',async()=>{
  const f=setup({verified:false});const r=await f.call({});assert.equal(r.status,428);assert.equal(r.body.code,'VOICE_STEP_UP_REQUIRED');assert.equal(f.created.length,0);
});
test('same request key cannot be reused for different signed quoted intent',async()=>{
  const f=setup();assert.equal((await f.call({})).status,201);
  const alt=signed();const changed={...alt.quote,customer_name:'Amy'};
  alt.quote=changed;alt.signature=crypto.createHmac('sha256',quoteSecret).update(JSON.stringify(changed)).digest('base64url');
  const attempted=await f.call({signed_quote:alt});assert.equal(attempted.status,409);assert.equal(attempted.body.code,'VOICE_CREATE_KEY_REUSED');assert.equal(f.created.length,1);
});
test('expired quote may replay committed key, not create new order',async()=>{
  const f=setup(),first=await f.call({});assert.equal(first.status,201);
  const late=setup({clock:new Date('2026-10-30T23:05:00Z')});
  // Separate DB has no committed key -> expiration rejected.
  const expired=await late.call({});assert.equal(expired.status,409);assert.equal(expired.body.code,'VOICE_QUOTE_STALE');
});
test('same PostgreSQL transaction holds step-up session row FOR SHARE until commit',async()=>{
  const q=[];await requireVoiceOperatorStepUp({query:async(sql,params)=>{q.push({sql,params});return{rowCount:1,rows:[{step_up_verified_at:'2026-10-30T23:00:55Z'}]}}},
    {token,tokenSecret,accountId:44,now});assert.match(q[0].sql,/FOR SHARE/);assert.deepEqual(q[0].params,['session-a',44]);
});