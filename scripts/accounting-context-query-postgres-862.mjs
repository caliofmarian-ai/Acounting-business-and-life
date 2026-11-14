// Isolated PostgreSQL 16 contract for the one-query accounting context resolver.
import assert from 'node:assert/strict';
import pg from 'pg';
import {resolveAccountingContext} from '../accounting-context-query-core.js';

if(process.env.NODE_ENV!=='test'||process.env.ABL_ACCOUNTING_CONTEXT_862_CI!=='1'||
   process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='inventory862'||
   process.env.DATABASE_URL||process.env.PAYMONGO_LIVE_ENABLED!=='false'){
  throw Error('Refusing any non-disposable accounting-context database or live provider.');
}
const pool=new pg.Pool({max:3});
const connection=await pool.connect();
const concurrentConnection=await pool.connect();
const schema='abl_accounting_context_862_'+process.pid;
let schemaCreated=false,transactionOpen=false,pending=null;
let calls=0;
const db={query:(...args)=>{calls++;return connection.query(...args);}};
const concurrentDb={query:(...args)=>concurrentConnection.query(...args)};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const meta=(await connection.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0];
  assert.equal(meta.db,'inventory862');
  assert.ok(meta.version>=160000&&meta.version<170000);
  assert.equal((await connection.query("SELECT to_regclass('public.businesses') AS t")).rows[0].t,null,'Refuse pre-existing public tables');
  const existing=(await connection.query('SELECT to_regnamespace($1) AS name',[schema])).rows[0].name;
  assert.equal(existing,null,'Refuse an existing disposable test schema');
  await connection.query('CREATE SCHEMA '+schema);
  schemaCreated=true;
  await connection.query('SET search_path TO '+schema+',public');
  await concurrentConnection.query('SET search_path TO '+schema+',public');

  const schemaSql=[
    "CREATE TABLE businesses(id BIGINT PRIMARY KEY,name TEXT,country_code TEXT,currency_code TEXT);",
    "CREATE TABLE profile_business_bindings(account_id BIGINT,role TEXT,business_id BIGINT,status TEXT,is_primary BOOLEAN);",
    "CREATE TABLE business_memberships(business_id BIGINT,account_id BIGINT,membership_role TEXT,active BOOLEAN);",
    "CREATE TABLE account_business_preferences(account_id BIGINT,role TEXT,business_id BIGINT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,role));",
    "CREATE TABLE budgets(id BIGINT,business_id BIGINT,PRIMARY KEY(business_id,id));",
    "INSERT INTO businesses VALUES (101,'Primary','PH','PHP'),(102,'Selected','PH','PHP'),(103,'Other account','PH','PHP');",
    "INSERT INTO profile_business_bindings VALUES (71,'merchant',101,'active',TRUE),(71,'merchant',102,'active',FALSE),(72,'merchant',103,'active',TRUE);",
    "INSERT INTO business_memberships VALUES (101,71,'owner',TRUE),(102,71,'manager',TRUE),(103,72,'owner',TRUE);",
    "INSERT INTO account_business_preferences(account_id,role,business_id,updated_at) VALUES (71,'merchant',102,'2001-01-01T00:00:00Z');"
  ].join('\n');
  await connection.query(schemaSql);

  let before=calls;
  let result=await resolveAccountingContext(db,71,'merchant');
  assert.equal(calls-before,1,'one round trip for bindings, preference reconciliation and budget ensure');
  assert.equal(result.business.id,'102','valid saved preference wins over primary binding');
  assert.deepEqual(result.businesses.map(x=>x.id),['101','102']);
  assert.equal((await connection.query('SELECT COUNT(*)::int n FROM budgets WHERE business_id=102')).rows[0].n,1);
  assert.equal((await connection.query('SELECT COUNT(*)::int n FROM budgets WHERE business_id=101')).rows[0].n,0);
  const unchanged=(await connection.query("SELECT updated_at::text FROM account_business_preferences WHERE account_id=71 AND role='merchant'")).rows[0].updated_at;
  assert.match(unchanged,/2001-01-01/,'same preference is not rewritten on every read');

  await connection.query("UPDATE account_business_preferences SET business_id=999 WHERE account_id=71 AND role='merchant'");
  before=calls;
  result=await resolveAccountingContext(db,71,'merchant');
  assert.equal(calls-before,1);
  assert.equal(result.business.id,'101','invalid preference falls back to primary active binding');
  assert.equal((await connection.query("SELECT business_id FROM account_business_preferences WHERE account_id=71 AND role='merchant'")).rows[0].business_id,'101');
  assert.equal((await connection.query('SELECT COUNT(*)::int n FROM budgets WHERE business_id=101')).rows[0].n,1);

  before=calls;
  result=await resolveAccountingContext(db,72,'merchant');
  assert.equal(calls-before,1);
  assert.equal(result.business.id,'103','business membership remains account-scoped');
  assert.deepEqual(result.businesses.map(x=>x.id),['103']);

  before=calls;
  result=await resolveAccountingContext(db,73,'merchant');
  assert.equal(calls-before,1);
  assert.equal(result.business,null);
  assert.deepEqual(result.businesses,[]);
  assert.equal((await connection.query('SELECT COUNT(*)::int n FROM account_business_preferences WHERE account_id=73')).rows[0].n,0);
  assert.equal((await connection.query('SELECT COUNT(*)::int n FROM budgets WHERE business_id=103')).rows[0].n,1);

  // Simulate an ordinary read that has already snapshotted an invalid preference,
  // while a newer explicit workspace selection commits before its upsert resumes.
  await connection.query("UPDATE account_business_preferences SET business_id=999 WHERE account_id=71 AND role='merchant'");
  await connection.query('BEGIN');
  transactionOpen=true;
  await connection.query("UPDATE account_business_preferences SET business_id=102 WHERE account_id=71 AND role='merchant'");
  const resolverPid=Number((await concurrentConnection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  pending=resolveAccountingContext(concurrentDb,71,'merchant');
  let waitingForPreferenceRow=false;
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const wait=(await connection.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[resolverPid]
    )).rows[0];
    if(wait?.wait_event_type==='Lock'){waitingForPreferenceRow=true;break;}
    await pause(10);
  }
  assert.equal(waitingForPreferenceRow,true,'resolver reached the real PostgreSQL preference-row lock');
  await connection.query('COMMIT');
  transactionOpen=false;
  const staleResult=await pending;
  pending=null;
  assert.equal(staleResult.business.id,'101','the in-flight request may finish on its original snapshot');
  const finalPreference=(await connection.query(
    "SELECT business_id FROM account_business_preferences WHERE account_id=71 AND role='merchant'"
  )).rows[0].business_id;
  assert.equal(finalPreference,'102','a stale read cannot overwrite the newer explicit workspace selection');

  console.log('ACCOUNTING_CONTEXT_862_POSTGRES_PASS assertions=25');
}finally{
  if(transactionOpen)await connection.query('ROLLBACK').catch(()=>{});
  if(pending)await pending.catch(()=>{});
  if(schemaCreated)await connection.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  concurrentConnection.release();
  connection.release();
  await pool.end();
}
