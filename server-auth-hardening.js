import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendTransientEmailNotification } from './notification-core.js';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.INTERNAL_INCIDENTS_PORT || 3907);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const APP_PIN = process.env.APP_PIN || '';
const OWNER_MIGRATION_ENABLED = process.env.OWNER_MIGRATION_ENABLED === 'true';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const AUTH_EMAIL_PROVIDER = String(process.env.AUTH_EMAIL_PROVIDER || '').toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const AUTH_FROM_EMAIL = process.env.AUTH_FROM_EMAIL || '';
const AUTH_PUBLIC_BASE_URL = String(process.env.AUTH_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const PREVIEW_SHOW_LINK = process.env.AUTH_PREVIEW_SHOW_LINK === 'true';
const RESET_TTL_MIN = Math.max(10, Math.min(60, Number(process.env.AUTH_RESET_TTL_MIN || 20)));
const VERIFY_TTL_HOURS = Math.max(1, Math.min(72, Number(process.env.AUTH_VERIFY_TTL_HOURS || 24)));
const jsonBody = express.json({ limit: '450kb' });
const attempts = new Map();
let child;
let shuttingDown = false;

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function normalizeEmail(value) { return clean(value, 160).toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function passwordOkay(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 160; }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function randomSecret(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function safeTextEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function safeHexEqual(a, b) {
  try { const aa = Buffer.from(String(a), 'hex'); const bb = Buffer.from(String(b), 'hex'); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); } catch { return false; }
}
function isLegacyBearer(token = '') { return token && token.split('.').length === 3; }
function requestIpHash(req) { return sha256(req.ip || req.headers['x-forwarded-for'] || 'unknown'); }
function throttled(req, key, max = 6, windowMs = 15 * 60_000) {
  const id = `${requestIpHash(req)}:${sha256(key)}`; const now = Date.now();
  const state = attempts.get(id) || { count: 0, first: now };
  if (now - state.first > windowMs) { state.count = 0; state.first = now; }
  if (state.count >= max) return true;
  state.count += 1; attempts.set(id, state); return false;
}
function publicBase(req) {
  if (AUTH_PUBLIC_BASE_URL) return AUTH_PUBLIC_BASE_URL;
  const proto = clean(req.headers['x-forwarded-proto'] || req.protocol || 'https', 12).split(',')[0];
  const host = clean(req.headers['x-forwarded-host'] || req.headers.host || '', 240).split(',')[0];
  return `${proto}://${host}`.replace(/\/$/, '');
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}
function signAccountToken(accountId, sessionId) {
  const payload = `v2.${Date.now()}.${accountId}.${sessionId}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
async function createSession(accountId, req) {
  const sessionId = crypto.randomUUID();
  await pool.query(`INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash) VALUES($1,$2,NOW()+INTERVAL '24 hours',$3,$4)`, [sessionId, accountId, clean(req.headers['user-agent'], 400), requestIpHash(req)]);
  return { sessionId, token: signAccountToken(accountId, sessionId) };
}
async function resolveV2(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (!TOKEN_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v2') return null;
  const issued = Number(parts[1]), accountId = Number(parts[2]), sessionId = parts[3];
  if (!Number.isFinite(issued) || !Number.isInteger(accountId) || accountId < 1 || Date.now() - issued > 24 * 60 * 60_000 || issued > Date.now() + 60_000) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(parts.slice(0, 4).join('.')).digest('hex');
  if (!safeHexEqual(parts[4], expected)) return null;
  const q = await pool.query(`SELECT account_id FROM account_sessions WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`, [sessionId, accountId]);
  return q.rowCount ? { accountId, sessionId } : null;
}
async function requireV2(req) {
  const session = await resolveV2(req);
  if (!session) throw Object.assign(new Error('Sign in again to continue'), { status: 401 });
  return session;
}
async function audit(accountId, eventCode, req, detail = {}) {
  await pool.query(`INSERT INTO auth_security_events(account_id,event_code,ip_hash,user_agent,detail_json) VALUES($1,$2,$3,$4,$5::jsonb)`, [accountId || null, clean(eventCode, 80), requestIpHash(req), clean(req.headers['user-agent'], 400), JSON.stringify(detail)]).catch(() => {});
}

async function initDb() {
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legacy_pin_retired_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS auth_action_tokens (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(purpose IN ('reset_password','verify_email'))
    );
    CREATE INDEX IF NOT EXISTS auth_action_tokens_lookup_idx ON auth_action_tokens(purpose,token_hash,expires_at);
    CREATE TABLE IF NOT EXISTS account_auth_identities (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      provider_email_snapshot TEXT NOT NULL DEFAULT '',
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      UNIQUE(provider,provider_subject)
    );
    CREATE INDEX IF NOT EXISTS account_auth_identities_account_idx ON account_auth_identities(account_id,provider);
    CREATE TABLE IF NOT EXISTS auth_oauth_states (
      state_hash TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(mode IN ('sign_in','link'))
    );
    CREATE TABLE IF NOT EXISTS auth_handoffs (
      code_hash TEXT PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS auth_email_deliveries (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      template_code TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      recipient_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      provider_reference TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS auth_security_events (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      event_code TEXT NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS auth_security_events_account_idx ON auth_security_events(account_id,created_at DESC);
  `);
}

