import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { ensureAccountAccessSchema } from '../account-access-core.js';
import { validateAccountAccessRetentionPolicy as validate, initializeAccountAccessRetention as initialize,
  runAccountAccessRetention as run } from '../account-access-retention.js';

const target = new URL(process.env.DATABASE_URL || 'http://invalid');
if (process.env.ACCOUNT_ACCESS_RETENTION_FIXTURE_DB !== '1' || !['postgres:','postgresql:'].includes(target.protocol)
  || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.pathname !== '/account_access_retention_815') {
  throw Error('Refusing non-disposable/non-loopback retention database');
}
const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL,max:6,connectionTimeoutMillis:5000 });
const now=Date.now();
// Explicitly synthetic policy. Not loaded by the CLI, not a controller decision.
const policy={ schema_version:1,scope:'guest_account_access',status:'approved',policy_ref:'fixture-only-policy',
  approval_ref:'fixture-only-approval',operator_ref:'fixture-only-operator',backup_procedure_ref:'fixture-only-backup',
  hold_review_ref:'fixture-only-holds',approved_at:new Date(now-3600000).toISOString(),expires_at:new Date(now+3600000).toISOString(),
  age_basis:'last_updated_at',disposal:'delete_request_row',retention_days:{new:10,reviewing:20,closed:30} };
