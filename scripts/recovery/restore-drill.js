#!/usr/bin/env node
// Offline operator tool. Never import application bootstrap or a DATABASE_URL.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, constants} from 'node:fs';
import {appendFile, chmod, mkdtemp, open, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TOOLS = ['initdb', 'pg_ctl', 'psql', 'pg_restore', 'pg_dump'];
export const REQUIRED_COLUMNS = Object.freeze({
  accounts: ['id'], businesses: ['id'], profiles: ['account_id', 'role'],
  business_memberships: ['business_id', 'account_id'],
  orders: ['id', 'business_id', 'customer_account_id', 'subtotal', 'delivery_fee', 'total', 'paid_amount', 'outstanding_amount'],
  order_items: ['order_id', 'quantity', 'line_total'],
  inventory: ['id', 'business_id', 'quantity', 'unit_cost'],
  transactions: ['id', 'business_id', 'type', 'amount'],
  order_stock_consumptions: ['order_id', 'inventory_id'],
  order_payments: ['id', 'order_id', 'payment_intent_id'],
  payment_intents: ['id', 'business_id', 'payer_account_id', 'amount', 'currency_code'],
  payment_allocations: ['payment_intent_id', 'currency_code'],
  refunds: ['payment_intent_id'],
});
export const FIXTURE_COUNTS = Object.freeze({
  accounts: '2', businesses: '2', profiles: '2', business_memberships: '2',
  orders: '2', order_items: '2', inventory: '2', transactions: '2',
  order_stock_consumptions: '1', order_payments: '2', payment_intents: '1',
  payment_allocations: '2', refunds: '1',
});

export class DrillError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new DrillError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function parseArgs(args) {
  const options = {};
  const flags = {'--synthetic': 'synthetic', '--trusted-archive': 'trustedArchive'};
  const values = {'--archive': 'archive', '--manifest': 'manifest', '--report': 'report', '--pg-bin': 'pgBin'};
  for (let i = 0; i < args.length; i++) {
    const key = flags[args[i]] || values[args[i]];
    if (!key || Object.hasOwn(options, key)) fail('INVALID_ARGUMENTS');
    if (flags[args[i]]) options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
      options[key] = value;
    }
  }
  return options;
}

export function validateOptions(options) {
  const allowed = ['synthetic', 'trustedArchive', 'archive', 'manifest', 'report', 'pgBin'];
  if (Object.keys(options).some(k => !allowed.includes(k))) fail('INVALID_ARGUMENTS');
  if (options.synthetic !== undefined && options.synthetic !== true) fail('INVALID_ARGUMENTS');
  if (options.trustedArchive !== undefined && options.trustedArchive !== true) fail('INVALID_ARGUMENTS');
  for (const key of ['archive', 'manifest', 'report', 'pgBin']) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !options[key] || /[\x00-\x1f]/.test(options[key]))) fail('INVALID_ARGUMENTS');
  }
  if (options.synthetic ? (options.archive || options.manifest) : !options.archive) fail('ARCHIVE_SELECTION_REQUIRED');
  if (!options.synthetic && !options.trustedArchive) fail('TRUSTED_ARCHIVE_ACKNOWLEDGEMENT_REQUIRED');
  if (options.pgBin && !isAbsolute(options.pgBin)) fail('ABSOLUTE_PG_BIN_REQUIRED');
  if (options.report && [options.archive, options.manifest].some(p => p && resolve(p) === resolve(options.report))) fail('REPORT_COLLIDES_WITH_INPUT');
}

// Inherited libpq, cloud, application and loader variables never reach PostgreSQL.
export function commandEnvironment(workdir, pgBin) {
  return {
    PATH: pgBin ? `${pgBin}:/usr/bin:/bin` : '/usr/local/bin:/usr/bin:/bin',
    HOME: workdir, LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
    PGAPPNAME: 'abl_recovery_drill', PGCONNECT_TIMEOUT: '5',
  };
}

