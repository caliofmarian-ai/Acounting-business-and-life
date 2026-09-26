import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendTransientEmailNotification } from './notification-core.js';
import { companyTestAccountForEmail } from './company-test-accounts.js';
import {AUTH_STEP_UP_TTL_MS,createV2Session,isLegacyBearerToken,markV2SessionStepUp,resolveV2SessionStepUp,resolveV2SessionToken} from './auth-session-core.js';
import {incidentsFetch,startEmbeddedIncidents,stopEmbeddedIncidents} from './server-incidents.js';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
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
const APP_ENV = String(process.env.APP_ENV || '').trim().toLowerCase();
const RAILWAY_SERVICE_NAME = String(process.env.RAILWAY_SERVICE_NAME || '').trim();
const QA_PH_TEST_CONTEXT = ['1','true','yes','on'].includes(String(process.env.QA_PH_TEST_CONTEXT || '').trim().toLowerCase());
const QA_REMOTE_TEST_EMAIL = String(process.env.QA_REMOTE_TEST_EMAIL || '').trim().toLowerCase();
const RESET_TTL_MIN = Math.max(10, Math.min(60, Number(process.env.AUTH_RESET_TTL_MIN || 20)));
const VERIFY_TTL_HOURS = Math.max(1, Math.min(72, Number(process.env.AUTH_VERIFY_TTL_HOURS || 24)));
const jsonBody = express.json({ limit: '450kb' });
const attempts = new Map();
let incidentsApp=null;
let incidentsReady=false;
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
function requestIpHash(req) { return sha256(req.ip || req.headers['x-forwarded-for'] || 'unknown'); }
function throttleId(req,key){return `${requestIpHash(req)}:${sha256(key)}`;}
function throttled(req, key, max = 6, windowMs = 15 * 60_000) {
  const id = throttleId(req,key); const now = Date.now();
  const state = attempts.get(id) || { count: 0, first: now };
  if (now - state.first > windowMs) { state.count = 0; state.first = now; }
  if (state.count >= max) return true;
  state.count += 1; attempts.set(id, state); return false;
}
function clearThrottle(req,key){attempts.delete(throttleId(req,key));}
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
async function verifyPassword(password,salt,expectedHash){
  if(!salt||!expectedHash)return false;
  const derived=await scryptAsync(password,salt,64);
  return safeHexEqual(Buffer.from(derived).toString('hex'),expectedHash);
}
async function createSession(accountId, req) {
  return createV2Session(pool,TOKEN_SECRET,accountId,{
    userAgent:clean(req.headers['user-agent'],400),
    ipHash:requestIpHash(req),
    stepUpVerified:true
  });
}
async function optionalV2(req) {
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'')||'';
  return resolveV2SessionToken(pool,TOKEN_SECRET,token);
}
async function requireV2(req) {
  const session=await optionalV2(req);
  if (!session) throw Object.assign(new Error('Sign in again to continue'), { status: 401 });
  return session;
}
async function audit(accountId, eventCode, req, detail = {}) {
  await pool.query(`INSERT INTO auth_security_events(account_id,event_code,ip_hash,user_agent,detail_json) VALUES($1,$2,$3,$4,$5::jsonb)`, [accountId || null, clean(eventCode, 80), requestIpHash(req), clean(req.headers['user-agent'], 400), JSON.stringify(detail)]).catch(() => {});
}

