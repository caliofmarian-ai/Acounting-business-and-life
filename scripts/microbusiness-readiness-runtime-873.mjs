// #873: actual PostgreSQL and authenticated HTTP regression; isolated CI only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {ensureMicrobusinessReadinessSchema} from '../microbusiness-readiness-core.js';

if(process.env.ABL_READINESS_CI!=='1'||process.env.NODE_ENV!=='test'||
   process.env.PGDATABASE!=='abl_admin_ci'||process.env.PGHOST!=='127.0.0.1'||
   process.env.PAYMONGO_MODE!=='sandbox'||!process.env.TOKEN_SECRET){
  throw new Error('Requires disposable localhost CI PostgreSQL; never run against Preview/Production');
}

const pool=new pg.Pool({max:24});
let sessionId=null,oldVerifiedAt=null,verifiedTouched=false,checks=0;
const same=(actual,expected,description)=>{assert.equal(actual,expected,description);checks++};
async function get(path,token){
  const r=await fetch('http://127.0.0.1:3000'+path,{
    signal:AbortSignal.timeout(15000),
    headers:token?{Authorization:'Bearer '+token}:{}
  });
  return{status:r.status,body:await r.json().catch(()=>({}))};
}
try{
  const db=await pool.query('SELECT current_database() AS name');
  same(db.rows[0].name,'abl_admin_ci','dedicated ephemeral database');
  const oldLocks=await pool.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()');
  const before=Number(oldLocks.rows[0].deadlocks);

  // Count real SQL forwarded to the actual PostgreSQL Pool (no fake query result).
  let ddlCalls=0;
  const actualPool={query(sql,...params){
    if(String(sql).includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness ('))ddlCalls++;
    return pool.query(sql,...params);
  }};
  const tasks=Array.from({length:16},()=>ensureMicrobusinessReadinessSchema(actualPool));
  same(new Set(tasks).size,1,'concurrent callers must share the same real SQL task');
  await Promise.all(tasks);
  same(ddlCalls,1,'one DDL submission for sixteen concurrent calls');
  await ensureMicrobusinessReadinessSchema(actualPool);
  same(ddlCalls,1,'successful DDL is not repeated');
  const table=await pool.query("SELECT to_regclass('public.microbusiness_readiness') IS NOT NULL AS exists");
  same(table.rows[0].exists,true,'readiness schema exists in PostgreSQL');

  // Account 1/business 1 exist only in bootstrap CI fixture; never real users.
  const acc=await pool.query('SELECT email_verified_at FROM accounts WHERE id=1');
  same(acc.rowCount,1,'synthetic seeded account required');
  oldVerifiedAt=acc.rows[0].email_verified_at;
  await pool.query('UPDATE accounts SET email_verified_at=NOW() WHERE id=1');
  verifiedTouched=true;
  await pool.query("UPDATE profiles SET enabled=TRUE,status='active' WHERE account_id=1 AND role='merchant'");
  await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES(1,'merchant',1,'active',TRUE) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=TRUE,updated_at=NOW()");
  await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES(1,1,'owner',TRUE) ON CONFLICT(business_id,account_id) DO UPDATE SET active=TRUE");
  await pool.query("INSERT INTO merchant_storefronts(business_id,store_name) VALUES(1,'CI Readiness Store') ON CONFLICT(business_id) DO NOTHING");

  sessionId='ci-readiness-'+crypto.randomBytes(12).toString('hex');
  await pool.query("INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash) VALUES($1,1,NOW()+INTERVAL '30 minutes','ci-readiness-873','synthetic')",[sessionId]);
  const raw=['v2',Date.now(),'1',sessionId].join('.');
  const token=raw+'.'+crypto.createHmac('sha256',process.env.TOKEN_SECRET).update(raw).digest('hex');
  const path='/api/merchant/storefront?business_id=1&include_products=false';
  same((await get(path)).status,401,'private endpoint denies unauthenticated call');
  for(let round=0;round<3;round++){
    const results=await Promise.all(Array.from({length:8},()=>get(path,token)));
    for(const r of results){
      same(r.status,200,'parallel authenticated Merchant GET succeeds (not HTTP 500/deadlock)');
      same(Number(r.body.business_id),1,'no business context crossover');
      same(typeof r.body.readiness,'object','readiness snapshot is still present');
    }
  }
  const after=await pool.query('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()');
  same(Number(after.rows[0].deadlocks),before,'no new deadlocks on real PostgreSQL');
  console.log('#873 actual PostgreSQL 16 + authenticated Merchant HTTP PASS: '+checks+' assertions');
}finally{
  if(sessionId)await pool.query('DELETE FROM account_sessions WHERE session_id=$1',[sessionId]).catch(()=>{});
  if(verifiedTouched)await pool.query('UPDATE accounts SET email_verified_at=$1 WHERE id=1',[oldVerifiedAt]).catch(()=>{});
  await pool.end();
}