export function validateManifest(value) {
  if (!value || Array.isArray(value) || value.format !== 'abl-recovery-manifest-v1') fail('INVALID_MANIFEST');
  if (typeof value.archive_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.archive_sha256)) fail('INVALID_MANIFEST');
  if (typeof value.backup_created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.backup_created_at) || !Number.isFinite(Date.parse(value.backup_created_at)) || Date.parse(value.backup_created_at) > Date.now() + 300000) fail('INVALID_MANIFEST');
  if (new Date(value.backup_created_at).toISOString().slice(0, 19) !== value.backup_created_at.slice(0, 19)) fail('INVALID_MANIFEST');
  const counts = value.expected_counts;
  if (!counts || Array.isArray(counts) || Object.keys(counts).length !== Object.keys(REQUIRED_COLUMNS).length) fail('INVALID_MANIFEST');
  for (const name of Object.keys(REQUIRED_COLUMNS)) {
    if (typeof counts[name] !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(counts[name])) fail('INVALID_MANIFEST');
  }
  return {archive_sha256: value.archive_sha256, backup_created_at: new Date(value.backup_created_at).toISOString(), expected_counts: counts};
}

async function readManifest(path) {
  if (!path) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 8192) fail('INVALID_MANIFEST');
    return validateManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error instanceof DrillError) throw error;
    fail('INVALID_MANIFEST');
  }
}

function command(binary, args, env, signal, timeout = 60000) {
  return new Promise((done, reject) => {
    execFile(binary, args, {env, signal, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8'}, (error, stdout) => {
      // Never propagate stderr, error.message, SQL rows, connection strings or paths.
      if (error) reject(new DrillError(signal?.aborted ? 'INTERRUPTED' : 'POSTGRES_COMMAND_FAILED'));
      else done(stdout);
    });
  });
}

export function schemaQuery() {
  const pairs = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => columns.map(column => `('${table}','${column}')`)).join(',');
  return `WITH required(table_name,column_name) AS (VALUES ${pairs}), actual AS (
    SELECT r.*,c.data_type FROM required r
    LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
    LEFT JOIN pg_catalog.pg_class p ON p.oid=pg_catalog.to_regclass('public.'||r.table_name)
    WHERE c.column_name IS NOT NULL AND p.relkind IN ('r','p')
  ) SELECT json_build_object('missing_columns',(SELECT count(*) FROM required)-(SELECT count(*) FROM actual),
    'signature',(SELECT string_agg(table_name||'.'||column_name||':'||data_type,',' ORDER BY table_name,column_name) FROM actual));`;
}

