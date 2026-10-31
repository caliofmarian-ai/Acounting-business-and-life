import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ensureMerchantTeamOrderAttributionSchema,recordStaffOrderAttribution,
  validateStaffOrderAttribution} from '../merchant-team-order-attribution.js';

const order={orderId:5,businessId:7,ownerAccountId:11,
  operatorId:'c2aca5fa-8df0-4e85-bd4e-825e8b43b4be',
  terminalSessionId:'a8f33b46-a129-4d79-8f31-7442e9a93fa1',
  requestKey:'test-order-attribution-1234567890',quoteHash:'e'.repeat(64),
  confirmationMethod:'staff_passkey',source:'voice'};
const row={order_id:5,business_id:7,session_id:order.terminalSessionId,
  owner_account_id:11,operator_id:order.operatorId,
  session_expires_at:'2026-11-01T00:00:00.000Z',session_revoked:null,
  display_name:'Family operator',role:'order_operator',is_active:true,operator_revoked:null,
  operator_expires_at:null};
const now=new Date('2026-10-31T07:00:00Z');
function db({actor=row,existing=null,duplicate=false}={}){
  let calls=[];
  return{calls,async query(sql,args=[]){calls.push({sql,args});
    if(sql.includes('SELECT o.id order_id'))return{rowCount:actor?1:0,rows:actor?[actor]:[]};
    if(sql.includes('INSERT INTO merchant_team_order_attribution'))return{rowCount:duplicate?0:1,rows:duplicate?[]:[{order_id:5}]};
    if(sql.includes('FROM merchant_team_order_attribution WHERE'))return{rowCount:existing?1:0,rows:existing?[existing]:[]};
    throw new Error('Unexpected '+sql.slice(0,70));
  }};
}
test('same-owner Merchant operator is attributed with immutable order link',async()=>{
  const client=db();const value=await recordStaffOrderAttribution(client,order,{now});
  assert.deepEqual(value,{order_id:5,operator_id:order.operatorId,created:true});
  assert.match(client.calls[0].sql,/FOR SHARE OF o,s,p,bm,a,pr/);
  assert.match(client.calls[0].sql,/JOIN business_memberships/);
  assert.match(client.calls[1].sql,/ON CONFLICT\(order_id\) DO NOTHING/);
  assert.equal(client.calls[1].args[2],11);
  assert.equal(client.calls[1].args[3],order.operatorId);
  assert.equal(client.calls[1].args[4],'Family operator');
  assert.match(client.calls[1].args[8],/^[a-f0-9]{64}$/);
});
test('employee session revocation/disable/expiry blocks attribution',async()=>{
  for(const actor of [{...row,session_revoked:new Date()},{...row,is_active:false},
    {...row,role:'stock_helper'},{...row,session_expires_at:'2026-10-31T06:00:00Z'},
    {...row,operator_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'},null]){
    await assert.rejects(recordStaffOrderAttribution(db({actor}),order,{now}),e=>e.status===403);
  }
});
test('untrusted data cannot alter business, operator, session, quote, method or request identity',async()=>{
  for(const modified of [{businessId:0},{ownerAccountId:-1},{operatorId:'staff'},
    {terminalSessionId:'expired'},{quoteHash:'9'},{requestKey:'abc'},
    {confirmationMethod:'paid'},{source:'refund'}])
    assert.throws(()=>validateStaffOrderAttribution({...order,...modified}),e=>e.status===400);
  await assert.rejects(recordStaffOrderAttribution({connect:()=>null,query:()=>{}},order,{now}),e=>e.status===500);
});
test('same exact retry is idempotent, but changing operator or quote is forbidden',async()=>{
  const fresh=db();await recordStaffOrderAttribution(fresh,order,{now});
  const savedArgs=fresh.calls[1].args;
  const prior={business_id:7,owner_account_id:11,operator_id:order.operatorId,
    terminal_session_id:order.terminalSessionId,confirmation_method:'staff_passkey',
    order_source:'voice',request_key_hash:savedArgs[8],quote_hash:order.quoteHash};
  const repeat=await recordStaffOrderAttribution(db({existing:prior,duplicate:true}),order,{now});
  assert.equal(repeat.created,false);
  await assert.rejects(recordStaffOrderAttribution(db({existing:{...prior,quote_hash:'a'.repeat(64)},duplicate:true}),order,{now}),e=>e.status===409);
  await assert.rejects(recordStaffOrderAttribution(db({existing:{...prior,operator_id:'other'},duplicate:true}),order,{now}),e=>e.status===409);
});
test('schema is additive and retains recorded human context after soft revocation',async()=>{
  const queries=[],conn={async query(sql){queries.push(sql)}};
  await ensureMerchantTeamOrderAttributionSchema(conn);
  assert.match(queries[0],/order_id BIGINT PRIMARY KEY/);
  assert.match(queries[0],/operator_name_snapshot/);
  assert.match(queries[0],/UNIQUE\(business_id,request_key_hash\)/);
  assert.match(queries[0],/ON DELETE SET NULL/);
});
test('cannot call a new staff create route until explicitly reviewed and enabled',()=>{
  const runtime=readFileSync(new URL('../merchant-team-terminal-routes.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/app\.post\('\/api\/orders\/operator\/order\/confirm/);
});