async function issueActionToken(accountId, purpose, ttlExpression) {
  const raw = randomSecret(32), hash = sha256(raw);
  await pool.query(`UPDATE auth_action_tokens SET used_at=NOW() WHERE account_id=$1 AND purpose=$2 AND used_at IS NULL`, [accountId, purpose]);
  await pool.query(`INSERT INTO auth_action_tokens(account_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,NOW()+${ttlExpression})`, [accountId, purpose, hash]);
  return raw;
}
async function consumeActionToken(raw, purpose, callback) {
  const hash = sha256(raw); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT * FROM auth_action_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`, [hash, purpose]);
    if (!q.rowCount) throw Object.assign(new Error('This link is invalid or has expired'), { status: 400 });
    const token = q.rows[0];
    await callback(client, token);
    await client.query(`UPDATE auth_action_tokens SET used_at=NOW() WHERE id=$1`, [token.id]);
    await client.query('COMMIT');
    return token;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
async function recordEmail(accountId, template, recipient, status, provider = '', reference = '', error = '') {
  await pool.query(`INSERT INTO auth_email_deliveries(account_id,template_code,provider,recipient_hash,status,provider_reference,error_code,delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='sent' THEN NOW() END)`, [accountId, template, provider, sha256(normalizeEmail(recipient)), status, clean(reference, 300), clean(error, 300)]).catch(() => {});
}
async function sendEmail({ accountId, to, subject, html, template }) {
  const eventCode=template==='password_reset'?'auth.password_reset':'auth.email_verification';
  const eventKey=`auth:${template}:${accountId}:${Date.now()}:${crypto.randomBytes(5).toString('hex')}`;
  const safeBody=template==='password_reset'
    ?'Password reset instructions were requested for your account.'
    :'Email verification instructions were requested for your account.';
  const result=await sendTransientEmailNotification(pool,{
    eventKey,eventCode,accountId,to,subject,html,category:'security',priority:'high',
    data:{title:subject,body:safeBody}
  });
  await recordEmail(accountId,template,to,result.sent?'sent':result.not_configured?'not_configured':'failed',result.sent?'resend':AUTH_EMAIL_PROVIDER||'none',result.reference||'',result.sent?'':result.not_configured?'provider_not_configured':'notification_delivery_failed');
  return {sent:Boolean(result.sent)};
}
async function ownerMigrationRequired() {
  const q = await pool.query(`SELECT email,(password_hash IS NOT NULL) has_password,legacy_pin_retired_at FROM accounts WHERE id=1`);
  const row = q.rows[0];
  return !row || !validEmail(row.email) || !row.has_password || !row.legacy_pin_retired_at;
}
async function maybeRetireOwnerPin(accountId) {
  if (Number(accountId) !== 1) return;
  await pool.query(`UPDATE accounts SET legacy_pin_retired_at=COALESCE(legacy_pin_retired_at,NOW()),updated_at=NOW() WHERE id=1 AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL AND email<>''`);
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); const u = await fetch(`http://127.0.0.1:${upstreamPort}/health`); res.status(u.ok ? 200 : 503).json({ ok: u.ok, db: true, incidents: u.ok, version: '0.8.5-auth-hardening' }); }
  catch { res.status(503).json({ ok: false, db: false, incidents: false, version: '0.8.5-auth-hardening' }); }
});
app.get('/auth-hardening.css', (_req, res) => res.type('text/css').send(readFileSync(join(__dirname, 'public', 'auth-hardening.css'), 'utf8')));
app.get('/auth-hardening-ui.js', (_req, res) => res.type('application/javascript').send(readFileSync(join(__dirname, 'public', 'auth-hardening-ui.js'), 'utf8')));
async function root(req, res) {
  const r = await fetch(`http://127.0.0.1:${upstreamPort}${req.path}`, { headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } });
  let html = await r.text();
  html = html.replace('<form id="loginForm"', '<div id="modernAuthRoot"></div><form id="loginForm"');
  html = html.replace('</head>', '  <link rel="stylesheet" href="/auth-hardening.css" />\n</head>')
             .replace('</body>', '  <script type="module" src="/auth-hardening-ui.js"></script>\n</body>');
  res.status(r.status).type('html').send(html);
}
app.get('/', root); app.get('/index.html', root);

