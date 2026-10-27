import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAccountAccessRetentionPolicy as validate, requireAccountAccessRetentionApply as allow,
  runAccountAccessRetention as run, initializeAccountAccessRetention as initialize } from '../account-access-retention.js';

function fixture() {
  const now = Date.now();
  return { schema_version:1, scope:'guest_account_access', status:'approved', policy_ref:'fixture-only-policy',
    approval_ref:'fixture-only-approval', operator_ref:'fixture-only-operator', backup_procedure_ref:'fixture-only-backup',
    hold_review_ref:'fixture-only-hold-review', approved_at:new Date(now-3600000).toISOString(),
    expires_at:new Date(now+3600000).toISOString(), age_basis:'last_updated_at', disposal:'delete_request_row',
    retention_days:{new:10,reviewing:20,closed:30} };
}
const applyEnv = p => ({ ACCOUNT_ACCESS_RETENTION_ENABLED:'true', ACCOUNT_ACCESS_RETENTION_POLICY_SHA256:validate(p).digest });
const hasCode = code => error => error.code === code;
const policyError = hasCode('ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED');
function database({ count = 1, failure, clock = new Date(), commitFailure = false, rollbackFailure = false } = {}) {
  const queries = []; let connections = 0, releases = 0;
  const pool = { connect: async () => {
    connections++;
    return { release(){ releases++; }, async query(sql, params) {
      queries.push({ sql, params });
      if ((failure && sql.includes(failure)) || (commitFailure && sql === 'COMMIT') || (rollbackFailure && sql === 'ROLLBACK')) {
        throw Error('private-value database-secret@example.invalid');
      }
      if (sql === 'SELECT CURRENT_TIMESTAMP AS now') return { rows:[{ now:clock }] };
      if (sql.includes('COUNT(*)::int')) return { rows:[{ count }] };
      return { rows:[] };
    }};
  }};
  return { pool, queries, connections:()=>connections, releases:()=>releases };
}

