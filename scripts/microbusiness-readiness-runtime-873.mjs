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


  // Verify first-time schema DDL with two truly independent PostgreSQL
  // Pools, not just the single-Pool WeakMap gate. All databases are disposable.
  const ciDbName='abl_readiness_lock_ci';
  const maintenance=new pg.Pool({database:'postgres',max:2});
  let bootstrap=null,recoveryPool=null,lockPool=null,poolA=null,poolB=null,lockClient=null;
  let lockHeld=false,created=false,settledTasks=null;
  try{
    await maintenance.query('CREATE DATABASE '+ciDbName);
    created=true;
    bootstrap=new pg.Pool({database:ciDbName,max:1});
    await bootstrap.query('CREATE TABLE accounts(id BIGINT PRIMARY KEY); CREATE VIEW businesses AS SELECT 1::bigint AS id');
    await bootstrap.end();
    bootstrap=null;

    // Deliberately fail at the LAST schema step: a view named businesses
    // cannot be the target of the FK in the DO block. Every earlier table,
    // index and column change must roll back atomically in PostgreSQL, not
    // leave a half-created schema that a later Merchant request could use.
    recoveryPool=new pg.Pool({database:ciDbName,max:1});
    let expectedLateFailure=false;
    try{
      await ensureMicrobusinessReadinessSchema(recoveryPool);
    }catch(error){
      if(error?.code!=='42809')throw error;
      expectedLateFailure=true;
    }
    same(expectedLateFailure,true,'invalid FK target rejects the late DDL step');
    const rolledBack=await recoveryPool.query(`SELECT
      to_regclass('public.microbusiness_readiness') AS readiness,
      to_regclass('public.microbusiness_readiness_events') AS events`);
    same(rolledBack.rows[0].readiness,null,'late DDL failure rolls back readiness table and indexes');
    same(rolledBack.rows[0].events,null,'late DDL failure rolls back events table and indexes');

    // Reuse the exact same Pool to prove a rejected WeakMap promise is evicted
    // and the corrected schema can be initialized without a process restart.
    await recoveryPool.query('DROP VIEW businesses; CREATE TABLE businesses(id BIGINT PRIMARY KEY)');
    await ensureMicrobusinessReadinessSchema(recoveryPool);
    const recovered=await recoveryPool.query(`SELECT count(*)::int AS fks
      FROM pg_constraint WHERE conname='microbusiness_readiness_business_fk'
      AND conrelid='microbusiness_readiness'::regclass`);
    same(Number(recovered.rows[0].fks),1,'same-Pool retry creates the proper FK after failure');
    await recoveryPool.query('DROP TABLE microbusiness_readiness_events; DROP TABLE microbusiness_readiness');
    await recoveryPool.end();
    recoveryPool=null;

    // Now verify a genuinely COLD initialization in two separate Pools.
    lockPool=new pg.Pool({database:ciDbName,max:1});
    poolA=new pg.Pool({database:ciDbName,max:1});
    poolB=new pg.Pool({database:ciDbName,max:1});
    lockClient=await lockPool.connect();
    await lockClient.query('SELECT pg_advisory_lock(87320261031::bigint)');
    lockHeld=true;
    // Register rejection handlers BEFORE polling pg_stat_activity so a genuine
    // SQL error cannot be masked by a later database-cleanup error.
    settledTasks=Promise.allSettled([
      ensureMicrobusinessReadinessSchema(poolA),
      ensureMicrobusinessReadinessSchema(poolB)
    ]);
    let waiting=0;
    for(let attempt=0;attempt<100;attempt++){
      const probe=await maintenance.query(`SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname=$1 AND wait_event_type='Lock'
          AND wait_event='advisory'
          AND query LIKE '%pg_advisory_xact_lock(87320261031::bigint)%'`,[ciDbName]);
      waiting=Number(probe.rows[0].waiting);
      if(waiting===2)break;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    await lockClient.query('SELECT pg_advisory_unlock(87320261031::bigint)');
    lockHeld=false;
    const outcomes=await settledTasks;
    settledTasks=null;
    for(const result of outcomes){
      if(result.status==='rejected')throw result.reason;
    }
    same(waiting,2,'two separate Pool DDL callers wait for the same real database advisory lock');
    const readiness=await poolA.query("SELECT to_regclass('public.microbusiness_readiness') IS NOT NULL AS available");
    same(readiness.rows[0].available,true,'concurrent initializers create readiness table');
    const fk=await poolB.query(`SELECT COUNT(*)::int AS count FROM pg_constraint
      WHERE conname='microbusiness_readiness_business_fk'
        AND conrelid='microbusiness_readiness'::regclass`);
    same(Number(fk.rows[0].count),1,'two independent Pools preserve one FK constraint');
    const isolatedDeadlocks=await maintenance.query("SELECT deadlocks FROM pg_stat_database WHERE datname=$1",[ciDbName]);
    same(Number(isolatedDeadlocks.rows[0].deadlocks),0,'concurrent cold schema setup has zero deadlocks');
  }catch(error){
    console.error('READINESS_COLD_SCHEMA_873_FAILURE',error?.message||String(error));
    throw error;
  }finally{
    if(lockHeld&&lockClient)await lockClient.query('SELECT pg_advisory_unlock(87320261031::bigint)').catch(()=>{});
    if(settledTasks)await settledTasks;
    lockClient?.release();
    await Promise.all([bootstrap?.end(),recoveryPool?.end(),poolA?.end(),poolB?.end(),lockPool?.end()].filter(Boolean));
    // A normal DROP, never WITH FORCE: a leaked connection must fail loudly,
    // rather than emit an unhandled 57P01 and hide the original assertion.
    if(created)await maintenance.query('DROP DATABASE IF EXISTS '+ciDbName);
    await maintenance.end();
  }

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