app.get('/api/auth/hardening/status', async (_req, res, next) => {
  try {
    // Public authentication capability only. Bootstrap-owner lifecycle state is intentionally not exposed.
    res.json({
      google_enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      email_delivery_configured: AUTH_EMAIL_PROVIDER === 'resend' && Boolean(RESEND_API_KEY && AUTH_FROM_EMAIL),
      preview_link_enabled: PREVIEW_SHOW_LINK
    });
  } catch (e) { next(e); }
});

app.post('/api/auth/forgot-password', jsonBody, async (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  const generic = { ok: true, message: 'If an eligible account exists, password reset instructions have been prepared.' };
  try {
    if (!validEmail(email) || throttled(req, `forgot:${email}`, 5, 30 * 60_000)) return res.json(generic);
    const q = await pool.query(`SELECT id,email,auth_status FROM accounts WHERE LOWER(email)=$1`, [email]);
    if (!q.rowCount || q.rows[0].auth_status !== 'active') return res.json(generic);
    const account = q.rows[0];
    const token = await issueActionToken(account.id, 'reset_password', `INTERVAL '${RESET_TTL_MIN} minutes'`);
    const link = `${publicBase(req)}/?reset_token=${encodeURIComponent(token)}`;
    await sendEmail({ accountId: account.id, to: account.email, template: 'password_reset', subject: 'Reset your Business & Life password', html: `<p>Use this secure link to reset your password. It expires in ${RESET_TTL_MIN} minutes.</p><p><a href="${link}">Reset password</a></p>` });
    await audit(account.id, 'password_reset_requested', req);
    if (PREVIEW_SHOW_LINK) generic.preview_reset_url = link;
    res.json(generic);
  } catch (e) { next(e); }
});

