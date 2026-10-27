import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { validateAccountAccessRetentionPolicy as validate, initializeAccountAccessRetention as initialize,
  runAccountAccessRetention as run } from '../account-access-retention.js';

// Run after account-access-retention-acceptance.mjs in the SAME disposable CI DB.
// No deployed target, real policy, real account or production data is accepted.
const target = new URL(process.env.DATABASE_URL || 'http://invalid');
if (process.env.ACCOUNT_ACCESS_RETENTION_FIXTURE_DB !== '1' || !['postgres:', 'postgresql:'].includes(target.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.pathname !== '/account_access_retention_815') {
  throw Error('Refusing non-disposable/non-loopback retention expiry database');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, connectionTimeoutMillis: 5000 });
const results = [];
let databaseVersion = null;
const policyError = 'ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED';
async function fixturePolicy(ttl = 900) {
  const db = (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  const now = Math.max(Date.now(), db);
  assert.ok(Math.abs(Date.now() - db) < 500, 'Fixture clocks must be aligned');
  return { schema_version: 1, scope: 'guest_account_access', status: 'approved', policy_ref: 'fixture-only-policy',
    approval_ref: 'fixture-only-approval', operator_ref: 'fixture-only-operator', backup_procedure_ref: 'fixture-only-backup',
    hold_review_ref: 'fixture-only-holds', approved_at: new Date(now - 3600000).toISOString(),
    expires_at: new Date(now + ttl).toISOString(), age_basis: 'last_updated_at', disposal: 'delete_request_row',
    retention_days: { new: 10, reviewing: 20, closed: 30 } };
}
const applyEnv = policy => ({ ACCOUNT_ACCESS_RETENTION_ENABLED: 'true', ACCOUNT_ACCESS_RETENTION_POLICY_SHA256: validate(policy).digest });
async function check(name, work) {
  try { await work(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) {
    const code = /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'ASSERTION';
    results.push({ name, status: 'FAIL', code }); console.error(`FAIL ${name}: ${code}`);
  }
}
async function resetAndSeed() {
  await pool.query('TRUNCATE guest_account_access_retention_holds,guest_account_access_retention_runs,guest_account_access_requests RESTART IDENTITY');
  const key = createHash('sha256').update(randomUUID()).digest('hex');
  await pool.query(`INSERT INTO guest_account_access_requests(contact_email,display_name,reason,message,dedupe_key,status,staff_note,created_at,updated_at)
    VALUES('fixture@example.invalid','Synthetic','sign_in','Synthetic expiry evidence only',$1,'closed','Synthetic private note',NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days')`, [key]);
}
async function snapshot() {
  return { requests: (await pool.query('SELECT * FROM guest_account_access_requests ORDER BY id')).rows,
    ledger: (await pool.query('SELECT * FROM guest_account_access_retention_runs ORDER BY run_id')).rows };
}
// This adapter observes statements only. Every query, clock value, wait, delete,
// rollback and commit is executed by the real PostgreSQL connection, never mocked.
function observedPool(client) {
  const queries = []; let releases = 0;
  return { queries, releases: () => releases, pool: { connect: async () => ({
    query(sql, params) { queries.push(sql); return client.query(sql, params); },
    release() { releases++; } // The fixture owns and releases the borrowed client in finally.
  }) } };
}
function assertRollback(observed) {
  assert.equal(observed.queries.at(-1), 'ROLLBACK');
  assert.ok(!observed.queries.includes('COMMIT'));
  assert.equal(observed.releases(), 1);
}
async function observeBlocked(pid, event) {
  const deadline = performance.now() + 1400;
  while (performance.now() < deadline) {
    // Outside a transaction: pg_stat_activity is refreshed on each poll.
    const row = (await pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.wait_event === event) return;
    await sleep(10);
  }
  assert.fail('Expected real database lock wait was not observed');
}
async function waitForExpiry(policy) {
  await pool.query("SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))::double precision + 0.03)", [policy.expires_at]);
  assert.equal((await pool.query('SELECT clock_timestamp() >= $1::timestamptz AS expired', [policy.expires_at])).rows[0].expired, true);
}
async function blockedExpiry(kind) {
  await resetAndSeed(); const before = await snapshot();
  const locker = await pool.connect(), worker = await pool.connect(), observed = observedPool(worker);
  let pending;
  try {
    await locker.query('BEGIN');
    await locker.query(kind === 'dry-run' ? 'LOCK TABLE guest_account_access_requests IN ACCESS EXCLUSIVE MODE' : 'SELECT pg_advisory_xact_lock(815, 1)');
    const policy = await fixturePolicy(), env = applyEnv(policy);
    const operation = kind === 'initialize' ? initialize(observed.pool, policy, { env })
      : run(observed.pool, policy, { mode: kind === 'dry-run' ? 'dry-run' : 'apply', env });
    // Capture rejections immediately, including a genuine timeout/setup failure.
    pending = operation.then(value => ({ value }), error => ({ error }));
    await observeBlocked(worker.processID, kind === 'dry-run' ? 'relation' : 'advisory');
    await waitForExpiry(policy);
    await locker.query('COMMIT');
    const outcome = await pending;
    assert.equal(outcome.error?.code, policyError);
    assertRollback(observed);
    assert.deepEqual(await snapshot(), before);
    assert.ok(!observed.queries.some(sql => /DELETE FROM|CREATE TABLE|^INSERT/u.test(sql)));
  } finally {
    await locker.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await worker.query('ROLLBACK').catch(() => {});
    locker.release(); worker.release();
  }
}
async function triggerExpiry(table, event) {
  await resetAndSeed(); const before = await snapshot();
  const worker = await pool.connect(), observed = observedPool(worker);
  try {
    // Test-only server-side delay guarantees the actual DELETE/ledger operation
    // crosses expiry, without changing any returned database result or runtime code.
    await pool.query(`CREATE OR REPLACE FUNCTION fixture_retention_wait_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(LEAST(1.5, GREATEST(0, EXTRACT(EPOCH FROM
          (current_setting('account_access.fixture_expiry')::timestamptz-clock_timestamp())))::double precision + 0.03));
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER fixture_retention_expiry BEFORE ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION fixture_retention_wait_expiry()`);
    const policy = await fixturePolicy(), env = applyEnv(policy);
    await worker.query("SELECT set_config('account_access.fixture_expiry',$1,false)", [policy.expires_at]);
    await assert.rejects(run(observed.pool, policy, { mode: 'apply', env }), { code: policyError });
    assert.equal((await pool.query('SELECT clock_timestamp() >= $1::timestamptz AS expired', [policy.expires_at])).rows[0].expired, true);
    assert.ok(observed.queries.some(sql => sql.includes('DELETE FROM')));
    if (event === 'INSERT') assert.ok(observed.queries.some(sql => sql.startsWith('INSERT')));
    assertRollback(observed);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await worker.query('ROLLBACK').catch(() => {});
    await worker.query('RESET account_access.fixture_expiry').catch(() => {});
    worker.release();
    await pool.query(`DROP TRIGGER IF EXISTS fixture_retention_expiry ON ${table}`);
    await pool.query('DROP FUNCTION IF EXISTS fixture_retention_wait_expiry()');
  }
}
try {
  databaseVersion = (await pool.query('SHOW server_version')).rows[0].server_version;
  for (const table of ['guest_account_access_requests', 'guest_account_access_retention_holds', 'guest_account_access_retention_runs']) {
    assert.ok((await pool.query('SELECT to_regclass($1) AS relation', [table])).rows[0].relation,
      'Run the existing retention acceptance script first');
  }
  await check('expiry during observed advisory-lock wait prevents DELETE and rolls back', () => blockedExpiry('apply'));
  await check('expiry during observed advisory-lock wait prevents initialization DDL', () => blockedExpiry('initialize'));
  await check('expiry during actual DELETE trigger restores request content and ledger', () => triggerExpiry('guest_account_access_requests', 'DELETE'));
  await check('expiry during actual ledger trigger restores request content and ledger', () => triggerExpiry('guest_account_access_retention_runs', 'INSERT'));
  await check('expiry during observed read-only relation-lock wait returns no stale eligibility', () => blockedExpiry('dry-run'));
  await check('valid policy still commits one bounded batch with three real wall-clock checks', async () => {
    await resetAndSeed(); const worker = await pool.connect(), observed = observedPool(worker);
    try {
      const policy = await fixturePolicy(60000), env = applyEnv(policy);
      const result = await run(observed.pool, policy, { mode: 'apply', env });
      assert.equal(result.deleted, 1);
      assert.equal(observed.queries.filter(sql => sql === 'SELECT clock_timestamp() AS now').length, 3);
      assert.equal(observed.queries.at(-1), 'COMMIT');
      assert.equal(observed.releases(), 1);
      const after = await snapshot(); assert.equal(after.requests.length, 0); assert.equal(after.ledger.length, 1);
      assert.equal(after.ledger[0].deleted_count, 1);
    } finally { await worker.query('ROLLBACK').catch(() => {}); worker.release(); }
  });
} finally {
  await pool.end(); await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/account-access-retention-expiry.json', JSON.stringify({
    revision: process.env.TESTED_SHA || null, environment: 'isolated-loopback-postgresql', database_version: databaseVersion,
    synthetic_policy_only: true, real_database_queries: true, results
  }, null, 2));
}
const failed = results.filter(result => result.status !== 'PASS').length;
console.log(JSON.stringify({ passed: results.length - failed, failed }));
if (failed || results.length !== 6) process.exitCode = 1;
