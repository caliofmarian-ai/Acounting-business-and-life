import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import QRCode from 'qrcode';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendTransientEmailNotification } from './notification-core.js';
import {accountClosureAssessment,closeAccountSafely,ensureAccountLifecycleSchema,purgeEmptyUnverifiedAccount} from './account-lifecycle-core.js';
import {accountGeographySnapshot} from './account-geography.js';
import {appendAdminAudit,requireAdminPermission} from './admin-authorization.js';
import { companyTestAccountForEmail } from './company-test-accounts.js';
import {AUTH_MFA_SESSION_TTL_MS,AUTH_STEP_UP_TTL_MS,clearV2SessionMfa,createV2Session,isLegacyBearerToken,markV2SessionMfa,markV2SessionStepUp,resolveV2SessionMfa,resolveV2SessionStepUp,resolveV2SessionToken} from './auth-session-core.js';
import {buildTotpUri,decryptMfaSecret,encryptMfaSecret,generateRecoveryCodes,generateTotpSecret,hashRecoveryCode,verifyTotpCode} from './super-admin-mfa-core.js';
import {incidentsFetch,startEmbeddedIncidents,stopEmbeddedIncidents} from './server-incidents.js';
import {clearBrowserSessionCookies,issueBrowserSessionCookies,sessionCredentialFromHeaders,sessionSecurityMiddleware} from './session-cookie-core.js';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const SUPER_ADMIN_MFA_ENCRYPTION_KEY = String(process.env.SUPER_ADMIN_MFA_ENCRYPTION_KEY || TOKEN_SECRET || '');
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