const env={ACCOUNT_ACCESS_RETENTION_ENABLED:'true',ACCOUNT_ACCESS_RETENTION_POLICY_SHA256:validate(policy).digest};
const results=[];
async function check(name,work) {
  try { await work(); results.push({name,status:'PASS'});console.log(`PASS ${name}`); }
  catch(error) { results.push({name,status:'FAIL',code:error.code || 'ASSERTION'});console.error(`FAIL ${name}: ${error.code || 'assertion'}`); }
}
const count=async table=>Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count);
const reset=()=>pool.query('TRUNCATE guest_account_access_retention_holds,guest_account_access_retention_runs,guest_account_access_requests RESTART IDENTITY');
async function seed(status='closed',days=40) {
  const key=createHash('sha256').update(randomUUID()).digest('hex');
  return (await pool.query(`INSERT INTO guest_account_access_requests(contact_email,display_name,reason,message,dedupe_key,status,staff_note,created_at,updated_at)
    VALUES('fixture@example.invalid','Synthetic','sign_in','Synthetic retention evidence only',$1,$2,'Synthetic private note',NOW()-$3::int*INTERVAL '1 day',NOW()-$3::int*INTERVAL '1 day') RETURNING id`,[key,status,days])).rows[0].id;
}
try {
  await ensureAccountAccessSchema(pool);
  await check('explicit idempotent migration with approved synthetic policy',async()=>{
    await initialize(pool,policy,{env});await initialize(pool,policy,{env});
    assert.equal(await count('guest_account_access_retention_runs'),0);
  });
  await check('draft and disabled apply cannot touch a database',async()=>{
    let touched=false;const forbidden={connect:async()=>{touched=true;throw Error('unexpected');}};
    await assert.rejects(run(forbidden,{...policy,status:'draft'}),{code:'ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED'});
    await assert.rejects(run(forbidden,policy,{mode:'apply',env:{}}),{code:'ACCOUNT_ACCESS_RETENTION_APPLY_DISABLED'});assert.equal(touched,false);
  });
  await check('read-only dry-run bounds counts and preserves all content and audits',async()=>{
    await reset();for(let i=0;i<4;i++)await seed();
    const before=(await pool.query('SELECT * FROM guest_account_access_requests ORDER BY id')).rows;
    const preview=await run(pool,policy,{batchSize:2,env:{}});
    assert.equal(preview.eligible_up_to_batch,2);assert.equal(preview.more_eligible,true);
    assert.deepEqual((await pool.query('SELECT * FROM guest_account_access_requests ORDER BY id')).rows,before);
    assert.equal(await count('guest_account_access_retention_runs'),0);
    assert.doesNotMatch(JSON.stringify(preview),/fixture@example|Synthetic|request_id/);
  });
  await check('independent approved ages apply to each status; recent and held rows survive',async()=>{
    await reset();const expired=[];const keep=[];
    for(const [status,days] of Object.entries(policy.retention_days)){expired.push(await seed(status,days+1));keep.push(await seed(status,days-1));}
    const held=await seed('closed',100);keep.push(held);
    await pool.query('INSERT INTO guest_account_access_retention_holds(request_id,hold_ref) VALUES($1,$2)',[held,'fixture-hold']);
    const result=await run(pool,policy,{mode:'apply',env});assert.equal(result.deleted,3);
    const ids=(await pool.query('SELECT id FROM guest_account_access_requests ORDER BY id')).rows.map(x=>x.id);
    assert.deepEqual(ids,keep);assert.ok(expired.every(id=>!ids.includes(id)));
    assert.equal(await count('guest_account_access_retention_runs'),1);
    assert.equal((await pool.query('SELECT deleted_count FROM guest_account_access_retention_runs')).rows[0].deleted_count,3);
    await assert.rejects(pool.query('DELETE FROM guest_account_access_requests WHERE id=$1',[held]),{code:'23503'});
  });
  await check('missing audit storage rolls deletion back, never returns false success',async()=>{
    await reset();await seed();
    await pool.query('ALTER TABLE guest_account_access_retention_runs RENAME TO retention_runs_unavailable');
    try {
      await assert.rejects(run(pool,policy,{mode:'apply',env}),{code:'ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'});
      assert.equal(await count('guest_account_access_requests'),1);
    } finally { await pool.query('ALTER TABLE retention_runs_unavailable RENAME TO guest_account_access_retention_runs'); }
    assert.equal(await count('guest_account_access_retention_runs'),0);
  });
  await check('missing hold registry fails closed rather than treating all records as disposable',async()=>{
    await reset();await seed();
    await pool.query('ALTER TABLE guest_account_access_retention_holds RENAME TO retention_holds_unavailable');
    try { await assert.rejects(run(pool,policy,{mode:'apply',env}),{code:'ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'});assert.equal(await count('guest_account_access_requests'),1); }
    finally {await pool.query('ALTER TABLE retention_holds_unavailable RENAME TO guest_account_access_retention_holds');}
  });
  await check('parallel workers use bounded non-overlapping committed batches',async()=>{
    await reset();for(let i=0;i<5;i++)await seed();
    const values=await Promise.all([run(pool,policy,{mode:'apply',batchSize:2,env}),run(pool,policy,{mode:'apply',batchSize:2,env})]);
    assert.deepEqual(values.map(x=>x.deleted),[2,2]);assert.notEqual(values[0].run_id,values[1].run_id);
    assert.equal(await count('guest_account_access_requests'),1);assert.equal(await count('guest_account_access_retention_runs'),2);
  });
  await check('in-flight triage is skipped and a fresh revision is re-evaluated next time',async()=>{
    await reset();const id=await seed();const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query('SELECT id FROM guest_account_access_requests WHERE id=$1 FOR UPDATE',[id]);
      assert.equal((await run(pool,policy,{mode:'apply',env})).deleted,0);
      await client.query("UPDATE guest_account_access_requests SET status='reviewing',revision=revision+1,updated_at=NOW() WHERE id=$1",[id]);await client.query('COMMIT');
    } finally {await client.query('ROLLBACK').catch(()=>{});client.release();}
    assert.equal((await run(pool,policy,{mode:'apply',env})).deleted,0);assert.equal(await count('guest_account_access_requests'),1);
  });
  await check('repeat after committed removal is harmless and emits no request evidence',async()=>{
    await reset();await seed();assert.equal((await run(pool,policy,{mode:'apply',env})).deleted,1);
    const result=await run(pool,policy,{mode:'apply',env});assert.equal(result.deleted,0);
    const fields=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='guest_account_access_retention_runs' ORDER BY ordinal_position")).rows.map(x=>x.column_name);
    assert.deepEqual(fields,['run_id','policy_digest','deleted_count','created_at']);
  });
} finally {
  await pool.end();await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/account-access-retention.json',JSON.stringify({revision:process.env.TESTED_SHA || null,
    environment:'isolated-loopback-postgresql16',synthetic_policy_only:true,results},null,2));
}
const failed=results.filter(x=>x.status!=='PASS').length;
console.log(JSON.stringify({passed:results.length-failed,failed}));
if(failed)process.exitCode=1;
