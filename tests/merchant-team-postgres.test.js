/** Real disposable PostgreSQL team security exercise. Explicit opt-in in GitHub CI.
 * NEVER point VOICE_ORDER_TEST_DB_URL at production or Preview data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {signV2SessionToken} from '../auth-session-core.js';
import {
 ensureMerchantTeamSchema,teamSessionBinding,addTeamOperator,listTeamOperators,
 beginTeamShift,resolveTeamShift,stopTeamOperator
} from '../merchant-team-operators.js';
const enabled=process.env.VOICE_ORDER_TEST_ISOLATED==='1'&&/\/abl_voice_ci$/.test(process.env.VOICE_ORDER_TEST_DB_URL||'');
const secret='CI-only-team-session-secret-with-at-least-24-bytes';
const pepper='CI-only-PIN-hash-pepper-with-at-least-24-bytes';
const authSecret='CI-only-account-token-secret-with-at-least-24-bytes';
const now=()=>new Date();
test('disposable Postgres: two people one Merchant; shift scope, concurrent lockout and immediate revocation',{skip:!enabled},async()=>{
 const pool=new pg.Pool({connectionString:process.env.VOICE_ORDER_TEST_DB_URL,max:5});
 try{
   await pool.query(`CREATE TABLE IF NOT EXISTS accounts(id BIGINT PRIMARY KEY);
     CREATE TABLE IF NOT EXISTS businesses(id BIGINT PRIMARY KEY);
     CREATE TABLE IF NOT EXISTS business_memberships(business_id BIGINT NOT NULL REFERENCES businesses(id),
       account_id BIGINT NOT NULL REFERENCES accounts(id),active BOOLEAN NOT NULL DEFAULT TRUE,
       membership_role TEXT NOT NULL,PRIMARY KEY(business_id,account_id));
     CREATE TABLE IF NOT EXISTS account_sessions(session_id TEXT PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES accounts(id),
       revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,step_up_verified_at TIMESTAMPTZ);`);
   await pool.query(`INSERT INTO accounts(id) VALUES(31),(32) ON CONFLICT DO NOTHING;
     INSERT INTO businesses(id) VALUES(8),(9) ON CONFLICT DO NOTHING;
     INSERT INTO business_memberships(business_id,account_id,active,membership_role)
     VALUES(8,31,TRUE,'owner'),(9,31,TRUE,'owner'),(8,32,TRUE,'staff') ON CONFLICT DO NOTHING;
     INSERT INTO account_sessions(session_id,account_id,expires_at,step_up_verified_at)
     VALUES('team-owner-session-ci',31,NOW()+INTERVAL '1 hour',NOW()) ON CONFLICT DO NOTHING;`);
   await ensureMerchantTeamSchema(pool);
   const accountId=31,businessId=8;
   const bearer=signV2SessionToken(authSecret,accountId,'team-owner-session-ci');
   const sessionBinding=teamSessionBinding({token:bearer,accountId,businessId,secret});
   const params={businessId,accountId,token:bearer,tokenSecret:authSecret,pepper,secret,now:now()};
   const a=await addTeamOperator(pool,{...params,input:{name:'Family helper',role:'order_operator',pin:'598234'}});
   const b=await addTeamOperator(pool,{...params,input:{name:'Temporary worker',role:'temporary',pin:'647210',expiresAt:new Date(Date.now()+3600_000).toISOString()}});
   assert.notEqual(a.id,b.id);
   const roster=await listTeamOperators(pool,{businessId,accountId});
   assert.deepEqual(roster.map(x=>x.name),['Family helper','Temporary worker']);
   assert.equal(JSON.stringify(roster).includes('pin_hash'),false);
   const aa=await beginTeamShift(pool,{businessId,accountId,operatorId:a.id,pin:'598234',sessionBinding,secret,pepper});
   const bb=await beginTeamShift(pool,{businessId,accountId,operatorId:b.id,pin:'647210',sessionBinding,secret,pepper});
   assert.notEqual(aa.shift_id,bb.shift_id);assert.notEqual(aa.token,bb.token);
   for(const [staff,token] of [[a,aa.token],[b,bb.token]]){
     const state=await resolveTeamShift(pool,{businessId,accountId,sessionBinding,secret,token});
     assert.equal(state.operator_id,staff.id);
   }
   await assert.rejects(resolveTeamShift(pool,{businessId:9,accountId,sessionBinding,secret,token:aa.token}),e=>e.code==='TEAM_SHIFT_REQUIRED');
   await assert.rejects(resolveTeamShift(pool,{businessId,accountId:32,sessionBinding,secret,token:aa.token}),e=>e.code==='TEAM_SHIFT_REQUIRED');
   await assert.rejects(resolveTeamShift(pool,{businessId,accountId,sessionBinding:'y'.repeat(48),secret,token:aa.token}),e=>e.code==='TEAM_SHIFT_REQUIRED');
   await assert.rejects(resolveTeamShift(pool,{businessId,accountId,sessionBinding,secret,token:aa.token,requiredPermission:'payments.write'}),e=>e.code==='TEAM_PERMISSION_DENIED');
   // A wrong PIN counts toward throttling across concurrent HTTP workers; correct one cannot bypass lockout.
   const attempts=await Promise.allSettled(Array.from({length:6},()=>beginTeamShift(pool,{businessId,accountId,operatorId:b.id,pin:'111999',sessionBinding,secret,pepper})));
   assert.equal(attempts.filter(x=>x.status==='rejected').length,6);
   assert.equal(attempts.some(x=>x.reason?.code==='TEAM_PIN_LOCKED'),true);
   await assert.rejects(beginTeamShift(pool,{businessId,accountId,operatorId:b.id,pin:'647210',sessionBinding,secret,pepper}),e=>e.code==='TEAM_PIN_LOCKED');
   // Revocation stops future access on one business only; existing history is preserved.
   await stopTeamOperator(pool,{businessId,accountId,operatorId:a.id,token:bearer,tokenSecret:authSecret});
   await assert.rejects(resolveTeamShift(pool,{businessId,accountId,sessionBinding,secret,token:aa.token}),e=>e.code==='TEAM_SHIFT_REQUIRED');
   const audit=await pool.query(`SELECT event_code FROM merchant_team_events WHERE operator_id=$1 ORDER BY id`,[a.id]);
   assert.deepEqual(audit.rows.map(x=>x.event_code),['operator.added','shift.started','operator.disabled']);
   // Same owner may still separately bind an operator to a different legitimate business.
   assert.equal((await listTeamOperators(pool,{businessId:9,accountId})).length,0);
 }finally{await pool.end()}
});