app.use(sessionSecurityMiddleware);
app.use('/api',superAdminMfaBoundary);

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
  const token=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
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
    ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
    ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS mfa_method TEXT NOT NULL DEFAULT '';
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
    CREATE TABLE IF NOT EXISTS super_admin_mfa_factors (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      secret_ciphertext TEXT NOT NULL,
      last_totp_counter BIGINT NOT NULL DEFAULT -1,
      enrolled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(status IN ('pending','active'))
    );
    CREATE TABLE IF NOT EXISTS super_admin_mfa_recovery_codes (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id,code_hash)
    );
    CREATE INDEX IF NOT EXISTS super_admin_mfa_recovery_lookup_idx
      ON super_admin_mfa_recovery_codes(account_id,used_at,created_at DESC);
    CREATE TABLE IF NOT EXISTS auth_mfa_attempt_windows (
      key_hash TEXT PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS auth_mfa_attempt_windows_account_idx
      ON auth_mfa_attempt_windows(account_id,purpose,updated_at DESC);
  `);
  await ensureAccountLifecycleSchema(pool);
  await pool.query(`
    UPDATE accounts
       SET auth_status='pending_verification',updated_at=NOW()
     WHERE COALESCE(account_mode,'personal')<>'company_test'
       AND email_verified_at IS NULL
       AND email<>''
       AND auth_status='active'
  `);
}


const SUPER_ADMIN_MFA_ADMIN_PREFIXES=Object.freeze([
  '/api/admin',
  '/api/governance/admin',
  '/api/legal/admin',
  '/api/payments/admin'
]);

function privilegedAdminPath(path=''){
  const pathname=String(path||'').split('?')[0];
  return SUPER_ADMIN_MFA_ADMIN_PREFIXES.some(prefix=>pathname===prefix||pathname.startsWith(prefix+'/'));
}

function mfaKeyReady(){return SUPER_ADMIN_MFA_ENCRYPTION_KEY.length>=16}

async function activeSuperAdmin(accountId){
  const q=await pool.query(`
    SELECT 1
      FROM platform_admin_assignments
     WHERE account_id=$1
       AND status='active'
       AND effective_from<=NOW()
       AND (effective_until IS NULL OR effective_until>NOW())
       AND COALESCE(NULLIF(authority_rank,''),admin_role)='super_admin'
     LIMIT 1
  `,[Number(accountId)]);
  return Boolean(q.rowCount);
}

async function mfaFactor(accountId,client=pool){
  const q=await client.query(
    `SELECT account_id,status,secret_ciphertext,last_totp_counter,enrolled_at,created_at,updated_at
       FROM super_admin_mfa_factors
      WHERE account_id=$1`,
    [Number(accountId)]
  );
  return q.rows[0]||null;
}

function mfaAttemptHash(accountId,purpose,req,scope='account_ip'){
  const ip=scope==='account_ip'?':'+requestIpHash(req):'';
  return sha256('super-admin-mfa:'+Number(accountId)+':'+clean(purpose,80)+ip);
}

async function durableMfaRateLimited(accountId,purpose,req,{
  maxAttempts=5,windowSeconds=15*60,lockSeconds=15*60,scope='account_ip'
}={}){
  const keyHash=mfaAttemptHash(accountId,purpose,req,scope);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const found=await client.query(
      `SELECT attempts,window_started_at,locked_until
         FROM auth_mfa_attempt_windows
        WHERE key_hash=$1
        FOR UPDATE`,
      [keyHash]
    );
    if(!found.rowCount){
      await client.query(
        `INSERT INTO auth_mfa_attempt_windows(key_hash,account_id,purpose,attempts)
         VALUES($1,$2,$3,1)`,
        [keyHash,Number(accountId),clean(purpose,80)]
      );
      await client.query('COMMIT');
      return false;
    }
    const row=found.rows[0],now=Date.now();
    const lockedUntil=row.locked_until?new Date(row.locked_until).getTime():0;
    if(Number.isFinite(lockedUntil)&&lockedUntil>now){
      await client.query('COMMIT');
      return true;
    }
    const started=new Date(row.window_started_at).getTime();
    if(!Number.isFinite(started)||now-started>Number(windowSeconds)*1000){
      await client.query(
        `UPDATE auth_mfa_attempt_windows
            SET attempts=1,window_started_at=NOW(),locked_until=NULL,updated_at=NOW()
          WHERE key_hash=$1`,
        [keyHash]
      );
      await client.query('COMMIT');
      return false;
    }
    if(Number(row.attempts||0)>=Number(maxAttempts)){
      await client.query(
        `UPDATE auth_mfa_attempt_windows
            SET locked_until=NOW()+($2::int*INTERVAL '1 second'),updated_at=NOW()
          WHERE key_hash=$1`,
        [keyHash,Number(lockSeconds)]
      );
      await client.query('COMMIT');
      return true;
    }
    await client.query(
      `UPDATE auth_mfa_attempt_windows
          SET attempts=attempts+1,updated_at=NOW()
        WHERE key_hash=$1`,
      [keyHash]
    );
    await client.query('COMMIT');
    return false;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

async function clearDurableMfaRateLimit(accountId,purpose){
  await pool.query(
    `DELETE FROM auth_mfa_attempt_windows WHERE account_id=$1 AND purpose=$2`,
    [Number(accountId),clean(purpose,80)]
  ).catch(()=>{});
}

async function requireSuperAdminSession(req){
  const session=await requireV2(req);
  if(!(await activeSuperAdmin(session.accountId))){
    throw Object.assign(new Error('Super Admin access is required'),{status:403,code:'SUPER_ADMIN_REQUIRED'});
  }
  if(!mfaKeyReady()){
    throw Object.assign(new Error('Super Admin MFA encryption is not configured'),{status:503,code:'SUPER_ADMIN_MFA_CONFIG_REQUIRED'});
  }
  return session;
}

function mfaError(res,status,error,code,extra={}){
  return res.status(status).json({error,code,...extra});
}

async function superAdminMfaBoundary(req,res,next){
  const fullPath=`/api${req.path}`;
  if(!privilegedAdminPath(fullPath))return next();
  try{
    const session=await optionalV2(req);
    if(!session)return next();
    if(!(await activeSuperAdmin(session.accountId)))return next();
    if(!mfaKeyReady())return mfaError(res,503,'Super Admin MFA is not configured','SUPER_ADMIN_MFA_CONFIG_REQUIRED');
    const factor=await mfaFactor(session.accountId);
    if(!factor||factor.status!=='active'){
      await audit(session.accountId,'super_admin_mfa_admin_blocked',req,{reason:'enrollment_required',path:fullPath,method:req.method});
      return mfaError(res,428,'Set up your authenticator before opening Admin','SUPER_ADMIN_MFA_ENROLLMENT_REQUIRED',{mfa_required:true});
    }
    const raw=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
    const verb=String(req.method||'GET').toUpperCase();
    const sensitive=!['GET','HEAD','OPTIONS'].includes(verb);
    const maxAgeMs=sensitive?AUTH_STEP_UP_TTL_MS:AUTH_MFA_SESSION_TTL_MS;
    const state=await resolveV2SessionMfa(pool,TOKEN_SECRET,raw,{maxAgeMs});
    if(!state?.mfaValid){
      await audit(session.accountId,'super_admin_mfa_admin_blocked',req,{reason:sensitive?'fresh_mfa_required':'mfa_required',path:fullPath,method:verb});
      return mfaError(
        res,428,
        sensitive?'Confirm a fresh authenticator code before this Admin change':'Enter your authenticator code to open Admin',
        sensitive?'SUPER_ADMIN_MFA_STEP_UP_REQUIRED':'SUPER_ADMIN_MFA_REQUIRED',
        {mfa_required:true,fresh_required:sensitive}
      );
    }
    next();
  }catch(error){next(error)}
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
    clearBrowserSessionCookies(res);
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
    const used = await consumeActionToken(token, 'verify_email', async (client, row) => client.query(`UPDATE accounts SET email_verified_at=COALESCE(email_verified_at,NOW()),auth_status=CASE WHEN auth_status='pending_verification' THEN 'active' ELSE auth_status END,updated_at=NOW() WHERE id=$1`, [row.account_id]));
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


app.get('/api/auth/mfa/status',async(req,res,next)=>{
  try{
    const session=await requireV2(req);
    const required=await activeSuperAdmin(session.accountId);
    if(!required){
      res.set('Cache-Control','private, no-store, max-age=0');
      return res.json({ok:true,required:false,enrolled:false,session_verified:false});
    }
    if(!mfaKeyReady())return mfaError(res,503,'Super Admin MFA encryption is not configured','SUPER_ADMIN_MFA_CONFIG_REQUIRED');
    const factor=await mfaFactor(session.accountId);
    const raw=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
    const state=await resolveV2SessionMfa(pool,TOKEN_SECRET,raw,{maxAgeMs:AUTH_MFA_SESSION_TTL_MS});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({
      ok:true,
      required:true,
      enrolled:Boolean(factor?.status==='active'),
      enrollment_pending:Boolean(factor?.status==='pending'),
      session_verified:Boolean(state?.mfaValid),
      verified_at:state?.mfaVerifiedAt||null,
      method:state?.mfaMethod||'',
      session_valid_for_minutes:Math.round(AUTH_MFA_SESSION_TTL_MS/60_000),
      sensitive_valid_for_minutes:Math.round(AUTH_STEP_UP_TTL_MS/60_000)
    });
  }catch(error){next(error)}
});

app.post('/api/auth/mfa/enroll/start',jsonBody,async(req,res,next)=>{
  try{
    const session=await requireSuperAdminSession(req);
    if(await durableMfaRateLimited(session.accountId,'enroll_start',req,{maxAttempts:4,windowSeconds:30*60,lockSeconds:30*60,scope:'account'})){
      await audit(session.accountId,'super_admin_mfa_enroll_rate_limited',req);
      return mfaError(res,429,'Too many MFA setup attempts. Try again later.','SUPER_ADMIN_MFA_RATE_LIMITED');
    }
    const existing=await mfaFactor(session.accountId);
    if(existing?.status==='active')return mfaError(res,409,'MFA is already active. Confirm MFA and reset it before enrolling again.','SUPER_ADMIN_MFA_ALREADY_ACTIVE');
    const secret=generateTotpSecret();
    const envelope=encryptMfaSecret(secret,SUPER_ADMIN_MFA_ENCRYPTION_KEY);
    await pool.query(`
      INSERT INTO super_admin_mfa_factors(account_id,status,secret_ciphertext,last_totp_counter,enrolled_at,updated_at)
      VALUES($1,'pending',$2,-1,NULL,NOW())
      ON CONFLICT(account_id) DO UPDATE SET
        status='pending',secret_ciphertext=EXCLUDED.secret_ciphertext,last_totp_counter=-1,
        enrolled_at=NULL,updated_at=NOW()
    `,[session.accountId,envelope]);
    await pool.query(`DELETE FROM super_admin_mfa_recovery_codes WHERE account_id=$1`,[session.accountId]);
    await clearV2SessionMfa(pool,{accountId:session.accountId,sessionId:session.sessionId});
    await audit(session.accountId,'super_admin_mfa_enrollment_started',req);
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({ok:true,status:'pending',qr_url:'/api/auth/mfa/enroll/qr'});
  }catch(error){next(error)}
});

app.get('/api/auth/mfa/enroll/qr',async(req,res,next)=>{
  try{
    const session=await requireSuperAdminSession(req);
    const factor=await mfaFactor(session.accountId);
    if(!factor||factor.status!=='pending')return mfaError(res,409,'Start MFA setup before requesting the QR code','SUPER_ADMIN_MFA_ENROLLMENT_NOT_PENDING');
    const account=await pool.query(`SELECT email FROM accounts WHERE id=$1`,[session.accountId]);
    const secret=decryptMfaSecret(factor.secret_ciphertext,SUPER_ADMIN_MFA_ENCRYPTION_KEY);
    const uri=buildTotpUri({secret,accountLabel:account.rows[0]?.email||'Super Admin'});
    const png=await QRCode.toBuffer(uri,{type:'png',errorCorrectionLevel:'M',margin:1,width:320});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.type('png').send(png);
  }catch(error){next(error)}
});

app.post('/api/auth/mfa/enroll/confirm',jsonBody,async(req,res,next)=>{
  try{
    const session=await requireSuperAdminSession(req);
    if(
      await durableMfaRateLimited(session.accountId,'enroll_confirm',req,{maxAttempts:8,windowSeconds:15*60,lockSeconds:30*60,scope:'account'})
      ||await durableMfaRateLimited(session.accountId,'enroll_confirm_ip',req,{maxAttempts:5,windowSeconds:15*60,lockSeconds:30*60,scope:'account_ip'})
    ){
      await audit(session.accountId,'super_admin_mfa_enroll_rate_limited',req);
      return mfaError(res,429,'Too many MFA confirmation attempts. Try again later.','SUPER_ADMIN_MFA_RATE_LIMITED');
    }
    const code=clean(req.body?.code,12);
    const client=await pool.connect();
    let counter=null;
    try{
      await client.query('BEGIN');
      const locked=await client.query(
        `SELECT status,secret_ciphertext,last_totp_counter FROM super_admin_mfa_factors WHERE account_id=$1 FOR UPDATE`,
        [session.accountId]
      );
      const factor=locked.rows[0];
      if(!factor||factor.status!=='pending')throw Object.assign(new Error('MFA setup is not pending'),{status:409,code:'SUPER_ADMIN_MFA_ENROLLMENT_NOT_PENDING'});
      const secret=decryptMfaSecret(factor.secret_ciphertext,SUPER_ADMIN_MFA_ENCRYPTION_KEY);
      const verified=verifyTotpCode(secret,code,{window:1,minCounter:Number(factor.last_totp_counter??-1)});
      if(!verified.ok)throw Object.assign(new Error('Authenticator code is incorrect or has already been used'),{status:403,code:'SUPER_ADMIN_MFA_CODE_INVALID'});
      counter=verified.counter;
      await client.query(
        `UPDATE super_admin_mfa_factors
            SET status='active',last_totp_counter=$2,enrolled_at=NOW(),updated_at=NOW()
          WHERE account_id=$1`,
        [session.accountId,counter]
      );
      const recoveryCodes=generateRecoveryCodes(10);
      for(const recoveryCode of recoveryCodes){
        await client.query(
          `INSERT INTO super_admin_mfa_recovery_codes(account_id,code_hash) VALUES($1,$2)`,
          [session.accountId,hashRecoveryCode(recoveryCode,SUPER_ADMIN_MFA_ENCRYPTION_KEY)]
        );
      }
      await client.query('COMMIT');
      const marked=await markV2SessionMfa(pool,{accountId:session.accountId,sessionId:session.sessionId,method:'totp'});
      await clearDurableMfaRateLimit(session.accountId,'enroll_confirm');
      await clearDurableMfaRateLimit(session.accountId,'enroll_confirm_ip');
      await audit(session.accountId,'super_admin_mfa_enrollment_completed',req,{session_id_hash:sha256(session.sessionId),counter:Number(counter)});
      res.set('Cache-Control','private, no-store, max-age=0');
      return res.json({
        ok:true,enrolled:true,session_verified:Boolean(marked),
        recovery_codes:recoveryCodes,
        recovery_notice:'Save these recovery codes offline now. They are shown only once.'
      });
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      await audit(session.accountId,'super_admin_mfa_enrollment_failed',req,{code:clean(error.code||'invalid',80)});
      throw error;
    }finally{client.release()}
  }catch(error){next(error)}
});

app.post('/api/auth/mfa/challenge',jsonBody,async(req,res,next)=>{
  try{
    const session=await requireSuperAdminSession(req);
    if(
      await durableMfaRateLimited(session.accountId,'challenge',req,{maxAttempts:10,windowSeconds:15*60,lockSeconds:30*60,scope:'account'})
      ||await durableMfaRateLimited(session.accountId,'challenge_ip',req,{maxAttempts:5,windowSeconds:15*60,lockSeconds:30*60,scope:'account_ip'})
    ){
      await audit(session.accountId,'super_admin_mfa_challenge_rate_limited',req,{session_id_hash:sha256(session.sessionId)});
      return mfaError(res,429,'Too many MFA attempts. Try again later.','SUPER_ADMIN_MFA_RATE_LIMITED');
    }
    const code=clean(req.body?.code,40);
    const recoveryCode=clean(req.body?.recovery_code,80);
    if(!code&&!recoveryCode)return mfaError(res,400,'Authenticator or recovery code is required','SUPER_ADMIN_MFA_CODE_REQUIRED');
    const client=await pool.connect();
    let method='';
    try{
      await client.query('BEGIN');
      const locked=await client.query(
        `SELECT status,secret_ciphertext,last_totp_counter FROM super_admin_mfa_factors WHERE account_id=$1 FOR UPDATE`,
        [session.accountId]
      );
      const factor=locked.rows[0];
      if(!factor||factor.status!=='active')throw Object.assign(new Error('MFA enrollment is required'),{status:428,code:'SUPER_ADMIN_MFA_ENROLLMENT_REQUIRED'});
      if(recoveryCode){
        let hash='';
        try{hash=hashRecoveryCode(recoveryCode,SUPER_ADMIN_MFA_ENCRYPTION_KEY)}catch{}
        const used=hash?await client.query(
          `UPDATE super_admin_mfa_recovery_codes
              SET used_at=NOW()
            WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL
            RETURNING id`,
          [session.accountId,hash]
        ):{rowCount:0};
        if(!used.rowCount)throw Object.assign(new Error('Authenticator or recovery code is incorrect'),{status:403,code:'SUPER_ADMIN_MFA_CODE_INVALID'});
        method='recovery_code';
      }else{
        const secret=decryptMfaSecret(factor.secret_ciphertext,SUPER_ADMIN_MFA_ENCRYPTION_KEY);
        const verified=verifyTotpCode(secret,code,{window:1,minCounter:Number(factor.last_totp_counter??-1)});
        if(!verified.ok)throw Object.assign(new Error('Authenticator code is incorrect or has already been used'),{status:403,code:'SUPER_ADMIN_MFA_CODE_INVALID'});
        await client.query(
          `UPDATE super_admin_mfa_factors SET last_totp_counter=$2,updated_at=NOW() WHERE account_id=$1`,
          [session.accountId,verified.counter]
        );
        method='totp';
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      await audit(session.accountId,'super_admin_mfa_challenge_failed',req,{code:clean(error.code||'invalid',80)});
      throw error;
    }finally{client.release()}
    const marked=await markV2SessionMfa(pool,{accountId:session.accountId,sessionId:session.sessionId,method});
    await clearDurableMfaRateLimit(session.accountId,'challenge');
    await clearDurableMfaRateLimit(session.accountId,'challenge_ip');
    await audit(session.accountId,'super_admin_mfa_challenge_succeeded',req,{method,session_id_hash:sha256(session.sessionId)});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({ok:true,verified:Boolean(marked),method,sensitive_valid_for_minutes:Math.round(AUTH_STEP_UP_TTL_MS/60_000)});
  }catch(error){next(error)}
});

app.post('/api/auth/mfa/reset',jsonBody,async(req,res,next)=>{
  try{
    const session=await requireSuperAdminSession(req);
    const raw=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
    const state=await resolveV2SessionMfa(pool,TOKEN_SECRET,raw,{maxAgeMs:AUTH_STEP_UP_TTL_MS});
    if(!state?.mfaValid)return mfaError(res,428,'Confirm a fresh authenticator or recovery code before resetting MFA','SUPER_ADMIN_MFA_STEP_UP_REQUIRED');
    if(await durableMfaRateLimited(session.accountId,'reset',req,{maxAttempts:3,windowSeconds:60*60,lockSeconds:60*60,scope:'account'})){
      await audit(session.accountId,'super_admin_mfa_reset_rate_limited',req);
      return mfaError(res,429,'Too many MFA reset attempts. Try again later.','SUPER_ADMIN_MFA_RATE_LIMITED');
    }
    const secret=generateTotpSecret();
    const envelope=encryptMfaSecret(secret,SUPER_ADMIN_MFA_ENCRYPTION_KEY);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO super_admin_mfa_factors(account_id,status,secret_ciphertext,last_totp_counter,enrolled_at,updated_at)
         VALUES($1,'pending',$2,-1,NULL,NOW())
         ON CONFLICT(account_id) DO UPDATE SET
           status='pending',secret_ciphertext=EXCLUDED.secret_ciphertext,last_totp_counter=-1,
           enrolled_at=NULL,updated_at=NOW()`,
        [session.accountId,envelope]
      );
      await client.query(`DELETE FROM super_admin_mfa_recovery_codes WHERE account_id=$1`,[session.accountId]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
    await clearV2SessionMfa(pool,{accountId:session.accountId,sessionId:session.sessionId});
    await audit(session.accountId,'super_admin_mfa_reset_started',req,{session_id_hash:sha256(session.sessionId)});
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json({ok:true,status:'pending',qr_url:'/api/auth/mfa/enroll/qr'});
  }catch(error){next(error)}
});