app.post('/api/auth/reset-password', jsonBody, async (req, res, next) => {
  const token = clean(req.body?.token, 300), password = String(req.body?.new_password || '');
  if (!token || !passwordOkay(password)) return res.status(400).json({ error: 'A valid reset link and password of at least 8 characters are required' });
  try {
    const { salt, hash } = await hashPassword(password);
    const used = await consumeActionToken(token, 'reset_password', async (client, row) => {
      await client.query(`UPDATE accounts SET password_salt=$1,password_hash=$2,updated_at=NOW() WHERE id=$3`, [salt, hash, row.account_id]);
      await client.query(`UPDATE account_sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL`, [row.account_id]);
    });
    await maybeRetireOwnerPin(used.account_id);
    await audit(used.account_id, 'password_reset_completed', req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/auth/email-verification/request', jsonBody, async (req, res, next) => {
  try {
    const session = await requireV2(req); if (throttled(req, `verify:${session.accountId}`, 5, 30 * 60_000)) return res.status(429).json({ error: 'Please wait before requesting another verification message' });
    const q = await pool.query(`SELECT email,email_verified_at FROM accounts WHERE id=$1`, [session.accountId]); const a = q.rows[0];
    if (!a || !validEmail(a.email)) return res.status(409).json({ error: 'Add a valid email address first' });
    if (a.email_verified_at) return res.json({ ok: true, already_verified: true });
    const token = await issueActionToken(session.accountId, 'verify_email', `INTERVAL '${VERIFY_TTL_HOURS} hours'`);
    const link = `${publicBase(req)}/?verify_token=${encodeURIComponent(token)}`;
    await sendEmail({ accountId: session.accountId, to: a.email, template: 'verify_email', subject: 'Verify your Business & Life email', html: `<p>Verify your email for Business & Life.</p><p><a href="${link}">Verify email</a></p>` });
    await audit(session.accountId, 'email_verification_requested', req);
    const result = { ok: true, message: 'Verification instructions have been prepared.' }; if (PREVIEW_SHOW_LINK) result.preview_verify_url = link; res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/auth/email-verification/verify', jsonBody, async (req, res, next) => {
  const token = clean(req.body?.token, 300); if (!token) return res.status(400).json({ error: 'Verification token is required' });
  try {
    const used = await consumeActionToken(token, 'verify_email', async (client, row) => client.query(`UPDATE accounts SET email_verified_at=COALESCE(email_verified_at,NOW()),updated_at=NOW() WHERE id=$1`, [row.account_id]));
    await maybeRetireOwnerPin(used.account_id); await audit(used.account_id, 'email_verified', req); res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/auth/owner-migrate', jsonBody, async (req, res, next) => {
  // Bootstrap recovery is infrastructure-gated and never part of the public login experience.
  if (!OWNER_MIGRATION_ENABLED) return res.status(404).json({ error: 'Not found' });
  const pin = String(req.body?.pin || ''), email = normalizeEmail(req.body?.email), password = String(req.body?.password || ''), displayName = clean(req.body?.display_name, 120);
  try {
    if (!(await ownerMigrationRequired())) return res.status(410).json({ error: 'Owner migration is already retired. Use email/password recovery.' });
    const q = await pool.query(`SELECT legacy_pin_retired_at FROM accounts WHERE id=1`); if (q.rows[0]?.legacy_pin_retired_at) return res.status(410).json({ error: 'Owner PIN migration is already retired. Use email/password recovery.' });
    if (!APP_PIN || !safeTextEqual(pin, APP_PIN)) { await audit(1, 'owner_migration_failed', req); return res.status(401).json({ error: 'Owner migration credential is incorrect' }); }
    if (!validEmail(email) || !passwordOkay(password)) return res.status(400).json({ error: 'Valid email and password of at least 8 characters are required' });
    const dup = await pool.query(`SELECT id FROM accounts WHERE LOWER(email)=$1 AND id<>1`, [email]); if (dup.rowCount) return res.status(409).json({ error: 'That email already belongs to another account' });
    const { salt, hash } = await hashPassword(password);
    await pool.query(`UPDATE accounts SET email=$1,password_salt=$2,password_hash=$3,display_name=COALESCE(NULLIF($4,''),display_name),email_verified_at=NULL,updated_at=NOW() WHERE id=1`, [email, salt, hash, displayName]);
    const verifyToken = await issueActionToken(1, 'verify_email', `INTERVAL '${VERIFY_TTL_HOURS} hours'`); const verifyLink = `${publicBase(req)}/?verify_token=${encodeURIComponent(verifyToken)}`;
    await sendEmail({ accountId: 1, to: email, template: 'verify_email', subject: 'Verify your Business & Life owner email', html: `<p>Complete the owner security migration by verifying your email.</p><p><a href="${verifyLink}">Verify owner email</a></p>` });
    await audit(1, 'owner_migration_password_set', req);
    const result = { ok: true, message: 'Owner email/password configured. Verify the email to permanently retire the legacy PIN.' }; if (PREVIEW_SHOW_LINK) result.preview_verify_url = verifyLink; res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/auth/sessions/revoke-others', jsonBody, async (req, res, next) => {
  try { const s = await requireV2(req); await pool.query(`UPDATE account_sessions SET revoked_at=NOW() WHERE account_id=$1 AND session_id<>$2 AND revoked_at IS NULL`, [s.accountId, s.sessionId]); await audit(s.accountId, 'other_sessions_revoked', req); res.json({ ok: true }); } catch (e) { next(e); }
});
app.get('/api/auth/identities', async (req, res, next) => {
  try { const s = await requireV2(req); const q = await pool.query(`SELECT provider,provider_email_snapshot,linked_at FROM account_auth_identities WHERE account_id=$1 AND revoked_at IS NULL ORDER BY linked_at`, [s.accountId]); res.json(q.rows); } catch (e) { next(e); }
});

function googleEnabled() { return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET); }
async function startGoogle(req, res, mode) {
  if (!googleEnabled()) return res.status(503).send('Google sign-in is not configured yet.');
  let accountId = null; if (mode === 'link') accountId = (await requireV2(req)).accountId;
  const state = randomSecret(28); await pool.query(`INSERT INTO auth_oauth_states(state_hash,mode,account_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')`, [sha256(state), mode, accountId]);
  const redirectUri = `${publicBase(req)}/api/auth/google/callback`;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', GOOGLE_CLIENT_ID); u.searchParams.set('redirect_uri', redirectUri); u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', 'openid email profile'); u.searchParams.set('state', state); u.searchParams.set('prompt', 'select_account');
  res.redirect(302, u.toString());
}
app.get('/api/auth/google/start', (req, res, next) => startGoogle(req, res, 'sign_in').catch(next));
app.get('/api/auth/google/link/start', (req, res, next) => startGoogle(req, res, 'link').catch(next));
app.get('/api/auth/google/callback', async (req, res) => {
  const base = publicBase(req); const state = clean(req.query.state, 300), code = clean(req.query.code, 1500);
  try {
    if (!state || !code || !googleEnabled()) throw new Error('Google authentication could not be completed');
    const client = await pool.connect(); let st;
    try { await client.query('BEGIN'); const q = await client.query(`SELECT * FROM auth_oauth_states WHERE state_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`, [sha256(state)]); if (!q.rowCount) throw new Error('Google sign-in session expired'); st = q.rows[0]; await client.query(`UPDATE auth_oauth_states SET used_at=NOW() WHERE state_hash=$1`, [sha256(state)]); await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    const redirectUri = `${base}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const tokens = await tokenRes.json().catch(() => ({})); if (!tokenRes.ok || !tokens.access_token) throw new Error('Google token exchange failed');
    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } }); const user = await userRes.json().catch(() => ({}));
    if (!userRes.ok || !user.sub || !user.email || user.email_verified !== true) throw new Error('Google did not provide a verified email identity');
    const email = normalizeEmail(user.email); let accountId;
    if (st.mode === 'link') {
      accountId = Number(st.account_id); const used = await pool.query(`SELECT account_id FROM account_auth_identities WHERE provider='google' AND provider_subject=$1 AND revoked_at IS NULL`, [String(user.sub)]); if (used.rowCount && Number(used.rows[0].account_id) !== accountId) throw new Error('This Google account is already linked to another Business & Life account');
      await pool.query(`INSERT INTO account_auth_identities(account_id,provider,provider_subject,provider_email_snapshot) VALUES($1,'google',$2,$3) ON CONFLICT(provider,provider_subject) DO UPDATE SET revoked_at=NULL,provider_email_snapshot=EXCLUDED.provider_email_snapshot`, [accountId, String(user.sub), email]);
      await pool.query(`UPDATE accounts SET email_verified_at=CASE WHEN LOWER(email)=$1 THEN COALESCE(email_verified_at,NOW()) ELSE email_verified_at END WHERE id=$2`, [email, accountId]);
    } else {
      const identity = await pool.query(`SELECT account_id FROM account_auth_identities WHERE provider='google' AND provider_subject=$1 AND revoked_at IS NULL`, [String(user.sub)]);
      if (identity.rowCount) accountId = Number(identity.rows[0].account_id);
      else {
        const existing = await pool.query(`SELECT id FROM accounts WHERE LOWER(email)=$1`, [email]);
        if (existing.rowCount) return res.redirect(302, `${base}/?oauth_error=existing_email`);
        const c = await pool.connect(); try { await c.query('BEGIN'); const a = await c.query(`INSERT INTO accounts(display_name,email,active_role,email_verified_at,auth_status) VALUES($1,$2,'customer',NOW(),'active') RETURNING id`, [clean(user.name || email.split('@')[0], 120), email]); accountId = Number(a.rows[0].id); await c.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,'customer',TRUE,'private','active')`, [accountId]); await c.query(`INSERT INTO customer_profiles(account_id) VALUES($1)`, [accountId]); await c.query(`INSERT INTO account_auth_identities(account_id,provider,provider_subject,provider_email_snapshot) VALUES($1,'google',$2,$3)`, [accountId, String(user.sub), email]); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      }
    }
    await maybeRetireOwnerPin(accountId); await audit(accountId, st.mode === 'link' ? 'google_identity_linked' : 'google_sign_in', req);
    const handoff = randomSecret(28); await pool.query(`INSERT INTO auth_handoffs(code_hash,account_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '5 minutes')`, [sha256(handoff), accountId]);
    res.redirect(302, `${base}/?oauth_handoff=${encodeURIComponent(handoff)}`);
  } catch (e) { console.error(e); res.redirect(302, `${base}/?oauth_error=google_failed`); }
});
app.post('/api/auth/oauth/handoff', jsonBody, async (req, res, next) => {
  const code = clean(req.body?.code, 300); if (!code) return res.status(400).json({ error: 'OAuth handoff code is required' });
  const client = await pool.connect(); try { await client.query('BEGIN'); const q = await client.query(`SELECT * FROM auth_handoffs WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`, [sha256(code)]); if (!q.rowCount) throw Object.assign(new Error('Google sign-in handoff expired'), { status: 400 }); const row = q.rows[0]; await client.query(`UPDATE auth_handoffs SET used_at=NOW() WHERE code_hash=$1`, [sha256(code)]); await client.query('COMMIT'); const session = await createSession(row.account_id, req); res.json({ token: session.token }); } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

app.use('/api', async (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') return res.status(410).json({ error: 'PIN login has been retired from the public app. Use email/password or account recovery.' });
  const raw = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (isLegacyBearer(raw)) return res.status(401).json({ error: 'Legacy PIN session expired. Sign in with your email account.' });
  next();
});

function proxy(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  const up = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.originalUrl, method: req.method, headers }, ur => { res.statusCode = ur.statusCode || 502; for (const [k, v] of Object.entries(ur.headers)) if (v !== undefined) res.setHeader(k, v); ur.pipe(res); });
  up.on('error', e => { console.error(e); if (!res.headersSent) res.status(502).json({ error: 'Application upstream unavailable' }); }); req.pipe(up);
}
app.use(proxy);
app.use((err, _req, res, _next) => { console.error(err); if (res.headersSent) return; res.status(err.status || 500).json({ error: err.status ? err.message : 'Unexpected authentication error' }); });

function start() { child = spawn(process.execPath, ['server-incidents.js'], { cwd: __dirname, env: { ...process.env, PORT: String(upstreamPort) }, stdio: 'inherit' }); child.on('exit', code => { if (!shuttingDown) { console.error(`Incident child exited ${code}`); process.exit(code || 1); } }); }
async function wait() { for (let i = 0; i < 180; i++) { try { const r = await fetch(`http://127.0.0.1:${upstreamPort}/health`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); } throw new Error('Incident child failed health check'); }
async function shutdown(sig) { if (shuttingDown) return; shuttingDown = true; console.log(`Received ${sig}`); if (child && !child.killed) child.kill('SIGTERM'); await pool.end().catch(() => {}); process.exit(0); }
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
start(); wait().then(initDb).then(() => app.listen(port, '0.0.0.0', () => console.log(`Business & Life auth hardening gateway listening on ${port}`))).catch(e => { console.error(e); process.exit(1); });
