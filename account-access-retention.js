import { createHash, randomUUID } from 'node:crypto';

// No HTTP route, startup hook, scheduler or default retention period. An
// independently approved policy and explicit digest-bound apply gate are needed.
export const RETENTION_BATCH_MAX = 200;
export class AccountAccessRetentionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new AccountAccessRetentionError(code); };
const reference = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,199}$/u.test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const policyKeys = ['schema_version','scope','status','policy_ref','approval_ref','operator_ref',
  'backup_procedure_ref','hold_review_ref','approved_at','expires_at','age_basis','disposal','retention_days'];

/** Validation is structural, NOT proof that a controller actually approved it.
 * Operators/reviewers must independently verify the referenced controlled record. */
export function validateAccountAccessRetentionPolicy(input, now = new Date()) {
  if (!exactKeys(input, policyKeys) || input.schema_version !== 1 || input.scope !== 'guest_account_access'
    || input.status !== 'approved' || input.age_basis !== 'last_updated_at' || input.disposal !== 'delete_request_row'
    || !exactKeys(input.retention_days, ['new','reviewing','closed'])) fail('ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED');
  for (const key of ['policy_ref','approval_ref','operator_ref','backup_procedure_ref','hold_review_ref']) {
    if (!reference(input[key])) fail('ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED');
  }
  for (const value of Object.values(input.retention_days)) {
    // Safety bounds only; these are NOT suggested/legal retention periods.
    if (!Number.isSafeInteger(value) || value < 1 || value > 36500) fail('ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED');
  }
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const at = new Date(now).getTime();
  if (!date(input.approved_at) || !date(input.expires_at) || !Number.isFinite(at)
    || Date.parse(input.approved_at) > at || Date.parse(input.expires_at) <= at
    || Date.parse(input.expires_at) <= Date.parse(input.approved_at)) fail('ACCOUNT_ACCESS_RETENTION_POLICY_REQUIRED');
  // Copy/canonicalize before awaiting: callers cannot mutate a validated policy.
  const policy = Object.fromEntries(policyKeys.map(key => [key, key === 'retention_days'
    ? Object.freeze(Object.fromEntries(['new','reviewing','closed'].map(status => [status,input.retention_days[status]]))) : input[key]]));
  const digest = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  return Object.freeze({ policy: Object.freeze(policy), digest });
}

export function requireAccountAccessRetentionApply(digest, env = process.env) {
  if (env.ACCOUNT_ACCESS_RETENTION_ENABLED !== 'true'
    || env.ACCOUNT_ACCESS_RETENTION_POLICY_SHA256 !== digest) fail('ACCOUNT_ACCESS_RETENTION_APPLY_DISABLED');
}

async function inTransaction(pool, readOnly, work) {
  let client;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AccountAccessRetentionError) throw error;
    // Do not leak SQL, connection strings, row contents or raw errors in jobs/logs.
    throw new AccountAccessRetentionError('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');
  } finally { client?.release(); }
}

/** Explicit migration only; never run during dry-run or application startup. */
export async function initializeAccountAccessRetention(pool, input, { env = process.env } = {}) {
  const { policy, digest } = validateAccountAccessRetentionPolicy(input);
  requireAccountAccessRetentionApply(digest, env);
  return inTransaction(pool, false, async client => {
    const clock = await client.query('SELECT CURRENT_TIMESTAMP AS now');
    if (!clock.rows[0]?.now) fail('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');
    validateAccountAccessRetentionPolicy(policy, clock.rows[0].now);
    await client.query('SELECT pg_advisory_xact_lock(815, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guest_account_access_retention_holds (
        request_id BIGINT PRIMARY KEY REFERENCES guest_account_access_requests(id) ON DELETE RESTRICT,
        hold_ref TEXT NOT NULL CHECK (char_length(hold_ref) BETWEEN 1 AND 200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS guest_account_access_retention_runs (
        run_id UUID PRIMARY KEY,
        policy_digest TEXT NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
        deleted_count INTEGER NOT NULL CHECK (deleted_count BETWEEN 0 AND 200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    return { initialized: true, policy_digest: digest };
  });
}

const eligible = `FROM guest_account_access_requests r
  WHERE r.updated_at < CURRENT_TIMESTAMP -
    (CASE r.status WHEN 'new' THEN $1::integer WHEN 'reviewing' THEN $2::integer WHEN 'closed' THEN $3::integer END) * INTERVAL '1 day'
    AND NOT EXISTS (SELECT 1 FROM guest_account_access_retention_holds h WHERE h.request_id=r.id)
  ORDER BY r.updated_at,r.id LIMIT $4`;

/** One bounded batch. Dry-run is a genuinely read-only transaction and emits
 * aggregate counts only. It cannot create tables or delete rows. Apply locks
 * current rows; concurrent triage rows are skipped and must be reconsidered later.
 * The FK hold is a second safety barrier even for out-of-band hold insertion. */
export async function runAccountAccessRetention(pool, input, { mode = 'dry-run', batchSize = 50, env = process.env } = {}) {
  if (!['dry-run','apply'].includes(mode) || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > RETENTION_BATCH_MAX) {
    fail('ACCOUNT_ACCESS_RETENTION_OPTIONS_INVALID');
  }
  const { policy, digest } = validateAccountAccessRetentionPolicy(input);
  if (mode === 'apply') requireAccountAccessRetentionApply(digest, env);
  return inTransaction(pool, mode === 'dry-run', async client => {
    const clock = await client.query('SELECT CURRENT_TIMESTAMP AS now');
    if (!clock.rows[0]?.now) fail('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');
    validateAccountAccessRetentionPolicy(policy, clock.rows[0].now);
    const days = ['new','reviewing','closed'].map(status => policy.retention_days[status]);
    if (mode === 'dry-run') {
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM (SELECT r.id ${eligible}) candidates`, [...days, batchSize + 1]);
      const count = result.rows[0]?.count;
      if (!Number.isInteger(count) || count < 0 || count > batchSize + 1) fail('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');
      return { mode, policy_digest: digest, eligible_up_to_batch: Math.min(count,batchSize), more_eligible: count > batchSize, batch_limit: batchSize };
    }
    // Serialize this worker with other retention workers, not the whole app.
    // Holds are never removed by this job, and no other support/account table is touched.
    await client.query('SELECT pg_advisory_xact_lock(815, 1)');
    const result = await client.query(`WITH candidates AS (SELECT r.id ${eligible} FOR UPDATE OF r SKIP LOCKED),
      deleted AS (DELETE FROM guest_account_access_requests r USING candidates c WHERE r.id=c.id RETURNING r.id)
      SELECT COUNT(*)::int AS count FROM deleted`, [...days, batchSize]);
    const count = result.rows[0]?.count;
    if (!Number.isInteger(count) || count < 0 || count > batchSize) fail('ACCOUNT_ACCESS_RETENTION_UNAVAILABLE');
    const runId = randomUUID();
    // Atomic evidence: an unavailable audit table rolls back deletion completely.
    await client.query('INSERT INTO guest_account_access_retention_runs(run_id,policy_digest,deleted_count) VALUES($1,$2,$3)', [runId,digest,count]);
    return { mode, policy_digest: digest, run_id: runId, deleted: count, batch_limit: batchSize };
  });
}
