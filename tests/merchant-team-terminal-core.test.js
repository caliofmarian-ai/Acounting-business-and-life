import test from 'node:test';
import assert from 'node:assert/strict';
import {signV2SessionToken} from '../auth-session-core.js';
import {hashOperatorPin} from '../merchant-team-operators.js';
import {
 TERMINAL_COOKIE,terminalCookieValue,forbidOwnerSession,terminalCsrf,verifyTerminalCsrf,
 terminalSessionBinding,issueMerchantTeamPairing,listPairingOperators,
 activateMerchantTeamTerminal,resolveMerchantTeamTerminal,endMerchantTeamTerminal
} from '../merchant-team-terminal-core.js';

const SECRET='terminal-unique-secret-32chars-minimum-long',PEPPER='operator-pin-pepper-must-not-leak-to-client';
const TOKEN_SECRET='owner-token-signing-secret-minimum-long-enough';
const at=new Date('2026-10-31T10:30:00Z');
const ownerToken=signV2SessionToken(TOKEN_SECRET,8,'root-owner-session-1',{issued:at.getTime()-1000});
const operatorId='12ada236-d4ae-4d4f-8410-c2f2b7cbacfa';
const rows=x=>({rows:x,rowCount:x.length});
const fixture=async()=>{
 const hash=await hashOperatorPin('483921',{pepper:PEPPER});
 const state={pair:null,session:null,operator:{id:operatorId,display_name:'Mother',role:'order_operator',is_active:true,
  expires_at:null,revoked_at:null,pin_salt:hash.salt,pin_hash:hash.hash},disabled:false,attempts:0,commits:0,rollbacks:0,events:[]};
 const query=async(sql,args=[])=>{
  const q=String(sql).replace(/\s+/g,' ').trim();
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'){
    if(q==='COMMIT')state.commits++;if(q==='ROLLBACK')state.rollbacks++;return rows([]);
  }
  if(q.includes('JOIN business_memberships bm')&&q.includes('FROM account_sessions'))return rows([{step_up_verified_at:at.toISOString()}]);
  if(q.startsWith('SELECT COUNT(*)::int count FROM merchant_team_terminal_pairs'))return rows([{count:0}]);
  if(q.startsWith('INSERT INTO merchant_team_terminal_pairs')){state.pair={id:args[0],business_id:7,owner_account_id:8,pair_digest:args[3],expires_at:args[4],attempt_count:0};return rows([])}
  if(q.startsWith('SELECT business_id,owner_account_id,expires_at,attempt_count,consumed_at,revoked_at'))return rows(state.pair&&state.pair.pair_digest===args[0]?[state.pair]:[]);
  if(q.startsWith('SELECT * FROM merchant_team_terminal_pairs'))return rows(state.pair&&state.pair.pair_digest===args[0]?[state.pair]:[]);
  if(q.includes('FROM accounts a')&&q.includes('JOIN profiles p'))return rows(state.disabled?[]:[{id:8}]);
  if(q.startsWith('SELECT id,display_name,role FROM merchant_team_operators'))return rows([state.operator]);
  if(q.startsWith('SELECT * FROM merchant_team_operators'))return rows(args[0]===operatorId?[state.operator]:[]);
  if(q.startsWith('UPDATE merchant_team_terminal_pairs')&&q.includes('attempt_count=')){state.attempts++;state.pair.attempt_count++;return rows([])}
  if(q.startsWith('INSERT INTO merchant_team_terminal_sessions')){state.session={session_id:args[0],business_id:7,owner_account_id:8,operator_id:operatorId,token_digest:args[4],session_expires_at:args[5],role:'order_operator',display_name:'Mother',is_active:true};return rows([])}
  if(q.startsWith('UPDATE merchant_team_terminal_pairs')&&q.includes('consumed_at=')){state.pair.consumed_at=at;return rows([])}
  if(q.startsWith('INSERT INTO merchant_team_events')){state.events.push(args);return rows([])}
  if(q.includes('FROM merchant_team_terminal_sessions s')&&q.includes('JOIN merchant_team_operators o')){
    if(!state.session||state.session.token_digest!==args[0]||state.disabled)return rows([]);
    return rows([{...state.session,session_expires_at:state.session.session_expires_at,
      session_revoked:state.session.session_revoked||null,operator_expires_at:null,operator_revoked:null}]);
  }
  if(q.startsWith('UPDATE merchant_team_terminal_sessions')){state.session.session_revoked=at;return rows([{id:state.session.session_id}])}
  throw new Error('Unexpected SQL: '+q);
 };
 const db={query,async connect(){return{query,release(){}}}};
 return{db,state};
};