export async function runDrill(options, {signal} = {}) {
  const started = Date.now();
  const report = {
    format: 'abl-recovery-report-v1', tool_version: 1, schema_contract: 'business-life-recovery-v1',
    status: 'FAIL', evidence_source: options.synthetic ? 'synthetic' : 'supplied-archive',
    started_at: new Date(started).toISOString(), node_version: process.versions.node,
    launch_recovery_gate: 'HOLD', provider_backup_policy_verified: false,
    private_object_recovery_verified: false, application_boot_verified: false,
    cleanup: 'NOT_REQUIRED', checks: {},
  };
  let workdir, initialized = false, startedServer = false, startupAttempted = false, run, env, paths;
  try {
    validateOptions(options);
    if (process.platform === 'win32') fail('POSIX_HOST_REQUIRED');
    if (!process.getuid || process.getuid() === 0) fail('UNPRIVILEGED_OS_USER_REQUIRED');
    const manifest = await readManifest(options.manifest);
    workdir = await mkdtemp('/tmp/abl-recovery-');
    await chmod(workdir, 0o700);
    report.cleanup = 'PENDING';
    env = commandEnvironment(workdir, options.pgBin);
    paths = Object.fromEntries(TOOLS.map(name => [name, options.pgBin ? join(options.pgBin, name) : name]));
    run = async (name, args, timeout) => {
      try { return await command(paths[name], args, env, signal, timeout); }
      catch (error) { if (error instanceof DrillError && error.code !== 'INTERRUPTED') error.code = `${name.toUpperCase()}_FAILED`; throw error; }
    };
    const versions = {};
    for (const name of TOOLS) {
      const match = (await run(name, ['--version'])).match(/\(PostgreSQL\) (\d+(?:\.\d+)+)/);
      if (!match) fail('POSTGRES_VERSION_UNRECOGNIZED');
      versions[name] = match[1];
    }
    if (new Set(Object.values(versions).map(v => v.split('.')[0])).size !== 1) fail('POSTGRES_VERSION_MISMATCH');
    report.postgres_versions = versions;
    const archive = join(workdir, 'archive.dump');
    if (!options.synthetic) {
      let source;
      try {
        source = await open(resolve(options.archive), constants.O_RDONLY | constants.O_NOFOLLOW);
        if (!(await source.stat()).isFile()) fail('CUSTOM_ARCHIVE_REQUIRED');
        await pipeline(source.createReadStream({autoClose: false}), createWriteStream(archive, {flags: 'wx', mode: 0o600}));
      } catch (error) {
        if (error instanceof DrillError) throw error;
        fail('ARCHIVE_READ_FAILED');
      } finally { await source?.close(); }
    }
    async function inspectArchive() {
      const handle = await open(archive, 'r');
      try {
        const magic = Buffer.alloc(5);
        if ((await handle.read(magic, 0, 5, 0)).bytesRead !== 5 || magic.toString() !== 'PGDMP') fail('CUSTOM_ARCHIVE_REQUIRED');
      } finally { await handle.close(); }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(archive)) hash.update(chunk);
      report.archive_sha256 = hash.digest('hex');
      if (manifest && manifest.archive_sha256 !== report.archive_sha256) fail('ARCHIVE_CHECKSUM_MISMATCH');
      const listing = await run('pg_restore', ['--list', archive]);
      report.archive_versions = {};
      for (const [key, pattern] of [['database', /;\s+Dumped from database version: ([0-9.]+)/], ['pg_dump', /;\s+Dumped by pg_dump version: ([0-9.]+)/]]) {
        const match = listing.match(pattern);
        if (match) report.archive_versions[key] = match[1];
      }
    }
    if (!options.synthetic) await inspectArchive();
    const data = join(workdir, 'data');
    const socket = join(workdir, 'socket');
    const {mkdir} = await import('node:fs/promises');
    await mkdir(socket, {mode: 0o700});
    await run('initdb', ['-D', data, '--username=abl_recovery', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C']);
    initialized = true;
    await appendFile(join(data, 'postgresql.conf'), `\nlisten_addresses = ''\nunix_socket_directories = '${socket}'\nunix_socket_permissions = 0700\nport = 5432\nmax_connections = 10\nshared_buffers = '16MB'\n`);
    startupAttempted = true;
    await run('pg_ctl', ['-D', data, '-l', join(workdir, 'postgres.log'), '-w', '-t', '20', 'start']);
    startedServer = true;
    const connection = ['--host', socket, '--port', '5432', '--username', 'abl_recovery', '--no-password'];
    const psql = (sql, database = 'postgres', user = 'abl_recovery') => run('psql', [...connection, '--username', user, '--dbname', database, '--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', sql]);
    const identity = JSON.parse(await psql("SELECT json_build_object('data',current_setting('data_directory'),'local',inet_server_addr() IS NULL,'user',session_user);"));
    if (identity.data !== data || !identity.local || identity.user !== 'abl_recovery') fail('ISOLATION_CHECK_FAILED');
    report.checks.private_local_cluster = true;
    await psql('CREATE ROLE abl_restore LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;');
    if (options.synthetic) {
      await psql('CREATE DATABASE synthetic_source OWNER abl_restore TEMPLATE template0;');
      await run('psql', [...connection, '--username', 'abl_restore', '--dbname', 'synthetic_source', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file', join(HERE, 'synthetic-fixture.sql')]);
      await run('pg_dump', [...connection, '--username', 'abl_restore', '--dbname', 'synthetic_source', '--format=custom', '--no-owner', '--no-acl', '--file', archive]);
      await inspectArchive();
    }
    await psql('CREATE DATABASE recovered OWNER abl_restore TEMPLATE template0;');
    const restoreStart = Date.now();
    await run('pg_restore', [...connection, '--username', 'abl_restore', '--dbname', 'recovered', '--no-owner', '--no-acl', '--no-tablespaces', '--no-publications', '--no-subscriptions', '--exit-on-error', '--single-transaction', archive], 600000);
    report.restore_duration_ms = Date.now() - restoreStart;
    report.checks.archive_restored = true;
    const schema = JSON.parse(await psql(schemaQuery(), 'recovered'));
    report.checks.required_schema_present = schema.missing_columns === 0;
    if (!report.checks.required_schema_present) {
      report.status = 'HOLD'; report.hold_reasons = ['UNSUPPORTED_SCHEMA'];
    } else {
      report.schema_signature_sha256 = sha256(schema.signature);
      const sql = await readFile(join(HERE, 'integrity.sql'), 'utf8');
      report.integrity_sql_sha256 = sha256(sql);
      const result = JSON.parse(await psql(sql, 'recovered'));
      report.checks = {...report.checks, ...result.checks};
      report.row_counts = result.row_counts;
      report.anomalies = result.anomalies;
      const expected = options.synthetic ? FIXTURE_COUNTS : manifest?.expected_counts;
      report.checks.count_manifest_matches = expected ? Object.keys(REQUIRED_COLUMNS).every(name => result.row_counts[name] === expected[name]) : null;
      if (manifest) report.backup_created_at = manifest.backup_created_at;
      const failed = Object.values(report.checks).some(value => value === false);
      report.hold_reasons = [];
      if (!expected) report.hold_reasons.push('INDEPENDENT_COUNT_MANIFEST_MISSING');
      if (Object.values(report.anomalies).some(value => value !== '0')) report.hold_reasons.push('EXISTING_DATA_OR_CONSTRAINT_ANOMALIES');
      report.status = failed ? 'FAIL' : report.hold_reasons.length ? 'HOLD' : 'PASS';
    }
  } catch (error) {
    report.status = 'FAIL';
    report.failure_code = error instanceof DrillError ? error.code : 'RECOVERY_TOOL_FAILED';
  } finally {
    if (workdir) {
      let safeToRemove = !startupAttempted;
      if (initialized && startupAttempted) {
        try {
          await command(paths.pg_ctl, ['-D', join(workdir, 'data'), '-m', 'immediate', '-w', '-t', '20', 'stop'], env, undefined, 30000);
          safeToRemove = true;
        } catch {
          // A failed startup may have left no server. Only remove after proving that.
          if (!startedServer) {
            try { await stat(join(workdir, 'data', 'postmaster.pid')); }
            catch (error) { if (error.code === 'ENOENT') safeToRemove = true; }
          }
        }
      }
      if (safeToRemove) {
        try { await rm(workdir, {recursive: true, force: true}); report.cleanup = 'PASS'; }
        catch { report.cleanup = 'FAIL'; }
      } else report.cleanup = 'FAIL';
      if (report.cleanup !== 'PASS') { report.status = 'FAIL'; report.failure_code = 'CLEANUP_FAILED'; }
    }
  }
  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - started;
  return report;
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(args); validateOptions(options); }
  catch (error) {
    process.stdout.write(JSON.stringify({format: 'abl-recovery-report-v1', status: 'FAIL', failure_code: error instanceof DrillError ? error.code : 'INVALID_ARGUMENTS'}) + '\n');
    return 1;
  }
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let report;
  try { report = await runDrill(options, {signal: abort.signal}); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  if (options.report) {
    try { await writeFile(options.report, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600}); }
    catch { report.status = 'FAIL'; report.failure_code = 'REPORT_WRITE_FAILED'; }
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  return report.status === 'PASS' ? 0 : report.status === 'HOLD' ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stdout.write('{"status":"FAIL","failure_code":"RECOVERY_TOOL_FAILED"}\n'); process.exitCode = 1;
  });
}
