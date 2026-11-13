// Isolated PostgreSQL 16 contract for the one-query accounting context resolver.
import assert from 'node:assert/strict';
import pg from 'pg';
import {resolveAccountingContext} from '../accounting-context-query-core.js';

if(process.env.NODE_ENV!=='test'||process.env.ABL_ACCOUNTING_CONTEXT_862_CI!=='1'||
   process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='inventory862'||
   process.env.DATABASE_URL||process.env.PAYMONGO_LIVE_ENABLED!=='false'){
  throw Error('Refusing any non-disposable accounting-context database or live provider.');
}
const pool=new pg.Pool({max:1});
const connection=await pool.connect();
let calls=0;
const db={query:(...args)=>{calls++;return connection.query(...args);}};
try{
  const meta=(await connection.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0];
  assert.equal(meta.db,'inventory862');
  assert.ok(meta.version>=160000&&meta.version<170000);
  assert.equal((await connection.query("SELECT to_regclass('public.businesses') AS t")).rows[0].t,null,'Refuse pre-existing public tables');

  const schemaSql=[
    "CREATE TEMP TABLE businesses(id BIGINT PRIMARY KEY,name TEXT,country_code TEXT,currency_code TEXT);",
    "CREATE TEMP TABLE profile_business_bindings(account_id BIGINT,role TEXT,business_id BIGINT,status TEXT,is_primary BOOLEAN);",
    "CREATE TEMP TABLE business_memberships(business_id BIGINT,account_id BIGINT,membership_role TEXT,active BOOLEAN);",
    "CREATE TEMP TABLE account_business_preferences(account_id BIGINT,role TEXT,business_id BIGINT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,role));",
    "CREATE TEMP TABLE budgets(id BIGINT,business_id BIGINT,PRIMARY KEY(business_id,id));",
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

  console.log('ACCOUNTING_CONTEXT_862_POSTGRES_PASS assertions=16');
}finally{
  connection.release();
  await pool.end();
}