app.get('/api/auth/step-up/status', async (req,res,next) => {
  try {
    const raw=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
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
    if(!account||!['active','pending_verification'].includes(String(account.auth_status||'')))throw Object.assign(new Error('Account is not available'),{status:403});
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

async function requireRecentStepUp(req){
  const raw=req.ablSessionToken||sessionCredentialFromHeaders(req.headers||{}).token;
  const state=await resolveV2SessionStepUp(pool,TOKEN_SECRET,raw);
  if(!state)throw Object.assign(new Error('Sign in again to continue'),{status:401});
  if(!state.stepUpValid)throw Object.assign(new Error('Confirm your identity before deleting your account'),{status:428,code:'STEP_UP_REQUIRED'});
  return state;
}

app.get('/api/auth/account-closure/preflight',async(req,res,next)=>{
  try{
    const s=await requireV2(req);
    const assessment=await accountClosureAssessment(pool,s.accountId);
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json(assessment);
  }catch(error){next(error)}
});

app.post('/api/auth/account-closure/close',jsonBody,async(req,res,next)=>{
  try{
    const s=await requireRecentStepUp(req);
    if(req.body?.confirm!==true||clean(req.body?.confirmation,40).toUpperCase()!=='DELETE'){
      return res.status(400).json({error:'Type DELETE and confirm the account closure action'});
    }
    const assessment=await accountClosureAssessment(pool,s.accountId);
    if(assessment.blockers.length){
      await audit(s.accountId,'account_closure_blocked',req,{blocker_codes:assessment.blockers.map(x=>x.code)});
      return res.status(409).json({error:'Account closure is blocked until outstanding matters are resolved',code:'ACCOUNT_CLOSURE_BLOCKED',assessment});
    }
    const result=await closeAccountSafely(pool,{
      accountId:s.accountId,
      actorAccountId:s.accountId,
      actorType:'self',
      reason:'Self-service account closure'
    });
    await audit(s.accountId,'account_closed_self_service',req,{mode:result.mode||'anonymize_and_retain_required_history'});
    clearBrowserSessionCookies(res);
    res.json({...result,signed_out:true});
  }catch(error){
    if(error?.assessment)return res.status(error.status||409).json({error:error.message,code:error.code||'ACCOUNT_CLOSURE_BLOCKED',assessment:error.assessment});
    next(error);
  }
});

async function adminAccountClosureAuthority(req,targetAccountId,{stepUpRequired=false}={}){
  const actor=stepUpRequired?await requireRecentStepUp(req):await requireV2(req);
  const targetId=Number(targetAccountId);
  if(!Number.isInteger(targetId)||targetId<=0)throw Object.assign(new Error('Valid member account id required'),{status:400});
  if(Number(actor.accountId)===targetId)throw Object.assign(new Error('Use your own Account Settings to close your account'),{status:409});
  const target=await pool.query(`SELECT id,auth_status,personal_public_id FROM accounts WHERE id=$1`,[targetId]);
  if(!target.rowCount)throw Object.assign(new Error('Member not found'),{status:404});
  const protectedAdmin=await pool.query(
    `SELECT 1 FROM platform_admin_assignments WHERE account_id=$1 AND status='active' AND COALESCE(NULLIF(authority_rank,''),admin_role)='super_admin' LIMIT 1`,
    [targetId]
  ).catch(()=>({rowCount:0}));
  if(protectedAdmin.rowCount)throw Object.assign(new Error('Active Super Admin accounts cannot be closed from Members'),{status:403,code:'PROTECTED_SUPER_ADMIN'});
  const geography=await accountGeographySnapshot(pool,targetId).catch(()=>({assigned:false}));
  const territoryId=geography?.exact_territory?.id||geography?.nearest_opened_scope?.id||null;
  const assignment=await requireAdminPermission(pool,actor.accountId,'members.close_account',territoryId);
  return{actor,target:target.rows[0],targetId,territoryId,assignment};
}

app.get('/api/admin/members/:accountId/account-closure/preflight',async(req,res,next)=>{
  try{
    const authority=await adminAccountClosureAuthority(req,req.params.accountId);
    const assessment=await accountClosureAssessment(pool,authority.targetId);
    res.set('Cache-Control','private, no-store, max-age=0');
    res.json(assessment);
  }catch(error){next(error)}
});

app.post('/api/admin/members/:accountId/account-closure',jsonBody,async(req,res,next)=>{
  try{
    const authority=await adminAccountClosureAuthority(req,req.params.accountId,{stepUpRequired:true});
    const reason=clean(req.body?.reason,1200);
    if(reason.length<8)return res.status(400).json({error:'A clear Admin reason is required'});
    if(req.body?.confirm!==true)return res.status(400).json({error:'Explicit confirmation is required'});
    const requestedAction=clean(req.body?.action,80);
    const expectedConfirmation=requestedAction==='purge_empty_unverified'?'DELETE':'CLOSE';
    if(clean(req.body?.confirmation,40).toUpperCase()!==expectedConfirmation){
      return res.status(400).json({error:`Type ${expectedConfirmation} to confirm this governed account action`,code:'ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED'});
    }
    const assessment=await accountClosureAssessment(pool,authority.targetId);
    if(assessment.blockers.length){
      await appendAdminAudit(pool,{
        actorAccountId:authority.actor.accountId,assignmentId:authority.assignment.id,permission:'members.close_account',
        territoryId:authority.territoryId,targetType:'account',targetId:String(authority.targetId),
        eventCode:'member_account_closure_blocked',after:{blocker_codes:assessment.blockers.map(x=>x.code)},reason
      });
      return res.status(409).json({error:'Account closure is blocked until outstanding matters are resolved',code:'ACCOUNT_CLOSURE_BLOCKED',assessment});
    }
    const result=requestedAction==='purge_empty_unverified'
      ?await purgeEmptyUnverifiedAccount(pool,{accountId:authority.targetId,actorAccountId:authority.actor.accountId,actorType:'admin',reason})
      :await closeAccountSafely(pool,{accountId:authority.targetId,actorAccountId:authority.actor.accountId,actorType:'admin',reason});
    await appendAdminAudit(pool,{
      actorAccountId:authority.actor.accountId,assignmentId:authority.assignment.id,permission:'members.close_account',
      territoryId:authority.territoryId,targetType:'account',targetId:String(authority.targetId),
      eventCode:result.purged?'member_empty_unverified_account_purged':'member_account_closed',
      after:{mode:result.mode||'',purged:Boolean(result.purged),closed:Boolean(result.closed)},reason
    });
    res.json(result);
  }catch(error){
    if(error?.assessment)return res.status(error.status||409).json({error:error.message,code:error.code||'ACCOUNT_CLOSURE_BLOCKED',assessment:error.assessment});
    next(error);
  }
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
  const client = await pool.connect(); try { await client.query('BEGIN'); const q = await client.query(`SELECT * FROM auth_handoffs WHERE code_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE`, [sha256(code)]); if (!q.rowCount) throw Object.assign(new Error('Google sign-in handoff expired'), { status: 400 }); const row = q.rows[0]; await client.query(`UPDATE auth_handoffs SET used_at=NOW() WHERE code_hash=$1`, [sha256(code)]); await client.query('COMMIT'); const session = await createSession(row.account_id, req); issueBrowserSessionCookies(res,session.token); res.json({ok:true,auth_transport:'cookie',expires_in_hours:24}); } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

app.patch('/api/admin/members/:accountId/status',jsonBody,async(req,res,next)=>{
  try{
    await requireV2(req);
    const targetId=Number(req.params.accountId),requested=clean(req.body?.status,40);
    if(!Number.isInteger(targetId)||targetId<=0)return res.status(400).json({error:'Valid member account id required'});
    const q=await pool.query(`SELECT auth_status,email_verified_at,account_mode FROM accounts WHERE id=$1`,[targetId]);
    if(!q.rowCount)return res.status(404).json({error:'Member not found'});
    const target=q.rows[0];
    if(target.auth_status==='closed'){
      return res.status(409).json({error:'Closed accounts cannot be reactivated or suspended',code:'CLOSED_ACCOUNT_IMMUTABLE'});
    }
    if(requested==='active'&&target.account_mode!=='company_test'&&!target.email_verified_at){
      return res.status(409).json({error:'Email ownership must be verified before this account can become active',code:'EMAIL_VERIFICATION_REQUIRED'});
    }
    next();
  }catch(error){next(error)}
});

function pendingVerificationMutationAllowed(path,method){
  const verb=String(method||'GET').toUpperCase();
  if(['GET','HEAD','OPTIONS'].includes(verb))return true;
  if(verb==='PATCH'&&path==='/api/me')return true;
  if(verb==='PUT'&&path==='/api/me/geography')return true;
  if(verb==='POST'&&['/api/me/address/reverse','/api/auth/password'].includes(path))return true;
  return false;
}
app.use('/api', async (req, res, next) => {
  const fullPath=`/api${req.path}`;
  const blocked = hardeningPolicyResponse(fullPath, req.method, req.headers);
  if (blocked)return res.status(blocked.status).json(await blocked.json());
  try{
    const session=await optionalV2(req);
    if(session){
      const q=await pool.query(`SELECT auth_status,email_verified_at,account_mode FROM accounts WHERE id=$1`,[session.accountId]);
      const account=q.rows[0];
      if(!account)return res.status(401).json({error:'Sign in again to continue'});
      if(['suspended','closed'].includes(String(account.auth_status||'')))return res.status(403).json({error:'This account is not available',code:'ACCOUNT_NOT_ACTIVE'});
      const pending=String(account.account_mode||'personal')!=='company_test'&&!account.email_verified_at;
      if(pending&&!pendingVerificationMutationAllowed(fullPath,req.method)){
        return res.status(403).json({error:'Verify your email before using Business & Life',code:'EMAIL_VERIFICATION_REQUIRED'});
      }
    }
    next();
  }catch(error){next(error)}
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
