import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {commandEnvironment, FIXTURE_COUNTS, runDrill} from '../scripts/recovery/restore-drill.js';

const required = process.env.ABL_RECOVERY_INTEGRATION === '1';
const exec = promisify(execFile);

test('real PostgreSQL restore, data-loss detection, isolation and cleanup', {skip: !required, timeout: 240000}, async t => {
  assert.notEqual(process.getuid?.(), 0, 'Integration requires an unprivileged runner');
  const bin = process.env.ABL_RECOVERY_PG_BIN;
  assert.ok(bin?.startsWith('/'), 'Set ABL_RECOVERY_PG_BIN to one installed PostgreSQL toolchain');
  const root = await mkdtemp('/tmp/abl-source-test-');
  const socket = join(root, 'socket'), data = join(root, 'data');
  const env = commandEnvironment(root, bin);
  const run = async (name, args) => (await exec(join(bin, name), args, {env, timeout: 60000, maxBuffer: 1024 * 1024})).stdout;
  const conn = ['--host', socket, '--port', '5432', '--username', 'fixture', '--no-password'];
  const sql = (text, db = 'postgres') => run('psql', [...conn, '--dbname', db, '--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--command', text]);
  let started = false;
  let next = 0;
  const tempDrills = async () => (await readdir('/tmp')).filter(p => p.startsWith('abl-recovery-')).sort();
  const before = await tempDrills();
  try {
    await mkdir(socket, {mode: 0o700});
    await run('initdb', ['-D', data, '--username=fixture', '--auth-local=trust', '--auth-host=reject', '--locale=C', '--encoding=UTF8']);
    await appendFile(join(data, 'postgresql.conf'), `\nlisten_addresses=''\nunix_socket_directories='${socket}'\nunix_socket_permissions=0700\n`);
    await run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start']); started = true;
    await sql('CREATE DATABASE baseline TEMPLATE template0;');
    await run('psql', [...conn, '--dbname', 'baseline', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file', fileURLToPath(new URL('../scripts/recovery/synthetic-fixture.sql', import.meta.url))]);
    async function archive(mutation = '') {
      const db = `case_${++next}`;
      await sql(`CREATE DATABASE ${db} TEMPLATE baseline;`);
      if (mutation) await sql(mutation, db);
      const path = join(root, `${db}.dump`);
      await run('pg_dump', [...conn, '--dbname', db, '--format=custom', '--no-owner', '--no-acl', '--file', path]);
      const hash = createHash('sha256').update(await readFile(path)).digest('hex');
      const manifest = join(root, `${db}.json`);
      await writeFile(manifest, JSON.stringify({format: 'abl-recovery-manifest-v1', archive_sha256: hash, backup_created_at: new Date().toISOString(), expected_counts: FIXTURE_COUNTS}));
      return {archive: path, manifest, trustedArchive: true, pgBin: bin};
    }
    await t.test('synthetic source is dumped and restored through real pg_dump/pg_restore', async () => {
      const report = await runDrill({synthetic: true, pgBin: bin});
      assert.equal(report.status, 'PASS', JSON.stringify(report));
      assert.equal(report.evidence_source, 'synthetic');
      assert.deepEqual(report.row_counts, FIXTURE_COUNTS);
      assert.equal(report.cleanup, 'PASS');
      assert.equal(report.launch_recovery_gate, 'HOLD');
      assert.equal(report.application_boot_verified, false);
    });
    await t.test('supplied archive retains null counter customers and legacy null intent links', async () => {
      const options = await archive();
      const previous = await readFile(options.archive);
      const report = await runDrill(options);
      assert.equal(report.status, 'PASS', JSON.stringify(report));
      assert.deepEqual(await readFile(options.archive), previous);
      assert.equal(report.checks.private_local_cluster, true);
      assert.equal(report.checks.payment_references, true);
    });
    await t.test('a valid-looking partial backup fails the independent count baseline', async () => {
      const report = await runDrill(await archive('DELETE FROM transactions WHERE id=2;'));
      assert.equal(report.status, 'FAIL');
      assert.equal(report.checks.count_manifest_matches, false);
      assert.equal(report.checks.business_evidence_references, true);
    });
    await t.test('cross-business stock evidence fails despite unchanged table counts', async () => {
      const report = await runDrill(await archive('UPDATE order_stock_consumptions SET inventory_id=2;'));
      assert.equal(report.status, 'FAIL');
      assert.equal(report.checks.stock_business_scope, false);
      assert.equal(report.checks.count_manifest_matches, true);
    });
    await t.test('orphan order evidence is detected independently of archive restore success', async () => {
      const report = await runDrill(await archive('UPDATE order_items SET order_id=999 WHERE order_id=1;'));
      assert.equal(report.status, 'FAIL');
      assert.equal(report.checks.order_references, false);
    });
    await t.test('unsupported schema and a missing independent baseline stay HOLD', async () => {
      const partial = await runDrill(await archive('DROP TABLE refunds;'));
      assert.equal(partial.status, 'HOLD');
      assert.deepEqual(partial.hold_reasons, ['UNSUPPORTED_SCHEMA']);
      const options = await archive(); delete options.manifest;
      const noBaseline = await runDrill(options);
      assert.equal(noBaseline.status, 'HOLD');
      assert.ok(noBaseline.hold_reasons.includes('INDEPENDENT_COUNT_MANIFEST_MISSING'));
    });
    await t.test('legacy data anomalies are review holds rather than fabricated restore corruption', async () => {
      const negative = await runDrill(await archive('UPDATE inventory SET quantity=-1 WHERE id=1;'));
      assert.equal(negative.status, 'HOLD');
      assert.equal(negative.anomalies.negative_inventory, '1');
      const notValid = await runDrill(await archive('ALTER TABLE inventory ADD CONSTRAINT nonnegative CHECK(quantity>=0) NOT VALID;'));
      assert.equal(notValid.status, 'HOLD');
      assert.equal(notValid.anomalies.unvalidated_constraints, '1');
    });
    await t.test('checksum mismatch and corrupt archives fail before a destination is initialized', async () => {
      const options = await archive();
      const m = JSON.parse(await readFile(options.manifest)); m.archive_sha256 = '0'.repeat(64); await writeFile(options.manifest, JSON.stringify(m));
      const badHash = await runDrill(options);
      assert.equal(badHash.failure_code, 'ARCHIVE_CHECKSUM_MISMATCH');
      assert.equal(badHash.checks.private_local_cluster, undefined);
      const corrupt = join(root, 'corrupt.dump'); await writeFile(corrupt, 'PGDMP invalid archive PRIVATE_SENTINEL');
      const badArchive = await runDrill({archive: corrupt, trustedArchive: true, pgBin: bin});
      assert.equal(badArchive.status, 'FAIL');
      assert.equal(badArchive.checks.private_local_cluster, undefined);
      assert.doesNotMatch(JSON.stringify(badArchive), /PRIVATE_SENTINEL/);
      const missing = await runDrill({archive: join(root, 'missing.dump'), trustedArchive: true, pgBin: bin});
      assert.equal(missing.failure_code, 'ARCHIVE_READ_FAILED');
      assert.equal(missing.checks.private_local_cluster, undefined);
    });
    await t.test('restore SQL failures cannot leak object names or retain a running destination', async () => {
      const options = await archive('CREATE FUNCTION private_sentinel() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN END$$; CREATE EVENT TRIGGER private_sentinel ON ddl_command_start EXECUTE FUNCTION private_sentinel();');
      const report = await runDrill(options);
      assert.equal(report.status, 'FAIL');
      assert.equal(report.failure_code, 'PG_RESTORE_FAILED');
      assert.equal(report.cleanup, 'PASS');
      assert.doesNotMatch(JSON.stringify(report), /private_sentinel/);
    });
    await t.test('CLI ignores inherited remote libpq/service/loader settings and writes a private report', async () => {
      const path = join(root, 'report.json');
      const script = fileURLToPath(new URL('../scripts/recovery/restore-drill.js', import.meta.url));
      const result = await exec(process.execPath, [script, '--synthetic', '--pg-bin', bin, '--report', path], {env: {...process.env, DATABASE_URL: 'postgres://PRIVATE_SENTINEL@production/db', PGHOST: 'invalid.production', PGSERVICE: 'PRIVATE_SENTINEL', PGOPTIONS: '-c invalid_setting=PRIVATE_SENTINEL', PGPASSFILE: '/nonexistent/PRIVATE_SENTINEL'}, timeout: 60000});
      const report = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(report.status, 'PASS', result.stdout);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL|invalid\.production/);
      const {stat} = await import('node:fs/promises');
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      await assert.rejects(exec(process.execPath, [script, '--synthetic', '--pg-bin', bin, '--report', path], {timeout: 60000}), error => JSON.parse(error.stdout).failure_code === 'REPORT_WRITE_FAILED');
    });
    await t.test('SIGTERM during a running cluster stops the server and removes its private files', {timeout: 45000}, async () => {
      const script = fileURLToPath(new URL('../scripts/recovery/restore-drill.js', import.meta.url));
      const child = spawn(process.execPath, [script, '--synthetic', '--pg-bin', bin], {stdio: ['ignore', 'pipe', 'pipe']});
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { errors += chunk; });
      const done = new Promise((yes, no) => { child.once('error', no); child.once('close', (code, signal) => yes({code, signal})); });
      let activeDirectory;
      try {
        for (let attempt = 0; attempt < 2000 && child.exitCode === null; attempt++) {
          for (const directory of (await tempDrills()).filter(p => !before.includes(p))) {
            try { await readFile(join('/tmp', directory, 'data', 'postmaster.pid')); activeDirectory = directory; break; }
            catch { /* initialization has not yet started a server */ }
          }
          if (activeDirectory) break;
          await new Promise(yes => setTimeout(yes, 10));
        }
        assert.ok(activeDirectory, 'interrupt must happen after PostgreSQL has started');
        child.kill('SIGTERM');
        const exit = await done;
        assert.equal(exit.code, 1, output + errors);
        const report = JSON.parse(output);
        assert.equal(report.failure_code, 'INTERRUPTED');
        assert.equal(report.cleanup, 'PASS');
        assert.ok(!(await tempDrills()).includes(activeDirectory));
      } finally {
        if (child.exitCode === null) { child.kill('SIGTERM'); await done; }
      }
    });
    assert.deepEqual(await tempDrills(), before, 'all tool-owned clusters must be stopped and removed');
  } finally {
    if (started) await run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(root, {recursive: true, force: true});
  }
});
