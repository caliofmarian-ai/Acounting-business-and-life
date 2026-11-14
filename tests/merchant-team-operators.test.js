import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {signV2SessionToken} from '../auth-session-core.js';
import {
 merchantTeamPermissions,validateOperatorInput,hashOperatorPin,verifyOperatorPin,
 teamSessionBinding,assertMerchantTeamOwner,beginTeamShift,resolveTeamShift,
 listTeamOperators,stopTeamOperator,addTeamOperator
} from '../merchant-team-operators.js';
const pepper='test-operator-pin-pepper-with-minimum-length';
const secret='test-team-private-token-secret-very-long';
const ownerSecret='test-account-token-secret-very-long';
const accountId=31,businessId=8;
const operatorId='2109c7e0-f94e-491c-9801-41bc079c27b9';
const now=new Date('2026-10-31T08:00:00.000Z');
const token=signV2SessionToken(ownerSecret,accountId,'session-for-main-account',{issued:now.getTime()-1000});
function record(overrides={}){return{id:operatorId,business_id:8,owner_account_id:31,display_name:'Mother',role:'order_operator',is_active:true,
  expires_at:null,revoked_at:null,pin_salt:'a'.repeat(48),pin_hash:'b'.repeat(128),...overrides}}
const rows=arr=>({rows:arr,rowCount:arr.length});
function dbMock(onQuery){const calls=[];const db={calls,async connect(){return{async query(sql,args){calls.push({sql:String(sql).replace(/\s+/g,' ').trim(),args});return onQuery(sql,args)},release(){calls.push({sql:'release'})}}},
  async query(sql,args){calls.push({sql:String(sql).replace(/\s+/g,' ').trim(),args});return onQuery(sql,args)}};return db;}
