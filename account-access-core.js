import { createHmac } from 'node:crypto';

export const ACCOUNT_ACCESS_REASONS = Object.freeze(['sign_in', 'password_reset', 'email_verification', 'lost_email', 'other_access']);
export const ACCOUNT_ACCESS_STATUSES = Object.freeze(['new', 'reviewing', 'closed']);
export const ACCOUNT_ACCESS_ACK = Object.freeze({ ok: true, message: 'Your account-access request has been saved for private review. This does not confirm an account exists or change access. No response time is guaranteed.' });
export const ACCOUNT_ACCESS_LIMITS = Object.freeze({ global: 300, source: 60, contact: 3 });

export class AccountAccessError extends Error {
  constructor(status, code, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
const invalid = () => new AccountAccessError(400, 'ACCOUNT_ACCESS_INVALID', 'Check the contact email, reason and message. Do not include attachments, passwords or recovery codes.');
const unavailable = () => new AccountAccessError(503, 'ACCOUNT_ACCESS_UNAVAILABLE', 'The request could not be saved. Please try again later.');

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw invalid();
  const result = value.trim();
  if (required && !result) throw invalid();
  return result;
}

export function validateAccountAccessInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const allowed = new Set(['contact_email', 'name', 'reason', 'message', 'website']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw invalid();
  if (text(input.website ?? '', 200)) throw invalid(); // Reject traps honestly; never fake a saved request.
  const contactEmail = text(input.contact_email, 254, true).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(contactEmail)) throw invalid();
  const name = text(input.name ?? '', 80);
  if (/[\r\n]/u.test(name)) throw invalid();
  const reason = text(input.reason, 32, true);
  if (!ACCOUNT_ACCESS_REASONS.includes(reason)) throw invalid();
  const message = text(input.message, 2000, true);
  if ([...message].length < 20) throw invalid();
  return { contactEmail, name, reason, message };
}

export function accountAccessDigest(secret, purpose, value) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw unavailable();
  return createHmac('sha256', secret).update(purpose).update('\0').update(value).digest('hex');
}

