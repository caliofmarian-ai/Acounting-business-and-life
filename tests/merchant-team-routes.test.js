import test from 'node:test';
import assert from 'node:assert/strict';
import {installMerchantTeamRoutes} from '../merchant-team-routes.js';
const ownerAccountId=31,businessId=8;
const shift={operator_id:'2109c7e0-f94e-491c-9801-41bc079c27b9',shift_id:'d37f909b-5133-4746-992a-f099b3c8428e',name:'Mother',role:'order_operator',permissions:['orders.voice_draft'],token:'x'.repeat(48)};
function rig({allow=true,enabled=true,resolve=null}={}){
  const handlers=new Map(),calls=[];
  const app={get:(path,handler)=>handlers.set('GET '+path,handler),post:(path,...handlersList)=>handlers.set('POST '+path,handlersList.at(-1)),patch:(path,...handlersList)=>handlers.set('PATCH '+path,handlersList.at(-1))};
  const team=installMerchantTeamRoutes(app,{
    db:{async connect(){throw Error('No DB writes in this test')},async query(){return{rows:[],rowCount:0}}},
    env:{MERCHANT_TEAM_ENABLED:enabled?'1':'0'},secret:'private-team-session-secret-123456789',tokenSecret:'account-token-secret-123456789',
    requireMerchant:async(_req,bid)=>{calls.push(['merchant-auth',bid]);if(!allow)throw Object.assign(new Error('Forbidden'),{status:403});return{me:{account:{id:ownerAccountId}},business:{id:bid}}},
    requireShift:resolve|| (async(_db,params)=>{calls.push(['team-shift',params]);return shift}),
    shiftStart:async()=>shift
  });
  const call=async(method,path,{query={},body={},headers={authorization:'Bearer an-authenticated-session-token-very-long'}}={})=>{
    let status=200,data=null;const res={set(){return res},status(v){status=v;return res},json(v){data=v;return res}};
    await handlers.get(`${method} ${path}`)({method,query,body,headers,params:{}},res);
    return{status,data};
  };
  return{team,call,calls,handlers};
}
test('team feature defaults disabled; operator routes cannot bypass main Merchant authorisation',async()=>{
  const disabled=rig({enabled:false});const x=await disabled.call('GET','/api/orders/team/operators',{query:{business_id:8}});
  assert.equal(x.status,503);
  const denied=rig({allow:false});const y=await denied.call('GET','/api/orders/team/operators',{query:{business_id:8}});
  assert.equal(y.status,403);
});
test('voice shift guard binds the selected operator to a valid Merchant session and business',async()=>{
  const v=rig();const c=await v.team.resolveForVoice({headers:{authorization:'Bearer an-authenticated-session-token-very-long',
    'x-merchant-team-shift':'x'.repeat(48)}},{accountId:31,businessId:8});
  assert.equal(c.operator_id,shift.operator_id);assert.ok(v.calls.some(x=>x[0]==='team-shift'&&x[1].businessId===8));
  assert.ok(v.calls.some(x=>x[0]==='team-shift'&&x[1].requiredPermission==='orders.voice_draft'));
});
test('account session and operator shift are separate: missing shift has no implicit owner bypass',async()=>{
  const v=rig({resolve:async()=>{throw Object.assign(new Error('Start your shift'),{status:403,code:'TEAM_SHIFT_REQUIRED'})}});
  await assert.rejects(v.team.resolveForVoice({headers:{authorization:'Bearer an-authenticated-session-token-very-long'}},
    {accountId:31,businessId:8}),/Start your shift/);
});
