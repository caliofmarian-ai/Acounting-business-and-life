import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureMicrobusinessReadinessSchema} from '../microbusiness-readiness-core.js';

// Deterministic query adapter; the independent CI PostgreSQL workflow tests
// actual transactions, locks, FK creation and full failure rollback.
function fakePool({waitForDdl=null,firstFailure=false,businessInitiallyExists=true}={}){
  const statements=[];
  let fail=firstFailure,businessExists=businessInitiallyExists;
  return{
    statements,
    createBusinesses(){businessExists=true},
    async query(sql){
      statements.push(String(sql));
      if(String(sql).includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness (')){
        if(fail){fail=false;throw new Error('synthetic transient schema failure')}
        if(waitForDdl)await waitForDdl;
        return{rows:[],rowCount:0};
      }
      if(String(sql).includes("SELECT to_regclass('public.businesses') AS table_name")){
        return{rows:[{table_name:businessExists?'businesses':null}],rowCount:1};
      }
      if(String(sql).includes('DO $readiness_fk$')&&String(sql).includes('pg_advisory_xact_lock')){
        assert.equal(businessExists,true,'deferred FK must wait for businesses');
        return{rows:[],rowCount:0};
      }
      throw new Error('Unexpected SQL in schema single-flight test');
    }
  };
}
const ddlCount=pool=>pool.statements.filter(x=>x.includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness (')).length;
const deferredFkCount=pool=>pool.statements.filter(x=>x.includes('DO $readiness_fk$')&&!x.includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness (')).length;

test('12 concurrent callers share one schema DDL task and success is reused',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const pool=fakePool({waitForDdl:gate});
  const attempts=Array.from({length:12},()=>ensureMicrobusinessReadinessSchema(pool));
  assert.equal(new Set(attempts).size,1,'all callers get the very same pending task');
  assert.equal(ddlCount(pool),1,'DDL begins exactly once while in flight');
  release();
  await Promise.all(attempts);
  assert.equal(ddlCount(pool),1,'one atomic, transaction-scoped DDL and FK batch');
  assert.match(pool.statements[0],/pg_advisory_xact_lock\(87320261031::bigint\)/);
  assert.match(pool.statements[0],/DO \$readiness_fk\$/);
  assert.equal(pool.statements.length,2,'one bootstrap DDL and one cheap business-table proof');
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(pool.statements.length,2,'successful initialization is not repeated on every GET');
});

test('failed schema initialization retries on the next call without caching a rejection',async()=>{
  const pool=fakePool({firstFailure:true});
  await assert.rejects(ensureMicrobusinessReadinessSchema(pool),/synthetic transient schema failure/);
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(ddlCount(pool),2,'failed provisioning is retried, not silently accepted');
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(pool.statements.length,3,'successful retry and business proof stay cached');
});

test('unrelated Pools have independent schema initialization and no shared readiness state',async()=>{
  const a=fakePool(),b=fakePool();
  await Promise.all([ensureMicrobusinessReadinessSchema(a),ensureMicrobusinessReadinessSchema(b)]);
  assert.equal(ddlCount(a),1);
  assert.equal(ddlCount(b),1);
  assert.notEqual(ensureMicrobusinessReadinessSchema(a),ensureMicrobusinessReadinessSchema(b));
});

test('staged businesses bootstrap attaches the optional FK without repeating table/index DDL',async()=>{
  const pool=fakePool({businessInitiallyExists:false});
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(ddlCount(pool),1);
  assert.equal(deferredFkCount(pool),0);
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(deferredFkCount(pool),0,'no FK DDL while businesses is absent');
  const before=pool.statements.length;
  pool.createBusinesses();
  const tasks=Array.from({length:8},()=>ensureMicrobusinessReadinessSchema(pool));
  assert.equal(new Set(tasks).size,1,'deferred FK check is single-flight');
  await Promise.all(tasks);
  assert.equal(ddlCount(pool),1,'the expensive schema DDL never repeats');
  assert.equal(deferredFkCount(pool),1,'one transaction-locked FK guard after businesses appears');
  const after=pool.statements.length;
  assert.equal(after,before+2,'one cheap table probe plus one FK-only DDL');
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(pool.statements.length,after,'future Merchant GETs issue no DDL or probe');
});
