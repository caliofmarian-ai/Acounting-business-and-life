import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureMicrobusinessReadinessSchema} from '../microbusiness-readiness-core.js';

// No live DB, identity, payments, or schema writes. These tests exercise the
// actual exported initializer with a controllable synthetic query adapter.
function fakePool({waitForDdl=null,firstFailure=false}={}){
  const statements=[];
  let fail=firstFailure;
  return{
    statements,
    async query(sql){
      statements.push(sql);
      if(sql.includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness (')){
        if(fail){fail=false;throw new Error('synthetic transient schema failure');}
        if(waitForDdl)await waitForDdl;
        return{rows:[],rowCount:0};
      }
      if(sql.includes("SELECT to_regclass('public.businesses')")){
        return{rows:[{table_name:null}],rowCount:1};
      }
      throw new Error('Unexpected SQL in schema single-flight test');
    }
  };
}

test('12 concurrent callers share one schema DDL task and success is reused',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const pool=fakePool({waitForDdl:gate});
  const attempts=Array.from({length:12},()=>ensureMicrobusinessReadinessSchema(pool));
  assert.equal(new Set(attempts).size,1,'all callers get the very same pending task');
  assert.equal(pool.statements.length,1,'DDL begins exactly once while in flight');
  release();
  await Promise.all(attempts);
  assert.equal(pool.statements.length,1,'one atomic, transaction-scoped DDL and FK batch');
  assert.match(pool.statements[0],/pg_advisory_xact_lock\(87320261031::bigint\)/,'shared database-session lock in the DDL batch');
  assert.match(pool.statements[0],/DO \$readiness_fk\$/,'FK guard is inside the same locked transaction');
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(pool.statements.length,1,'successful initialization is not repeated on every GET');
});

test('failed schema initialization retries on the next call without caching a rejection',async()=>{
  const pool=fakePool({firstFailure:true});
  await assert.rejects(ensureMicrobusinessReadinessSchema(pool),/synthetic transient schema failure/);
  await ensureMicrobusinessReadinessSchema(pool);
  const attempts=pool.statements.filter(sql=>sql.includes('CREATE TABLE IF NOT EXISTS microbusiness_readiness ('));
  assert.equal(attempts.length,2,'failed provisioning is retried, not silently accepted');
  await ensureMicrobusinessReadinessSchema(pool);
  assert.equal(pool.statements.length,2,'successful retry remains cached');
});

test('unrelated Pools have independent schema initialization and no shared readiness state',async()=>{
  const a=fakePool(),b=fakePool();
  await Promise.all([ensureMicrobusinessReadinessSchema(a),ensureMicrobusinessReadinessSchema(b)]);
  assert.equal(a.statements.length,1);
  assert.equal(b.statements.length,1);
  assert.notEqual(ensureMicrobusinessReadinessSchema(a),ensureMicrobusinessReadinessSchema(b));
});
