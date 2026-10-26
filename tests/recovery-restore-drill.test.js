import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {commandEnvironment, FIXTURE_COUNTS, parseArgs, runDrill, validateManifest, validateOptions} from '../scripts/recovery/restore-drill.js';

const validManifest = () => ({format: 'abl-recovery-manifest-v1', archive_sha256: 'a'.repeat(64), backup_created_at: '2026-10-01T12:00:00Z', expected_counts: {...FIXTURE_COUNTS}});

test('recovery accepts only its offline modes and rejects any supplied database destination', () => {
  assert.doesNotThrow(() => validateOptions({synthetic: true}));
  assert.doesNotThrow(() => validateOptions({archive: '/private/a.dump', trustedArchive: true}));
  for (const args of [[], ['--host', 'production'], ['--database-url', 'postgres://secret'], ['--archive', 'a', '--archive', 'b'], ['--synthetic', '--report'], ['--synthetic', 'postgres://secret']]) {
    assert.throws(() => validateOptions(parseArgs(args)));
  }
  for (const options of [{synthetic: true, archive: '/a'}, {archive: '/a'}, {archive: '/a', trustedArchive: true, databaseUrl: 'postgres://secret'}, {synthetic: false}, {synthetic: true, pgBin: './bin'}, {synthetic: true, report: 'a\nsecret'}]) {
    assert.throws(() => validateOptions(options));
  }
});

test('recovery refuses report collisions before opening inputs', () => {
  for (const name of ['archive', 'manifest']) {
    assert.throws(() => validateOptions({archive: '/tmp/source.dump', manifest: '/tmp/source.manifest', trustedArchive: true, report: name === 'archive' ? '/tmp/./source.dump' : '/tmp/source.manifest'}), /REPORT_COLLIDES_WITH_INPUT/);
  }
});

test('all libpq destinations, startup/loader hooks and cloud/application secrets are absent from child environment', () => {
  const env = commandEnvironment('/tmp/private-cluster', '/usr/lib/postgresql/16/bin');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'PGAPPNAME', 'PGCONNECT_TIMEOUT', 'TZ'].sort());
  assert.equal(env.HOME, '/tmp/private-cluster');
  for (const key of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGPASSWORD', 'PGOPTIONS', 'LD_PRELOAD', 'NODE_OPTIONS', 'AWS_ACCESS_KEY_ID', 'RAILWAY_TOKEN']) assert.equal(env[key], undefined);
});

test('count manifests require a complete independent decimal-string baseline and a valid checksum/date', () => {
  assert.equal(validateManifest(validManifest()).expected_counts.orders, '2');
  const cases = [null, [], {}, {...validManifest(), archive_sha256: 'postgres://secret'}, {...validManifest(), backup_created_at: 'invalid'}, {...validManifest(), backup_created_at: '2026-02-31T12:00:00Z'}, {...validManifest(), backup_created_at: '2025-02-29T12:00:00Z'}, {...validManifest(), backup_created_at: '9999-01-01T00:00:00Z'}];
  for (const change of [{orders: 2}, {orders: '-1'}, {orders: '1; DROP TABLE orders'}, {orders: '9'.repeat(20)}, {extra: '1'}]) cases.push({...validManifest(), expected_counts: {...FIXTURE_COUNTS, ...change}});
  const missing = validManifest(); delete missing.expected_counts.orders; cases.push(missing);
  for (const value of cases) assert.throws(() => validateManifest(value), /INVALID_MANIFEST/);
});

test('invalid CLI input does not echo a private connection string or inherited credentials', () => {
  let result;
  try { execFileSync(process.execPath, ['scripts/recovery/restore-drill.js', '--database-url', 'postgres://private-user:PRIVATE_SENTINEL@production/db'], {cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {...process.env, DATABASE_URL: 'PRIVATE_SENTINEL', PGPASSWORD: 'PRIVATE_SENTINEL'}}); }
  catch (error) { result = error; }
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL|private-user|production/);
  assert.equal(JSON.parse(result.stdout).failure_code, 'INVALID_ARGUMENTS');
});

test('invalid programmatic destinations fail before database commands or filesystem cleanup', async () => {
  const report = await runDrill({synthetic: true, host: 'production'});
  assert.equal(report.status, 'FAIL');
  assert.equal(report.failure_code, 'INVALID_ARGUMENTS');
  assert.equal(report.cleanup, 'NOT_REQUIRED');
  assert.deepEqual(report.checks, {});
  assert.equal(report.launch_recovery_gate, 'HOLD');
});

test('root cannot start a PostgreSQL drill or silently borrow another OS identity', {skip: process.getuid?.() !== 0}, async () => {
  const report = await runDrill({synthetic: true});
  assert.equal(report.failure_code, 'UNPRIVILEGED_OS_USER_REQUIRED');
  assert.equal(report.cleanup, 'NOT_REQUIRED');
});