test('operator permissions never allow money, refunds, stock mutation or staff administration',()=>{
  assert.deepEqual(merchantTeamPermissions('order_operator'),['orders.voice_draft','orders.read']);
  assert.deepEqual(merchantTeamPermissions('stock_helper'),['stock.read']);
  for(const role of ['manager','order_operator','temporary','stock_helper'])
    assert.equal(merchantTeamPermissions(role).some(p=>p.includes('money')||p.includes('payment')||p.includes('refund')||p.includes('write')||p.includes('manage')),false);
});
test('validate temporary assignment, names, PIN length and role fail closed',()=>{
  assert.deepEqual(validateOperatorInput({name:'  Mother   Helper ',role:'temporary',pin:'472908',expiresAt:'2026-11-01T01:00:00Z'},now).name,'Mother Helper');
  for(const pin of ['123','12345678901','aaaaaa','000000',123456,'!12345'])assert.throws(()=>validateOperatorInput({name:'Mother',role:'order_operator',pin},now));
  assert.throws(()=>validateOperatorInput({name:'Mother',role:'super_admin',pin:'472908'},now));
  assert.throws(()=>validateOperatorInput({name:'Mother',role:'temporary',pin:'472908',expiresAt:'2026-10-31'},now));
});
test('PIN is memory-hard salted + peppered and does not persist plaintext',async()=>{
  const first=await hashOperatorPin('483921',{pepper}),second=await hashOperatorPin('483921',{pepper});
  assert.notEqual(first.salt,second.salt);assert.notEqual(first.hash,second.hash);
  assert.equal(await verifyOperatorPin('483921',{pin_salt:first.salt,pin_hash:first.hash},{pepper}),true);
  assert.equal(await verifyOperatorPin('483922',{pin_salt:first.salt,pin_hash:first.hash},{pepper}),false);
  assert.equal(await verifyOperatorPin('x',{pin_salt:first.salt,pin_hash:first.hash},{pepper}),false);
  assert.equal(first.hash.includes('483921'),false);
});
test('a shift is bound to the main owner account session and specific business',()=>{
  const key=teamSessionBinding({token,accountId,businessId,secret});
  assert.equal(key.length,48);
  assert.notEqual(key,teamSessionBinding({token,accountId,businessId:9,secret}));
  assert.notEqual(key,teamSessionBinding({token:'different-account-session-token-ABC',accountId,businessId,secret}));
  assert.throws(()=>teamSessionBinding({token:'',accountId,businessId,secret}),/Sign in/);
});
test('owner step-up requires active owner membership and fresh V2 account credential',async()=>{
  const db=dbMock((sql,args)=>rows(String(sql).includes('JOIN business_memberships')?[{step_up_verified_at:now.toISOString()}]:[]));
  assert.equal(await assertMerchantTeamOwner({query:db.query.bind(db)},{accountId,businessId,token,tokenSecret:ownerSecret,now}),true);
  assert.ok(db.calls.some(c=>c.sql.includes("membership_role='owner'")));
  await assert.rejects(assertMerchantTeamOwner({query:()=>rows([])},{accountId,businessId,token,tokenSecret:ownerSecret,now}),e=>e.status===403);
  await assert.rejects(assertMerchantTeamOwner({query:()=>rows([{step_up_verified_at:'2026-10-30T00:00:00Z'}])},{accountId,businessId,token,tokenSecret:ownerSecret,now}),e=>e.status===428);
  await assert.rejects(assertMerchantTeamOwner({query:()=>rows([])},{accountId,businessId,token:'not-real',tokenSecret:ownerSecret,now}),e=>e.status===428);
});
test('operator listing never leaks PIN or session keys',async()=>{
  const db={async query(){return rows([record({pin_hash:'secret-hash',pin_salt:'secret-salt'})])}};
  const list=await listTeamOperators(db,{businessId,accountId});
  assert.deepEqual(list.map(x=>[x.name,x.role,x.active]),[['Mother','order_operator',true]]);
  assert.doesNotMatch(JSON.stringify(list),/secret-hash|secret-salt|token_digest/);
});
test('revoking one worker ends that worker shifts without deleting historical events',async()=>{
  const db=dbMock((sql,args)=>{
    if(String(sql).includes('step_up_verified_at'))return rows([{step_up_verified_at:now.toISOString()}]);
    if(String(sql).includes('RETURNING id'))return rows([{id:operatorId}]);
    return rows([]);
  });
  const out=await stopTeamOperator(db,{businessId,accountId,operatorId,token,tokenSecret:ownerSecret,now});
  assert.equal(out.disabled,true);
  assert.ok(db.calls.some(x=>x.sql.includes('UPDATE merchant_team_shifts SET ended_at')));
  assert.ok(db.calls.some(x=>x.sql.includes("'operator.disabled'")));
  assert.equal(db.calls.some(x=>x.sql.includes('DELETE FROM merchant_team_operators')),false);
});
test('start-shift on a second device never reuses a first shift token',async()=>{
  const hash=await hashOperatorPin('481920',{pepper});
  const db=dbMock((sql,args)=>{
    const s=String(sql);
    if(s.includes('FROM merchant_team_operators'))return rows([record({...{pin_salt:hash.salt,pin_hash:hash.hash}})]);
    if(s.includes('RETURNING attempt_count'))return rows([{attempt_count:1}]);
    return rows([]);
  });
  const ctx={businessId,accountId,operatorId,pin:'481920',sessionBinding:'x'.repeat(48),secret,pepper,now};
  const a=await beginTeamShift(db,ctx),b=await beginTeamShift(db,ctx);
  assert.notEqual(a.token,b.token);assert.notEqual(a.shift_id,b.shift_id);
  assert.equal(a.role,'order_operator');assert.ok(db.calls.some(x=>x.sql.includes('INSERT INTO merchant_team_shifts')));
});
test('incorrect PIN persists failed attempt even when rejected',async()=>{
  const hash=await hashOperatorPin('481920',{pepper});
  const db=dbMock((sql,args)=>{
    const s=String(sql);
    if(s.includes('FROM merchant_team_operators'))return rows([record({pin_salt:hash.salt,pin_hash:hash.hash})]);
    if(s.includes('RETURNING attempt_count'))return rows([{attempt_count:4}]);
    return rows([]);
  });
  await assert.rejects(beginTeamShift(db,{businessId,accountId,operatorId,pin:'483920',sessionBinding:'x'.repeat(48),secret,pepper,now}),e=>e.code==='TEAM_PIN_REJECTED');
  assert.ok(db.calls.some(c=>c.sql==='COMMIT'));
  assert.equal(db.calls.filter(c=>c.sql.includes('INSERT INTO merchant_team_shifts')).length,0);
});
test('sixth attempt fails before PIN verification and commits rate counter',async()=>{
  const db=dbMock(sql=>{
    if(String(sql).includes('FROM merchant_team_operators'))return rows([record()]);
    if(String(sql).includes('RETURNING attempt_count'))return rows([{attempt_count:6}]);
    return rows([]);
  });
  await assert.rejects(beginTeamShift(db,{businessId,accountId,operatorId,pin:'481920',sessionBinding:'x'.repeat(48),secret,pepper,now}),e=>e.code==='TEAM_PIN_LOCKED'&&e.status===429);
  assert.ok(db.calls.some(c=>c.sql==='COMMIT'));assert.equal(db.calls.some(c=>c.sql.includes('INSERT INTO merchant_team_shifts')),false);
});
test('active shift enforces same business, same account session, permissions and revocation',async()=>{
  const shiftId='8a1ced7e-711f-481d-a2a9-477344b43762';
  const make=over=>({shift_id:shiftId,operator_id:operatorId,display_name:'Mother',role:'order_operator',is_active:true,
    revoked_at:null,ended_at:null,shift_expires_at:'2026-10-31T12:00:00.000Z',operator_expires_at:null,...over});
  const ctx={businessId,accountId,sessionBinding:'x'.repeat(48),secret,token:'Q'.repeat(48),now};
  const db={query:async()=>rows([make()])};
  const operator=await resolveTeamShift(db,ctx);
  assert.equal(operator.operator_id,operatorId);assert.equal(operator.business_id,businessId);
  await assert.rejects(resolveTeamShift(db,{...ctx,requiredPermission:'payments.write'}),e=>e.code==='TEAM_PERMISSION_DENIED');
  await assert.rejects(resolveTeamShift({query:async()=>rows([make({ended_at:now})])},ctx),e=>e.code==='TEAM_SHIFT_REQUIRED');
  await assert.rejects(resolveTeamShift({query:async()=>rows([make({is_active:false})])},ctx),e=>e.code==='TEAM_SHIFT_REQUIRED');
  await assert.rejects(resolveTeamShift({query:async()=>rows([make({operator_expires_at:'2026-10-30'})])},ctx),e=>e.code==='TEAM_SHIFT_REQUIRED');
});
test('owner can add a temporary helper without creating any business/account/profile',async()=>{
  const db=dbMock(sql=>{
    const s=String(sql);
    if(s.includes('JOIN business_memberships'))return rows([{step_up_verified_at:now.toISOString()}]);
    if(s.includes('COUNT(*)'))return rows([{count:3}]);
    return rows([]);
  });
  const added=await addTeamOperator(db,{businessId,accountId,token,tokenSecret:ownerSecret,
    pepper,secret,now,input:{name:'Replacement',role:'temporary',pin:'907314',expiresAt:'2026-11-01T08:00:00Z'}});
  assert.equal(added.role,'temporary');assert.ok(db.calls.some(x=>x.sql.includes('INSERT INTO merchant_team_operators')));
  assert.equal(db.calls.some(x=>/INSERT INTO (accounts|businesses|profiles|profile_business_bindings)/i.test(x.sql)),false);
});
