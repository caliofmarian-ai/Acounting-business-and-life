import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  AUTH_SESSION_TTL_MS,AUTH_STEP_UP_TTL_MS,createV2Session,isLegacyBearerToken,markV2SessionStepUp,
  resolveV2SessionStepUp,resolveV2SessionToken,signV2SessionToken
} from '../auth-session-core.js';

const SECRET='test-secret';
const ISSUED=1_700_000_000_000;
const SESSION='session-123';

function poolFor({active=true,stepUpAt=null}={}){
  return{
    calls:[],
    async query(sql,args){
      this.calls.push({sql,args});
      if(sql.includes('SELECT account_id FROM account_sessions'))return{rowCount:active?1:0,rows:active?[{account_id:7}]:[]};
      if(sql.includes('SELECT step_up_verified_at'))return{rowCount:active?1:0,rows:active?[{step_up_verified_at:stepUpAt}]:[]};
      if(sql.includes('UPDATE account_sessions')&&sql.includes('RETURNING step_up_verified_at'))return{rowCount:active?1:0,rows:active?[{step_up_verified_at:stepUpAt||new Date(ISSUED).toISOString()}]:[]};
      return{rowCount:1,rows:[]};
    }
  };
}

test('shared V2 token signs and resolves one active database session',async()=>{
  const pool=poolFor();
  const token=signV2SessionToken(SECRET,7,SESSION,{issued:ISSUED});
  const resolved=await resolveV2SessionToken(pool,SECRET,token,{now:ISSUED+1000});
  assert.deepEqual(resolved,{accountId:7,sessionId:SESSION,issued:ISSUED,legacy:false});
  assert.equal(pool.calls.length,1);
  assert.deepEqual(pool.calls[0].args,[SESSION,7]);
});

test('shared V2 resolver rejects altered, expired, future and revoked tokens',async()=>{
  const good=signV2SessionToken(SECRET,7,SESSION,{issued:ISSUED});
  const altered=good.slice(0,-1)+(good.endsWith('a')?'b':'a');
  assert.equal(await resolveV2SessionToken(poolFor(),SECRET,altered,{now:ISSUED+1000}),null);
  assert.equal(await resolveV2SessionToken(poolFor(),SECRET,good,{now:ISSUED+AUTH_SESSION_TTL_MS+1}),null);
  assert.equal(await resolveV2SessionToken(poolFor(),SECRET,good,{now:ISSUED-60_001}),null);
  assert.equal(await resolveV2SessionToken(poolFor({active:false}),SECRET,good,{now:ISSUED+1000}),null);
});

test('session creation persists metadata and returns a canonical V2 token',async()=>{
  const pool=poolFor();
  const result=await createV2Session(pool,SECRET,7,{sessionId:SESSION,issued:ISSUED,userAgent:'Android QA',ipHash:'hash'});
  assert.equal(result.sessionId,SESSION);
  assert.match(result.token,/^v2\./);
  assert.deepEqual(pool.calls[0].args,[SESSION,7,'Android QA','hash',false]);
  const resolved=await resolveV2SessionToken(pool,SECRET,result.token,{now:ISSUED+1000});
  assert.equal(resolved.accountId,7);
});

test('fresh step-up state is session-scoped and expires after the configured window',async()=>{
  const now=ISSUED+120_000;
  const freshAt=new Date(now-60_000).toISOString();
  const fresh=await resolveV2SessionStepUp(
    poolFor({stepUpAt:freshAt}),SECRET,signV2SessionToken(SECRET,7,SESSION,{issued:ISSUED}),{now}
  );
  assert.equal(fresh.stepUpValid,true);
  assert.equal(fresh.stepUpVerifiedAt,freshAt);
  const staleAt=new Date(now-AUTH_STEP_UP_TTL_MS-1).toISOString();
  const stale=await resolveV2SessionStepUp(
    poolFor({stepUpAt:staleAt}),SECRET,signV2SessionToken(SECRET,7,SESSION,{issued:ISSUED}),{now}
  );
  assert.equal(stale.stepUpValid,false);
});

test('step-up can be marked only on the current active session',async()=>{
  const verifiedAt=new Date(ISSUED).toISOString();
  const pool=poolFor({stepUpAt:verifiedAt});
  const result=await markV2SessionStepUp(pool,{accountId:7,sessionId:SESSION});
  assert.equal(result,verifiedAt);
  assert.deepEqual(pool.calls[0].args,[SESSION,7]);
});

test('fresh login can mark the newly created session as step-up verified',async()=>{
  const pool=poolFor();
  await createV2Session(pool,SECRET,7,{sessionId:SESSION,issued:ISSUED,userAgent:'Android QA',ipHash:'hash',stepUpVerified:true});
  assert.equal(pool.calls[0].args[4],true);
  assert.match(pool.calls[0].sql,/step_up_verified_at/);
  assert.match(pool.calls[0].sql,/CASE WHEN \$5 THEN NOW\(\) END/);
});

test('legacy bearer detection is explicit and cannot confuse V2 sessions',()=>{
  assert.equal(isLegacyBearerToken('1.random.signature'),true);
  assert.equal(isLegacyBearerToken('v2.1.7.session.signature'),false);
  assert.equal(isLegacyBearerToken(''),false);
});

test('account server keeps legacy compatibility while hardening keeps public legacy rejection',()=>{
  const auth=readFileSync(new URL('../server-auth.js',import.meta.url),'utf8');
  const hardening=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');
  assert.match(auth,/function legacyTokenAccount\(token = ''\)/);
  assert.match(auth,/resolveV2SessionToken\(pool,TOKEN_SECRET,token/);
  assert.match(hardening,/isLegacyBearerToken\(raw\)/);
  assert.match(hardening,/Legacy PIN session expired\. Sign in with your email account\./);
  assert.match(hardening,/resolveV2SessionToken\(pool,TOKEN_SECRET,token\)/);
  assert.doesNotMatch(hardening,/async function resolveV2\(/);
  assert.doesNotMatch(hardening,/function signAccountToken\(/);
});