async function initDb() {
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legacy_pin_retired_at TIMESTAMPTZ;
    ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS step_up_verified_at TIMESTAMPTZ;
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
  return {sent:Boolean(result.sent),not_configured:Boolean(result.not_configured),reference:result.reference||''};
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

function responseJson(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (String(key).toLowerCase() === wanted) return String(value || '');
  return '';
}
function hardeningPolicyResponse(path, method = 'GET', headers = {}) {
  const pathname = String(path || '').split('?')[0];
  if (!pathname.startsWith('/api')) return null;
  if (pathname === '/api/login' && String(method || 'GET').toUpperCase() === 'POST') {
    return responseJson(410, { error: 'PIN login has been retired from the public app. Use email/password or account recovery.' });
  }
  const raw = headerValue(headers, 'authorization').replace(/^Bearer\s+/i, '');
  if (isLegacyBearerToken(raw)) {
    return responseJson(401, { error: 'Legacy PIN session expired. Sign in with your email account.' });
  }
  return null;
}
function injectAuthRoot(html) {
  let next = String(html || '');
  if (!next.includes('id="modernAuthRoot"')) next = next.replace('<form id="loginForm"', '<div id="modernAuthRoot"></div><form id="loginForm"');
  if (!next.includes('/auth-hardening.css')) next = next.replace('</head>', '  <link rel="stylesheet" href="/auth-hardening.css" />\n</head>');
  if (!next.includes('/auth-hardening-ui.js')) next = next.replace('</body>', '  <script type="module" src="/auth-hardening-ui.js"></script>\n</body>');
  return next;
}

export async function authHardeningFetch(path, options = {}) {
  const pathname = String(path || '').split('?')[0];
  const policy = hardeningPolicyResponse(pathname, options.method || 'GET', options.headers || {});
  if (policy) return policy;
  if (pathname === '/health') {
    try {
      await pool.query('SELECT 1');
      const incidents = await incidentsFetch('/health', { headers: options.headers || {} });
      const ok=incidentsReady&&incidents.ok;
      return responseJson(ok ? 200 : 503, { ok, db: true, incidents: ok, version: '0.8.5-auth-hardening' });
    } catch {
      return responseJson(503, { ok: false, db: false, incidents: false, version: '0.8.5-auth-hardening' });
    }
  }
  if (pathname === '/' || pathname === '/index.html') {
    const upstream = await incidentsFetch(path, options);
    const html = injectAuthRoot(await upstream.text());
    return new Response(html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return incidentsFetch(path, options);
}

app.get('/health', async (req, res) => {
  const r = await authHardeningFetch('/health', { headers: req.headers });
  res.status(r.status).json(await r.json());
});
app.get('/auth-hardening.css', (_req, res) => res.type('text/css').send(readFileSync(join(__dirname, 'public', 'auth-hardening.css'), 'utf8')));
app.get('/auth-hardening-ui.js', (_req, res) => res.type('application/javascript').send(readFileSync(join(__dirname, 'public', 'auth-hardening-ui.js'), 'utf8')));
async function root(req, res) {
  const r = await authHardeningFetch(req.path, { headers: req.headers });
  res.status(r.status).type('html').send(await r.text());
}
app.get('/', root); app.get('/index.html', root);

app.get('/api/auth/hardening/status', async (_req, res, next) => {
  try {
    // Public authentication capability only. Bootstrap-owner lifecycle state is intentionally not exposed.
    const qaPreview=RAILWAY_SERVICE_NAME==='accounting-preview'&&APP_ENV==='qa'&&QA_PH_TEST_CONTEXT;
    res.json({
      google_enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      email_delivery_configured: AUTH_EMAIL_PROVIDER === 'resend' && Boolean(RESEND_API_KEY && AUTH_FROM_EMAIL),
      preview_link_enabled: PREVIEW_SHOW_LINK,
      qa_preview_context: qaPreview?{
        enabled:true,
        country_code:'PH',
        label:'Philippines QA test context',
        remote_override_scope:'designated_account_only',
        remote_override_configured:Boolean(QA_REMOTE_TEST_EMAIL)
      }:{enabled:false}
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
    const delivery=await sendEmail({ accountId: session.accountId, to: a.email, template: 'verify_email', subject: 'Verify your Business & Life email', html: `<p>Verify your email for Business & Life.</p><p><a href="${link}">Verify email</a></p>` });
    await audit(session.accountId, 'email_verification_requested', req,{delivery_status:delivery.sent?'sent':delivery.not_configured?'not_configured':'failed'});
    const deliveryStatus=delivery.sent?'sent':delivery.not_configured?'not_configured':'failed';
    const result={
      ok:true,
      delivery_status:deliveryStatus,
      message:deliveryStatus==='sent'
        ?'Verification email sent.'
        :deliveryStatus==='not_configured'
          ?'Email delivery is not configured in this environment. The verification request was not emailed.'
          :'Verification email could not be delivered.'
    };
    if(PREVIEW_SHOW_LINK)result.preview_verify_url=link;
    res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/auth/email-verification/verify', jsonBody, async (req, res, next) => {
  const token = clean(req.body?.token, 300); if (!token) return res.status(400).json({ error: 'Verification token is required' });
  try {
    const session = await optionalV2(req);
    const used = await consumeActionToken(token, 'verify_email', async (client, row) => client.query(`UPDATE accounts SET email_verified_at=COALESCE(email_verified_at,NOW()),updated_at=NOW() WHERE id=$1`, [row.account_id]));
    const verificationSession = !session
      ? 'signed_out'
      : Number(session.accountId) === Number(used.account_id)
        ? 'same_account'
        : 'different_account';
    await maybeRetireOwnerPin(used.account_id);
    await audit(used.account_id, 'email_verified', req, { verification_session: verificationSession });
    res.json({ ok: true, verification_session: verificationSession });
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
    const companyTest = companyTestAccountForEmail(email);
    if (companyTest && companyTest.role !== 'super_admin') return res.status(400).json({ error: 'The protected owner account can only use the company Super Admin test alias' });
    const dup = await pool.query(`SELECT id FROM accounts WHERE LOWER(email)=$1 AND id<>1`, [email]); if (dup.rowCount) return res.status(409).json({ error: 'That email already belongs to another account' });
    const { salt, hash } = await hashPassword(password);
    await pool.query(`UPDATE accounts
      SET email=$1,
          password_salt=$2,
          password_hash=$3,
          display_name=COALESCE(NULLIF($4,''),display_name),
          email_verified_at=NULL,
          account_mode=$5,
          test_role=$6,
          phone=CASE WHEN $5='company_test' THEN '' ELSE phone END,
          address=CASE WHEN $5='company_test' THEN '' ELSE address END,
          updated_at=NOW()
      WHERE id=1`, [email, salt, hash, displayName, companyTest ? 'company_test' : 'personal', companyTest?.role || null]);
    const verifyToken = await issueActionToken(1, 'verify_email', `INTERVAL '${VERIFY_TTL_HOURS} hours'`); const verifyLink = `${publicBase(req)}/?verify_token=${encodeURIComponent(verifyToken)}`;
    await sendEmail({ accountId: 1, to: email, template: 'verify_email', subject: 'Verify your Business & Life owner email', html: `<p>Complete the owner security migration by verifying your email.</p><p><a href="${verifyLink}">Verify owner email</a></p>` });
    await audit(1, 'owner_migration_password_set', req);
    const result = { ok: true, message: 'Owner email/password configured. Verify the email to permanently retire the legacy PIN.' }; if (PREVIEW_SHOW_LINK) result.preview_verify_url = verifyLink; res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/auth/step-up/status', async (req,res,next) => {
  try {
    const raw=req.headers.authorization?.replace(/^Bearer\s+/i,'')||'';
    const state=await resolveV2SessionStepUp(pool,TOKEN_SECRET,raw);
    if(!state)throw Object.assign(new Error('Sign in again to continue'),{status:401});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({
      ok:true,
      verified:Boolean(state.stepUpValid),
      verified_at:state.stepUpVerifiedAt||null,
      valid_for_minutes:Math.round(AUTH_STEP_UP_TTL_MS/60_000)
    });
  } catch(e){next(e)}
});

app.post('/api/auth/step-up/password', jsonBody, async (req,res,next) => {
  try {
    const s=await requireV2(req),password=String(req.body?.password||'');
    if(!password)return res.status(400).json({error:'Current password is required'});
    const throttleKey=`step-up:${s.accountId}:${s.sessionId}`;
    if(throttled(req,throttleKey,5,15*60_000)){
      await audit(s.accountId,'step_up_rate_limited',req,{session_id_hash:sha256(s.sessionId)});
      return res.status(429).json({error:'Too many reauthentication attempts. Try again later.'});
    }
    const q=await pool.query(`SELECT password_salt,password_hash,auth_status FROM accounts WHERE id=$1`,[s.accountId]);
    const account=q.rows[0];
    if(!account||account.auth_status!=='active')throw Object.assign(new Error('Account is not active'),{status:403});
    if(!account.password_hash){
      await audit(s.accountId,'step_up_password_unavailable',req,{session_id_hash:sha256(s.sessionId)});
      return res.status(409).json({
        error:'Password reauthentication is not available for this account. Sign in again with your identity provider.',
        code:'STEP_UP_PASSWORD_UNAVAILABLE'
      });
    }
    if(!(await verifyPassword(password,account.password_salt,account.password_hash))){
      await audit(s.accountId,'step_up_failed',req,{method:'password',session_id_hash:sha256(s.sessionId)});
      return res.status(403).json({error:'Current password is incorrect'});
    }
    const verifiedAt=await markV2SessionStepUp(pool,{accountId:s.accountId,sessionId:s.sessionId});
    if(!verifiedAt)throw Object.assign(new Error('Sign in again to continue'),{status:401});
    clearThrottle(req,throttleKey);
    await audit(s.accountId,'step_up_succeeded',req,{method:'password',session_id_hash:sha256(s.sessionId)});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({ok:true,verified:true,verified_at:verifiedAt,valid_for_minutes:Math.round(AUTH_STEP_UP_TTL_MS/60_000)});
  } catch(e){next(e)}
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
        const c = await pool.connect(); try { await c.query('BEGIN'); const a = await c.query(`INSERT INTO accounts(display_name,email,active_role,email_verified_at,auth_status) VALUES($1,$2,NULL,NOW(),'active') RETURNING id`, [clean(user.name || email.split('@')[0], 120), email]); accountId = Number(a.rows[0].id); await c.query(`INSERT INTO account_auth_identities(account_id,provider,provider_subject,provider_email_snapshot) VALUES($1,'google',$2,$3)`, [accountId, String(user.sub), email]); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
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
  const blocked = hardeningPolicyResponse(`/api${req.path}`, req.method, req.headers);
  if (!blocked) return next();
  res.status(blocked.status).json(await blocked.json());
});

function proxy(req,res,next){
  if(!incidentsApp)return res.status(503).json({error:'Incidents runtime is not ready'});
  return incidentsApp(req,res,next);
}
app.use(proxy);
app.use((err, _req, res, _next) => { console.error(err); if (res.headersSent) return; res.status(err.status || 500).json({ error: err.status ? err.message : 'Unexpected authentication error' }); });

let embeddedStartPromise = null;
export async function startEmbeddedAuthHardening() {
  if (!embeddedStartPromise) {
    embeddedStartPromise = (async () => {
      incidentsApp=await startEmbeddedIncidents();
      incidentsReady=true;
      await initDb();
      console.log('Business & Life auth hardening mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopAuthHardening() {
  if (shuttingDown) return;
  shuttingDown = true;
  incidentsReady=false;
  incidentsApp=null;
  await stopEmbeddedIncidents().catch(()=>{});
  await pool.end().catch(() => {});
}
export async function stopEmbeddedAuthHardening() { await stopAuthHardening(); }

async function shutdown(sig) {
  console.log(`Received ${sig}`);
  await stopAuthHardening();
  process.exit(0);
}
const directExecution = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directExecution) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  startEmbeddedAuthHardening()
    .then(() => app.listen(port, '0.0.0.0', () => console.log(`Business & Life auth hardening gateway listening on ${port}`)))
    .catch(e => { console.error(e); process.exit(1); });
}