export async function ensureAccountAccessSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_account_access_requests (
      id BIGSERIAL PRIMARY KEY,
      contact_email TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
      display_name TEXT NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80),
      reason TEXT NOT NULL CHECK (reason IN ('sign_in','password_reset','email_verification','lost_email','other_access')),
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 20 AND 2000),
      dedupe_key TEXT NOT NULL UNIQUE CHECK (char_length(dedupe_key) = 64),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','closed')),
      staff_note TEXT NOT NULL DEFAULT '' CHECK (char_length(staff_note) <= 1000),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS guest_account_access_queue_idx ON guest_account_access_requests(status,id DESC);
    CREATE TABLE IF NOT EXISTS guest_account_access_limits (
      subject_key TEXT NOT NULL CHECK (char_length(subject_key) = 64),
      window_start TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL CHECK (attempts > 0),
      PRIMARY KEY(subject_key,window_start)
    );
    CREATE INDEX IF NOT EXISTS guest_account_access_limits_expiry_idx ON guest_account_access_limits(window_start);
  `);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function submitAccountAccess(pool, input, { secret, source } = {}) {
  const data = validateAccountAccessInput(input);
  const subjects = [
    ['global', 'all', ACCOUNT_ACCESS_LIMITS.global],
    ['source', String(source || 'unknown').slice(0,200), ACCOUNT_ACCESS_LIMITS.source],
    ['contact', data.contactEmail, ACCOUNT_ACCESS_LIMITS.contact]
  ].map(([kind, value, limit]) => ({ key: accountAccessDigest(secret, kind, value), limit }));
  return transaction(pool, async client => {
    // Consistent lock order (global, source, contact) prevents cross-bucket deadlocks.
    // PostgreSQL clocks and atomic upserts share limits across processes/replicas.
    let day;
    for (const { key, limit } of subjects) {
      const result = await client.query(`
        INSERT INTO guest_account_access_limits(subject_key,window_start,attempts)
        VALUES($1,date_trunc('hour',NOW()),1)
        ON CONFLICT(subject_key,window_start) DO UPDATE
          SET attempts=LEAST(guest_account_access_limits.attempts+1,$2+1)
        RETURNING attempts,
          to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
          GREATEST(1,CEIL(EXTRACT(EPOCH FROM date_trunc('hour',NOW())+INTERVAL '1 hour'-NOW())))::int AS retry_after
      `, [key, limit]);
      const row = result.rows[0];
      if (!row || !row.day || !Number.isFinite(Number(row.attempts))) throw unavailable();
      if (Number(row.attempts) > limit) throw new AccountAccessError(429, 'ACCOUNT_ACCESS_RATE_LIMIT', 'Too many requests. Please wait before trying again.', Number(row.retry_after) || 3600);
      day = row.day;
    }
    const dedupe = accountAccessDigest(secret, 'submission', JSON.stringify([day, data.contactEmail, data.name, data.reason, data.message]));
    await client.query(`
      INSERT INTO guest_account_access_requests(contact_email,display_name,reason,message,dedupe_key)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING
    `, [data.contactEmail, data.name, data.reason, data.message, dedupe]);
    await client.query("DELETE FROM guest_account_access_limits WHERE window_start < NOW()-INTERVAL '2 days'");
    // No account query, user-controlled account/territory association, email delivery,
    // credentials or recovery action is performed. Acknowledgement follows COMMIT.
    return { ...ACCOUNT_ACCESS_ACK };
  });
}

export function isUnscopedSupportAssignment(assignment) {
  if (!assignment || assignment.territory_id != null) return false;
  return assignment.admin_role === 'super_admin' || assignment.effective_rank === 'super_admin' || assignment.country_code === 'PH';
}

export function accountAccessId(value) {
  const raw = String(value ?? '');
  if (!/^[1-9]\d{0,14}$/u.test(raw)) throw invalid();
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw invalid();
  return id;
}

export function validateAccountAccessTriage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['status','note','revision'].includes(k))) throw invalid();
  if (!ACCOUNT_ACCESS_STATUSES.includes(input.status) || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision >= 2147483647) throw invalid();
  return { status: input.status, note: text(input.note ?? '', 1000), revision: input.revision };
}

async function audit(client, actor, event, target, before = null, after = null) {
  // Fail closed: unlike best-effort telemetry, a failed private-read/update audit
  // must prevent returning evidence or committing a triage change.
  await client.query(`
    INSERT INTO admin_audit_events(actor_account_id,assignment_id,permission_code,country_code,target_type,target_id,event_code,before_json,after_json)
    VALUES($1,$2,'support.manage','PH','guest_account_access',$3,$4,$5::jsonb,$6::jsonb)
  `, [actor.accountId, actor.assignmentId, String(target), event, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]);
}

export async function listAccountAccess(pool, actor, { before, status = 'new' } = {}) {
  if (!ACCOUNT_ACCESS_STATUSES.includes(status) && status !== 'all') throw invalid();
  const cursor = before == null || before === '' ? null : accountAccessId(before);
  return transaction(pool, async client => {
    const result = await client.query(`
      SELECT id,reason,status,revision,created_at,updated_at FROM guest_account_access_requests
      WHERE ($1::bigint IS NULL OR id<$1) AND ($2='all' OR status=$2)
      ORDER BY id DESC LIMIT 26
    `, [cursor, status]);
    await audit(client, actor, 'account_access_queue_read', 'queue');
    const items = result.rows.slice(0,25);
    return { items, next_cursor: result.rows.length > 25 ? String(items.at(-1).id) : null };
  });
}

export async function readAccountAccess(pool, actor, value) {
  const id = accountAccessId(value);
  return transaction(pool, async client => {
    const result = await client.query('SELECT id,contact_email,display_name,reason,message,status,staff_note,revision,created_at,updated_at FROM guest_account_access_requests WHERE id=$1', [id]);
    if (!result.rows[0]) throw new AccountAccessError(404, 'ACCOUNT_ACCESS_NOT_FOUND', 'Request not found.');
    await audit(client, actor, 'account_access_request_read', id);
    return result.rows[0];
  });
}

export async function triageAccountAccess(pool, actor, value, input) {
  const id = accountAccessId(value);
  const data = validateAccountAccessTriage(input);
  return transaction(pool, async client => {
    const result = await client.query('SELECT status,revision FROM guest_account_access_requests WHERE id=$1 FOR UPDATE', [id]);
    const previous = result.rows[0];
    if (!previous) throw new AccountAccessError(404, 'ACCOUNT_ACCESS_NOT_FOUND', 'Request not found.');
    if (Number(previous.revision) !== data.revision) throw new AccountAccessError(409, 'ACCOUNT_ACCESS_CHANGED', 'Another staff member updated this request. Reload before saving.');
    const updated = await client.query(`
      UPDATE guest_account_access_requests SET status=$2,staff_note=$3,revision=revision+1,updated_at=NOW()
      WHERE id=$1 RETURNING id,status,revision,updated_at
    `, [id, data.status, data.note]);
    await audit(client, actor, 'account_access_request_triaged', id, { status: previous.status, revision: Number(previous.revision) }, { status: data.status, revision: data.revision+1 });
    return updated.rows[0];
  });
}
