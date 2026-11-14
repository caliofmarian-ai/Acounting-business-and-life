/** #863 disposable PG16 staff-only terminal, NEVER use on Preview/Production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {signV2SessionToken} from '../auth-session-core.js';
import {ensureMerchantTeamSchema,addTeamOperator,stopTeamOperator} from '../merchant-team-operators.js';
import {
 ensureMerchantTeamTerminalSchema,issueMerchantTeamPairing,listPairingOperators,
 activateMerchantTeamTerminal,resolveMerchantTeamTerminal,endMerchantTeamTerminal,
 terminalCsrf,verifyTerminalCsrf
} from '../merchant-team-terminal-core.js';
const enabled=process.env.VOICE_ORDER_TEST_ISOLATED==='1'&&/\/abl_voice_ci$/.test(process.env.VOICE_ORDER_TEST_DB_URL||'');
const secret='CI-terminal-owner-independent-staff-key-at-least-24',pepper='CI-terminal-private-PIN-pepper-at-least-24';
const tokenSecret='CI-terminal-main-account-token-secret-at-least-24';

test('PostgreSQL: two staff use one Merchant without owner session; pairing cannot repeat; revocation is immediate',
 {skip:!enabled},async()=>{
 const db=new pg.Pool({connectionString:process.env.VOICE_ORDER_TEST_DB_URL,max:6});
 try{
  await db.query(`CREATE TABLE IF NOT EXISTS accounts(id BIGINT PRIMARY KEY);
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_status TEXT NOT NULL DEFAULT 'active';
    CREATE TABLE IF NOT EXISTS businesses(id BIGINT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS profiles(account_id BIGINT NOT NULL REFERENCES accounts(id),role TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(account_id,role));
    CREATE TABLE IF NOT EXISTS business_memberships(business_id BIGINT NOT NULL REFERENCES businesses(id),account_id BIGINT NOT NULL REFERENCES accounts(id),active BOOLEAN NOT NULL DEFAULT TRUE,membership_role TEXT NOT NULL,PRIMARY KEY(business_id,account_id));
    CREATE TABLE IF NOT EXISTS account_sessions(session_id TEXT PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES accounts(id),revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,step_up_verified_at TIMESTAMPTZ);`);
  await db.query(`INSERT INTO accounts(id,auth_status) VALUES (331,'active') ON CONFLICT(id) DO NOTHING;
    INSERT INTO businesses(id) VALUES(881),(882) ON CONFLICT DO NOTHING;
    INSERT INTO profiles(account_id,role,enabled) VALUES(331,'merchant',TRUE) ON CONFLICT DO NOTHING;
    INSERT INTO business_memberships(business_id,account_id,membership_role,active)
      VALUES(881,331,'owner',TRUE),(882,331,'owner',TRUE) ON CONFLICT DO NOTHING;
    INSERT INTO account_sessions(session_id,account_id,expires_at,step_up_verified_at)
      VALUES('merchant-terminal-owner-ci',331,NOW()+INTERVAL '1 hour',NOW()) ON CONFLICT DO NOTHING;`);
  await ensureMerchantTeamSchema(db);await ensureMerchantTeamTerminalSchema(db);
  const ownerBearer=signV2SessionToken(tokenSecret,331,'merchant-terminal-owner-ci');
  const base={businessId:881,accountId:331,token:ownerBearer,tokenSecret,pepper,secret};
  const mother=await addTeamOperator(db,{...base,input:{name:'Mother',role:'order_operator',pin:'753921'}});
  const replacement=await addTeamOperator(db,{...base,input:{name:'Temporary helper',role:'temporary',pin:'649253',expiresAt:new Date(Date.now()+3600_000).toISOString()}});
  assert.notEqual(mother.id,replacement.id);
  const pair1=await issueMerchantTeamPairing(db,base),pair2=await issueMerchantTeamPairing(db,base);
  assert.notEqual(pair1.pair_code,pair2.pair_code);
  const options=await listPairingOperators(db,{code:pair1.pair_code,secret});
  assert.deepEqual(options.operators.map(o=>o.name),['Mother','Temporary helper']);
  await assert.rejects(activateMerchantTeamTerminal(db,{code:pair1.pair_code,operatorId:mother.id,pin:'999888',secret,pepper}),e=>e.code==='OPERATOR_PIN_REJECTED');
  const attempt=await db.query(`SELECT attempt_count FROM merchant_team_terminal_pairs WHERE pair_digest=$1`,
    [((await db.query('SELECT pair_digest FROM merchant_team_terminal_pairs ORDER BY issued_at,id LIMIT 1')).rows[0]).pair_digest]);
  assert.ok(attempt.rows.length>=1);
  const s1=await activateMerchantTeamTerminal(db,{code:pair1.pair_code,operatorId:mother.id,pin:'753921',secret,pepper});
  const s2=await activateMerchantTeamTerminal(db,{code:pair2.pair_code,operatorId:replacement.id,pin:'649253',secret,pepper});
  assert.notEqual(s1.token,s2.token);assert.notEqual(s1.operator_id,s2.operator_id);
  assert.equal((await resolveMerchantTeamTerminal(db,{token:s1.token,secret})).business_id,881);
  assert.equal((await resolveMerchantTeamTerminal(db,{token:s2.token,secret})).role,'temporary');
  assert.equal(verifyTerminalCsrf(secret,s1.token,terminalCsrf(secret,s1.token)),true);
  assert.equal(verifyTerminalCsrf(secret,s2.token,terminalCsrf(secret,s1.token)),false);
  await assert.rejects(resolveMerchantTeamTerminal(db,{token:s1.token,secret,permission:'money.write'}),e=>e.code==='OPERATOR_PERMISSION_DENIED');
  await assert.rejects(activateMerchantTeamTerminal(db,{code:pair1.pair_code,operatorId:mother.id,pin:'753921',secret,pepper}),e=>e.code==='OPERATOR_PAIR_INVALID');
  await stopTeamOperator(db,{...base,operatorId:mother.id});
  await assert.rejects(resolveMerchantTeamTerminal(db,{token:s1.token,secret}),e=>e.code==='OPERATOR_SESSION_REQUIRED');
  assert.equal((await resolveMerchantTeamTerminal(db,{token:s2.token,secret})).operator_id,replacement.id);
  assert.deepEqual(await endMerchantTeamTerminal(db,{token:s2.token,secret}),{ended:true});
  await assert.rejects(resolveMerchantTeamTerminal(db,{token:s2.token,secret}),e=>e.code==='OPERATOR_SESSION_REQUIRED');
  const audit=await db.query(`SELECT event_code FROM merchant_team_events WHERE business_id=881 AND operator_id=$1 ORDER BY id`,[mother.id]);
  assert.ok(audit.rows.some(x=>x.event_code==='terminal.paired'));
  assert.ok(audit.rows.some(x=>x.event_code==='operator.disabled'));
 }finally{await db.end()}
});