test('operator session has independent HttpOnly cookie name and forbids owner cookie on same browser',()=>{
 assert.equal(terminalCookieValue(`${TERMINAL_COOKIE}=abc; ${'__Host-abl_session'}=owner`),'abc');
 assert.throws(()=>forbidOwnerSession('__Host-abl_session=owner; abc=1'),e=>e.code==='OPERATOR_OWNER_SESSION');
 assert.doesNotThrow(()=>forbidOwnerSession('__Host-abl_operator=staff'));
});
test('CSRF and voice draft context bind to different operator token, never account bearer',()=>{
 const a='a'.repeat(48),b='b'.repeat(48);const token=terminalCsrf(SECRET,a);
 assert.match(token,/^[a-f0-9]{64}$/);assert.equal(verifyTerminalCsrf(SECRET,a,token),true);
 assert.equal(verifyTerminalCsrf(SECRET,b,token),false);
 assert.notEqual(terminalSessionBinding(SECRET,a,operatorId,7),terminalSessionBinding(SECRET,b,operatorId,7));
});
test('owner generates one-time 10-minute pairing after account step-up; no other accounts',async()=>{
 const {db,state}=await fixture();const p=await issueMerchantTeamPairing(db,{businessId:7,accountId:8,
  token:ownerToken,tokenSecret:TOKEN_SECRET,secret:SECRET,now:at});
 assert.match(p.pair_code,/^[A-Za-z0-9_-]{30,100}$/);assert.equal(state.pair.pair_digest.includes(p.pair_code),false);
 assert.equal(Date.parse(p.expires_at)-at.getTime(),10*60_000);
 const list=await listPairingOperators(db,{code:p.pair_code,secret:SECRET,now:at});
 assert.deepEqual(list.operators.map(x=>x.name),['Mother']);
});
test('invalid owner session cannot create a pairing link',async()=>{
 const {db}=await fixture();await assert.rejects(issueMerchantTeamPairing(db,{businessId:7,accountId:8,
  token:'invalid',tokenSecret:TOKEN_SECRET,secret:SECRET,now:at}),e=>e.status===428);
});
test('PIN failure is committed but worker account session is not created',async()=>{
 const {db,state}=await fixture();const p=await issueMerchantTeamPairing(db,{businessId:7,accountId:8,token:ownerToken,
  tokenSecret:TOKEN_SECRET,secret:SECRET,now:at});
 await assert.rejects(activateMerchantTeamTerminal(db,{code:p.pair_code,operatorId,pin:'483922',
  secret:SECRET,pepper:PEPPER,now:at}),e=>e.code==='OPERATOR_PIN_REJECTED');
 assert.equal(state.attempts,1);assert.equal(state.session,null);assert.equal(state.pair.consumed_at,undefined);
 assert.equal(state.rollbacks,0);
});
test('real operator PIN yields distinct scoped session; disabled operator revoked live',async()=>{
 const {db,state}=await fixture();const p=await issueMerchantTeamPairing(db,{businessId:7,accountId:8,token:ownerToken,
  tokenSecret:TOKEN_SECRET,secret:SECRET,now:at});
 const login=await activateMerchantTeamTerminal(db,{code:p.pair_code,operatorId,pin:'483921',
  secret:SECRET,pepper:PEPPER,now:at});
 assert.match(login.token,/^[A-Za-z0-9_-]{30,100}$/);assert.equal(state.pair.consumed_at instanceof Date,true);
 const who=await resolveMerchantTeamTerminal(db,{token:login.token,secret:SECRET,now:at});
 assert.equal(who.name,'Mother');assert.equal(who.business_id,7);assert.equal(who.operator_id,operatorId);
 await assert.rejects(resolveMerchantTeamTerminal(db,{token:login.token,secret:SECRET,permission:'payments.write',now:at}),e=>e.code==='OPERATOR_PERMISSION_DENIED');
 state.disabled=true;
 await assert.rejects(resolveMerchantTeamTerminal(db,{token:login.token,secret:SECRET,now:at}),e=>e.status===401);
});
test('no worker can reuse a consumed pairing code, even with valid PIN',async()=>{
 const {db}=await fixture();const p=await issueMerchantTeamPairing(db,{businessId:7,accountId:8,token:ownerToken,
  tokenSecret:TOKEN_SECRET,secret:SECRET,now:at});
 await activateMerchantTeamTerminal(db,{code:p.pair_code,operatorId,pin:'483921',secret:SECRET,pepper:PEPPER,now:at});
 await assert.rejects(activateMerchantTeamTerminal(db,{code:p.pair_code,operatorId,pin:'483921',secret:SECRET,pepper:PEPPER,now:at}),e=>e.code==='OPERATOR_PAIR_INVALID');
});