test('canonical policy remains draft with no invented approval, period or operator', () => {
  const p = JSON.parse(fs.readFileSync(new URL('../privacy/account-access-retention.json',import.meta.url),'utf8'));
  assert.equal(p.status,'draft');
  for (const value of Object.values(p.retention_days)) assert.equal(value,null);
  assert.throws(()=>validate(p),policyError);
});
test('valid policy is copied, frozen and gets a stable canonical digest', () => {
  const p=fixture(), a=validate(p), b=validate(Object.fromEntries(Object.entries(p).reverse()));
  assert.equal(a.digest,b.digest); assert.match(a.digest,/^[a-f0-9]{64}$/);
  p.retention_days.new=500; assert.equal(a.policy.retention_days.new,10);
  assert.ok(Object.isFrozen(a.policy.retention_days));
});
for (const key of ['policy_ref','approval_ref','operator_ref','backup_procedure_ref','hold_review_ref']) {
  test(`missing/unsafe ${key} cannot establish approval`, () => {
    for (const bad of [null,'','private@example.invalid','has space','x'.repeat(201)]) {
      const p=fixture(); p[key]=bad; assert.throws(()=>validate(p),policyError);
    }
  });
}
for (const status of ['new','reviewing','closed']) test(`explicit integer policy needed for ${status}`, () => {
  for (const bad of [null,undefined,0,-1,0.5,'10',Infinity,NaN,36501]) {
    const p=fixture(); p.retention_days[status]=bad; assert.throws(()=>validate(p),policyError);
  }
});
test('unknown/missing keys, incorrect scope and unsupported decisions fail closed', () => {
  for (const change of [p=>{p.extra=true;},p=>{delete p.approval_ref;},p=>{p.retention_days.extra=1;},
    p=>{p.status='draft';},p=>{p.scope='referral';},p=>{p.schema_version=2;},p=>{p.age_basis='created_at';},p=>{p.disposal='archive';}]) {
    const p=fixture(); change(p); assert.throws(()=>validate(p),policyError);
  }
  for (const value of [null,[],1,'policy']) assert.throws(()=>validate(value),policyError);
});
test('future, expired, invalid, noncanonical and reversed approval dates are rejected', () => {
  for (const [key,value] of [['approved_at',new Date(Date.now()+7200000).toISOString()],['expires_at',new Date(Date.now()-1).toISOString()],
    ['approved_at','not-a-date'],['approved_at','2026-02-30T00:00:00.000Z'],['expires_at','2099-01-01']]) {
    const p=fixture();p[key]=value;assert.throws(()=>validate(p),policyError);
  }
});
test('apply needs exact digest AND explicit enablement', () => {
  const p=fixture(),{digest}=validate(p); allow(digest,applyEnv(p));
  for (const env of [{},{ACCOUNT_ACCESS_RETENTION_ENABLED:'true'},
    {...applyEnv(p),ACCOUNT_ACCESS_RETENTION_ENABLED:'TRUE'}, {...applyEnv(p),ACCOUNT_ACCESS_RETENTION_POLICY_SHA256:'f'.repeat(64)}]) {
    assert.throws(()=>allow(digest,env),hasCode('ACCOUNT_ACCESS_RETENTION_APPLY_DISABLED'));
  }
});
test('invalid policy/options/apply gates do not even connect to a database', async () => {
  const db=database();
  await assert.rejects(run(db.pool,{}),policyError);
  for (const options of [{mode:'yes'},{batchSize:0},{batchSize:201},{batchSize:1.5}]) {
    await assert.rejects(run(db.pool,fixture(),options),hasCode('ACCOUNT_ACCESS_RETENTION_OPTIONS_INVALID'));
  }
  await assert.rejects(run(db.pool,fixture(),{mode:'apply',env:{}}),hasCode('ACCOUNT_ACCESS_RETENTION_APPLY_DISABLED'));
  await assert.rejects(initialize(db.pool,fixture(),{env:{}}),hasCode('ACCOUNT_ACCESS_RETENTION_APPLY_DISABLED'));
  assert.equal(db.connections(),0);
});
test('default dry-run only reads aggregate bounded eligibility; no DDL or mutation', async () => {
  const db=database({count:51}), p=fixture(), result=await run(db.pool,p,{env:{}});
  assert.equal(result.mode,'dry-run');assert.equal(result.eligible_up_to_batch,50);assert.equal(result.more_eligible,true);
  assert.equal(db.queries[0].sql,'BEGIN READ ONLY');
  const sql=db.queries.map(q=>q.sql).join('\n');
  assert.doesNotMatch(sql,/CREATE|DELETE|INSERT|UPDATE|pg_advisory/);
  assert.doesNotMatch(sql,/contact_email|display_name|staff_note|message|dedupe_key/);
  assert.deepEqual(db.queries.find(q=>q.params)?.params,[10,20,30,51]);
  assert.equal(db.releases(),1);assert.equal(db.queries.at(-1).sql,'COMMIT');
});
test('apply uses held/current rows only and inserts atomic content-free run audit', async () => {
  const p=fixture(), db=database({count:2}), result=await run(db.pool,p,{mode:'apply',batchSize:3,env:applyEnv(p)});
  assert.equal(result.deleted,2);assert.equal(result.mode,'apply');
  const sql=db.queries.map(q=>q.sql).join('\n');
  assert.match(sql,/pg_advisory_xact_lock\(815, 1\)/);assert.match(sql,/FOR UPDATE OF r SKIP LOCKED/);
  assert.match(sql,/NOT EXISTS .*guest_account_access_retention_holds/);
  assert.match(sql,/r.updated_at < CURRENT_TIMESTAMP/);
  const audit=db.queries.find(q=>q.sql.startsWith('INSERT'));assert.equal(audit.params.length,3);
  assert.equal(audit.params[1],validate(p).digest);assert.equal(audit.params[2],2);
  assert.doesNotMatch(JSON.stringify(result),/email|message|staff_note|request_id/);
});
test('no incomplete or invalid database result is reported as success', async () => {
  for (const count of [-1,undefined,null,'',NaN,201]) {
    const p=fixture(),db=database({count:count===undefined?'bad':count});
    await assert.rejects(run(db.pool,p,{mode:'apply',env:applyEnv(p)}),hasCode('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'));
    assert.equal(db.queries.at(-1).sql,'ROLLBACK');assert.equal(db.releases(),1);
  }
});
for (const failure of ['DELETE FROM','INSERT INTO guest_account_access_retention_runs','COMMIT','pg_advisory_xact_lock']) {
  test(`failure at ${failure} attempts rollback and leaks no private error`,async()=>{
    const p=fixture(),db=database({failure});
    await assert.rejects(run(db.pool,p,{mode:'apply',env:applyEnv(p)}),error=>{
      assert.equal(error.message,'ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');return true;
    });
    assert.equal(db.queries.at(-1).sql,'ROLLBACK');assert.equal(db.releases(),1);
  });
}
test('database clock rechecks expiry before row access',async()=>{
  const p=fixture(),db=database({clock:new Date(Date.now()+86400000)});
  await assert.rejects(run(db.pool,p),policyError);
  assert.ok(!db.queries.some(q=>q.sql.includes('FROM guest_account_access_requests')));
});
test('missing DB clock, connection failure and rollback failure fail safely',async()=>{
  const db=database({clock:null});await assert.rejects(run(db.pool,fixture()),hasCode('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'));
  await assert.rejects(run({connect:async()=>{throw Error('private');}},fixture()),hasCode('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'));
  const p=fixture(),db2=database({failure:'DELETE FROM',rollbackFailure:true});
  await assert.rejects(run(db2.pool,p,{mode:'apply',env:applyEnv(p)}),hasCode('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE'));assert.equal(db2.releases(),1);
});
test('explicit initialization is digest-gated and installs RESTRICT holds plus non-PII audit only',async()=>{
  const p=fixture(),db=database();await initialize(db.pool,p,{env:applyEnv(p)});
  const sql=db.queries.map(q=>q.sql).join('\n');assert.match(sql,/ON DELETE RESTRICT/);
  assert.doesNotMatch(sql,/DROP|DELETE FROM|contact_email|message|staff_note/);
});
test('operator CLI is disabled by the checked-in draft before importing pg or opening a database',()=>{
  const script=fileURLToPath(new URL('../scripts/account-access-retention.mjs',import.meta.url));
  for (const flag of ['--dry-run','--apply','--initialize']) {
    const result=spawnSync(process.execPath,[script,flag],{encoding:'utf8',env:{PATH:process.env.PATH,DATABASE_URL:'postgres://private:secret@invalid.invalid/private'}});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{ok:false,code:'ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED'});
    assert.doesNotMatch(result.stderr,/postgres|private|secret/);
  }
});
