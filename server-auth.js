import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLiveReferralPayload, ensureAccountReferral, ensureReferralAccountSchema, normalizeReferralProfileRole } from './growth/referral-account.js';
import { buildLocalReferralQr } from './growth/referral-qr.js';
import { isValidReferralCode } from './growth/referral-domain.js';
import { deliverReferralAnalyticsEvent, sanitizeReferralAnalyticsEvent } from './growth/referral-analytics.js';
import { persistUnconvertedReferralEvent } from './growth/referral-unconverted-attribution.js';
import { bindReferralSignupConversion } from './growth/referral-conversion-binding.js';
import { ensurePersonIdentitySchema, withPublicProfileIds } from './person-profile-identity.js';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');
const app = express();
const port = Number(process.env.PORT || 3000);
const internalAccountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ROLES = new Set(['merchant', 'customer', 'supplier', 'courier', 'service_provider']);
const jsonBody = express.json({ limit: '450kb' });
const loginAttempts = new Map();
const growthAnalyticsAttempts = new Map();
const ACCOUNT_REFERRAL_ANALYTICS_EVENTS = new Set(['referral_link_created','referral_shared']);
const PUBLIC_REFERRAL_ANALYTICS_EVENTS = new Set(['referral_qr_opened','referral_landing_viewed','referral_shared','referral_signup_started']);
let accountingChild;
let shuttingDown = false;

function clean(value, max = 250) { return String(value ?? '').trim().slice(0, max); }
function normalizeEmail(value) { return clean(value, 160).toLowerCase(); }
function safeEqualHex(a, b) {
  try { const aa = Buffer.from(a, 'hex'); const bb = Buffer.from(b, 'hex'); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); } catch { return false; }
}
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function passwordOkay(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 160; }

function referralRequestOrigin(req) {
  const explicit = clean(process.env.REFERRAL_PUBLIC_ORIGIN || process.env.PUBLIC_APP_ORIGIN || '', 500).replace(/\/+$/, '');
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (!['http:','https:'].includes(url.protocol)) throw new Error('bad protocol');
      if (['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname)) throw new Error('private host');
      return url.origin;
    } catch {
      throw Object.assign(new Error('Invalid configured referral public origin'), { status: 500 });
    }
  }

  const railwayDomain = clean(process.env.RAILWAY_PUBLIC_DOMAIN || '', 255);
  if (railwayDomain && /^[A-Za-z0-9.-]+$/.test(railwayDomain) && !['localhost','127.0.0.1','0.0.0.0'].includes(railwayDomain)) {
    return `https://${railwayDomain}`;
  }

  const forwardedHost = clean(String(req.headers['x-forwarded-host'] || '').split(',')[0], 255);
  const host = forwardedHost || clean(req.get('host'), 255);
  if (!host || !/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) {
    throw Object.assign(new Error('Invalid public host'), { status: 400 });
  }
  const hostname = host.split(':')[0].toLowerCase();
  if (['localhost','127.0.0.1','0.0.0.0'].includes(hostname)) {
    throw Object.assign(new Error('Public referral origin is not configured'), { status: 503 });
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'https' ? 'https' : forwarded === 'http' ? 'http' : req.secure ? 'https' : 'http';
  return `${protocol}://${host}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}
async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const derived = await scryptAsync(password, salt, 64);
  return safeEqualHex(Buffer.from(derived).toString('hex'), expectedHash);
}

function legacyTokenAccount(token = '') {
  if (!TOKEN_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const issued = Number(parts[0]);
  if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_TTL_MS || issued > Date.now() + 60_000) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  if (!safeEqualHex(parts[2], expected)) return null;
  return { accountId: 1, legacy: true, issued };
}
function signLegacyToken() {
  const payload = `${Date.now()}.${crypto.randomUUID()}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function signAccountToken(accountId, sessionId) {
  const payload = `v2.${Date.now()}.${accountId}.${sessionId}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
async function resolveAccountToken(token = '') {
  const legacy = legacyTokenAccount(token);
  if (legacy) return legacy;
  if (!TOKEN_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v2') return null;
  const issued = Number(parts[1]);
  const accountId = Number(parts[2]);
  const sessionId = parts[3];
  if (!Number.isInteger(accountId) || accountId < 1 || !Number.isFinite(issued) || Date.now() - issued > TOKEN_TTL_MS || issued > Date.now() + 60_000) return null;
  const payload = parts.slice(0, 4).join('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  if (!safeEqualHex(parts[4], expected)) return null;
  const session = await pool.query(`SELECT account_id FROM account_sessions WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at > NOW()`, [sessionId, accountId]);
  if (!session.rowCount) return null;
  return { accountId, legacy: false, sessionId, issued };
}
async function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const resolved = await resolveAccountToken(token);
    if (!resolved) return res.status(401).json({ error: 'Unauthorized' });
    req.accountId = resolved.accountId;
    req.authSession = resolved;
    next();
  } catch (err) { next(err); }
}
async function createSession(accountId) {
  const sessionId = crypto.randomUUID();
  await pool.query(`INSERT INTO account_sessions(session_id,account_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '24 hours')`, [sessionId, accountId]);
  return { sessionId, token: signAccountToken(accountId, sessionId) };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGSERIAL PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_data_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS active_role TEXT NOT NULL DEFAULT 'merchant';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_salt TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_status TEXT NOT NULL DEFAULT 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique_idx ON accounts(LOWER(email)) WHERE email <> '';

    CREATE TABLE IF NOT EXISTS account_sessions (
      session_id TEXT PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id, expires_at DESC);

    CREATE TABLE IF NOT EXISTS profiles (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id, role)
    );
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('merchant','customer','supplier','courier','service_provider'));
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    CREATE TABLE IF NOT EXISTS businesses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'My Business',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'PH';
    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'PHP';

    CREATE TABLE IF NOT EXISTS business_memberships (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      membership_role TEXT NOT NULL DEFAULT 'owner',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS customer_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      preferred_address TEXT NOT NULL DEFAULT '',
      notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS supplier_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      delivery_available BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS courier_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      vehicle_type TEXT NOT NULL DEFAULT '',
      available BOOLEAN NOT NULL DEFAULT FALSE,
      max_weight_kg NUMERIC(10,2),
      max_volume_l NUMERIC(10,2),
      service_radius_km NUMERIC(10,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_status TEXT NOT NULL DEFAULT 'not_requested';

    CREATE TABLE IF NOT EXISTS service_provider_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      professional_headline TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      service_area TEXT NOT NULL DEFAULT '',
      years_experience NUMERIC(5,1),
      public_reputation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO accounts(id,display_name,active_role) VALUES(1,'Business owner','merchant') ON CONFLICT(id) DO NOTHING;
    INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES(1,'merchant',TRUE,'public','active')
      ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE;
    INSERT INTO businesses(id,name,country_code,currency_code) VALUES(1,'My Business','PH','PHP') ON CONFLICT(id) DO NOTHING;
    INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES(1,1,'owner',TRUE)
      ON CONFLICT(business_id,account_id) DO NOTHING;
    SELECT setval(pg_get_serial_sequence('accounts','id'), GREATEST((SELECT MAX(id) FROM accounts),1));
    SELECT setval(pg_get_serial_sequence('businesses','id'), GREATEST((SELECT MAX(id) FROM businesses),1));
  `);
  await ensurePersonIdentitySchema(pool);
  await ensureReferralAccountSchema(pool);
}

async function profileSnapshot(accountId) {
  const [account, profiles, businesses, customer, supplier, courier, serviceProvider] = await Promise.all([
    pool.query(`SELECT id,display_name,phone,email,address,avatar_data_url,active_role,identity_country_code,personal_public_id,email_verified_at,phone_verified_at,auth_status,(password_hash IS NOT NULL) has_password,created_at,updated_at FROM accounts WHERE id=$1`, [accountId]),
    pool.query(`SELECT role,enabled,visibility,status,created_at,updated_at FROM profiles WHERE account_id=$1 ORDER BY role`, [accountId]),
    pool.query(`SELECT b.id,b.name,b.country_code,b.currency_code,bm.membership_role,bm.active FROM businesses b JOIN business_memberships bm ON bm.business_id=b.id WHERE bm.account_id=$1 AND bm.active=TRUE ORDER BY b.id`, [accountId]),
    pool.query(`SELECT * FROM customer_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM supplier_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM service_provider_profiles WHERE account_id=$1`, [accountId])
  ]);
  if (!account.rows[0]) throw Object.assign(new Error('Account not found'), { status: 404 });
  return withPublicProfileIds({ account: account.rows[0], profiles: profiles.rows, businesses: businesses.rows, customer: customer.rows[0] || null, supplier: supplier.rows[0] || null, courier: courier.rows[0] || null, service_provider: serviceProvider.rows[0] || null });
}

function injectedIndex() {
  const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
  return html
    .replace('</head>', '  <link rel="stylesheet" href="/shell.css" />\n</head>')
    .replace('</body>', '  <script type="module" src="/shell.js"></script>\n  <script type="module" src="/auth-ui.js"></script>\n</body>');
}

app.get('/', (_req, res) => res.type('html').send(injectedIndex()));
app.get('/index.html', (_req, res) => res.type('html').send(injectedIndex()));
app.use(express.static(publicDir, { index: false }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const child = await fetch(`http://127.0.0.1:${internalAccountingPort}/health`).then(r => r.ok).catch(() => false);
    if (!child) return res.status(503).json({ ok: false, db: true, accounting: false, version: '0.3.7-account-auth' });
    res.json({ ok: true, db: true, accounting: true, version: '0.3.7-account-auth' });
  } catch { res.status(503).json({ ok: false, db: false, accounting: false, version: '0.3.7-account-auth' }); }
});

function throttled(req, identity) {
  const key = `${req.ip || 'unknown'}:${identity}`;
  const now = Date.now();
  const state = loginAttempts.get(key) || { count: 0, first: now };
  if (now - state.first > 15 * 60_000) { state.count = 0; state.first = now; }
  if (state.count >= 8) return true;
  state.count += 1; loginAttempts.set(key, state); return false;
}
function clearThrottle(req, identity) { loginAttempts.delete(`${req.ip || 'unknown'}:${identity}`); }

function growthAnalyticsThrottled(identity, limit = 90) {
  const key = String(identity || 'unknown');
  const now = Date.now();
  const state = growthAnalyticsAttempts.get(key) || { count: 0, first: now };
  if (now - state.first > 60_000) { state.count = 0; state.first = now; }
  if (state.count >= limit) return true;
  state.count += 1;
  growthAnalyticsAttempts.set(key, state);
  if (growthAnalyticsAttempts.size > 5000) {
    for (const [candidate, value] of growthAnalyticsAttempts) {
      if (now - value.first > 60_000) growthAnalyticsAttempts.delete(candidate);
    }
  }
  return false;
}

function canonicalReferralAnalyticsProperties(event, input = {}) {
  const role = clean(input?.source_profile_role, 40);
  if (!ROLES.has(role)) throw new TypeError('Unknown referral analytics source profile role');
  const output = {
    ...input,
    source_profile_role: role,
    campaign: `${role}_referral_v1`
  };
  if (event === 'referral_landing_viewed') {
    output.source = 'profile';
    output.medium = 'referral';
  }
  if (event === 'referral_signup_started') {
    output.source = 'profile';
  }
  return output;
}

async function sendReferralAnalytics(res, input) {
  let safe;
  try {
    safe = sanitizeReferralAnalyticsEvent(input);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const result = await deliverReferralAnalyticsEvent(safe);
    return res.status(202).json(result);
  } catch (error) {
    console.warn('Referral analytics delivery suppressed:', error.message);
    return res.status(202).json({ accepted: true, delivered: false, reason: 'delivery_error', event: safe.event });
  }
}

app.post('/api/auth/register', jsonBody, async (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  const name = clean(req.body?.display_name, 120);
  const password = String(req.body?.password || '');
  const phone = clean(req.body?.phone, 40);
  const address = clean(req.body?.address, 300);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!validEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!passwordOkay(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (throttled(req, email)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const client = await pool.connect();
  try {
    const exists = await client.query(`SELECT 1 FROM accounts WHERE LOWER(email)=$1`, [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });
    const { salt, hash } = await hashPassword(password);
    await client.query('BEGIN');
    const account = await client.query(`INSERT INTO accounts(display_name,phone,email,address,active_role,password_salt,password_hash,auth_status) VALUES($1,$2,$3,$4,'customer',$5,$6,'active') RETURNING id`, [name, phone, email, address, salt, hash]);
    const accountId = Number(account.rows[0].id);
    await client.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,'customer',TRUE,'private','active')`, [accountId]);
    await client.query(`INSERT INTO customer_profiles(account_id,preferred_address) VALUES($1,$2)`, [accountId, address]);
    await client.query('COMMIT');
    clearThrottle(req, email);

    const referralConversion = req.body?.referral_conversion;
    if (referralConversion && typeof referralConversion === 'object' && !Array.isArray(referralConversion)) {
      try {
        const binding = await bindReferralSignupConversion(pool, {
          referredAccountId: accountId,
          context: referralConversion
        });
        if (binding.bound && !binding.idempotent) {
          await deliverReferralAnalyticsEvent({
            event: 'referral_signup_completed',
            properties: {
              campaign: binding.campaign,
              source: binding.source || 'profile',
              source_profile_role: binding.sourceProfileRole,
              correlation_id: String(referralConversion.correlation_id || '')
            }
          }).catch(error => {
            console.warn('Referral signup-completed analytics suppressed:', error.message);
          });
        }
      } catch (error) {
        console.warn('Referral signup conversion binding suppressed:', error.message);
      }
    }

    const session = await createSession(accountId);
    res.status(201).json({ token: session.token, expires_in_hours: 24, profile: await profileSnapshot(accountId) });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); } finally { client.release(); }
});

app.post('/api/auth/login', jsonBody, async (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!validEmail(email) || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (throttled(req, email)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  try {
    const row = await pool.query(`SELECT id,password_salt,password_hash,auth_status FROM accounts WHERE LOWER(email)=$1`, [email]);
    const account = row.rows[0];
    if (!account || account.auth_status !== 'active' || !(await verifyPassword(password, account.password_salt, account.password_hash))) return res.status(401).json({ error: 'Incorrect email or password' });
    clearThrottle(req, email);
    const accountId = Number(account.id);
    const session = await createSession(accountId);
    res.json({ token: session.token, expires_in_hours: 24, profile: await profileSnapshot(accountId) });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', jsonBody, auth, async (req, res) => {
  if (!req.authSession.legacy && req.authSession.sessionId) await pool.query(`UPDATE account_sessions SET revoked_at=NOW() WHERE session_id=$1 AND account_id=$2`, [req.authSession.sessionId, req.accountId]);
  res.json({ ok: true });
});

app.post('/api/auth/password', jsonBody, auth, async (req, res, next) => {
  const current = String(req.body?.current_password || '');
  const nextPassword = String(req.body?.new_password || '');
  if (!passwordOkay(nextPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  try {
    const row = await pool.query(`SELECT password_salt,password_hash FROM accounts WHERE id=$1`, [req.accountId]);
    const account = row.rows[0];
    if (account?.password_hash && !(await verifyPassword(current, account.password_salt, account.password_hash))) return res.status(403).json({ error: 'Current password is incorrect' });
    const { salt, hash } = await hashPassword(nextPassword);
    await pool.query(`UPDATE accounts SET password_salt=$1,password_hash=$2,updated_at=NOW() WHERE id=$3`, [salt, hash, req.accountId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/me', auth, async (req, res, next) => { try { res.json(await profileSnapshot(req.accountId)); } catch (err) { next(err); } });

app.get('/api/growth/referral', auth, async (req, res, next) => {
  try {
    const account = await pool.query(
      `SELECT display_name,active_role FROM accounts WHERE id=$1`,
      [req.accountId]
    );
    if (!account.rowCount) return res.status(404).json({ error: 'Account not found' });

    let role;
    try {
      role = normalizeReferralProfileRole(req.query?.profile, account.rows[0].active_role || 'customer');
    } catch {
      return res.status(400).json({ error: 'Unknown public profile role' });
    }

    const enabled = await pool.query(
      `SELECT 1 FROM profiles WHERE account_id=$1 AND role=$2 AND enabled=TRUE`,
      [req.accountId, role]
    );
    if (!enabled.rowCount) return res.status(403).json({ error: 'This profile is not enabled' });

    const identity = await ensureAccountReferral(pool, req.accountId);
    const payload = buildLiveReferralPayload({
      code: identity.referral_code,
      origin: referralRequestOrigin(req),
      profileRole: role,
      inviterDisplayName: account.rows[0].display_name || ''
    });
    const qr = await buildLocalReferralQr(payload.referralUrl);
    res.json({ ...payload, campaign: new URL(payload.referralUrl).searchParams.get('utm_campaign'), qr });
  } catch (err) {
    next(err);
  }
});

app.post('/api/growth/referral-analytics/account', jsonBody, auth, async (req, res, next) => {
  const event = clean(req.body?.event, 80);
  if (!ACCOUNT_REFERRAL_ANALYTICS_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Referral analytics event is not allowed for account instrumentation' });
  }
  if (growthAnalyticsThrottled(`account:${req.accountId}`, 120)) {
    return res.status(429).json({ error: 'Referral analytics rate limit exceeded' });
  }

  let properties;
  try {
    properties = canonicalReferralAnalyticsProperties(event, req.body?.properties);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const enabled = await pool.query(
      'SELECT 1 FROM profiles WHERE account_id=$1 AND role=$2 AND enabled=TRUE LIMIT 1',
      [req.accountId, properties.source_profile_role]
    );
    if (!enabled.rowCount) {
      return res.status(403).json({ error: 'Referral analytics source profile is not enabled' });
    }
    return sendReferralAnalytics(res, { event, properties });
  } catch (err) {
    next(err);
  }
});

app.post('/api/growth/referral-analytics/public', jsonBody, async (req, res, next) => {
  const event = clean(req.body?.event, 80);
  if (!PUBLIC_REFERRAL_ANALYTICS_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Referral analytics event is not allowed for public instrumentation' });
  }
  if (growthAnalyticsThrottled(`public:${req.ip || 'unknown'}`, 60)) {
    return res.status(429).json({ error: 'Referral analytics rate limit exceeded' });
  }

  const referralCode = clean(req.body?.referral_code, 40);
  if (!isValidReferralCode(referralCode)) {
    return res.status(202).json({ accepted: false, delivered: false, reason: 'invalid_referral' });
  }

  let properties;
  try {
    properties = canonicalReferralAnalyticsProperties(event, req.body?.properties);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const known = await pool.query(
      `SELECT ra.account_id AS referrer_account_id
         FROM referral_accounts ra
         JOIN profiles p ON p.account_id=ra.account_id
         WHERE ra.referral_code=$1 AND p.role=$2 AND p.enabled=TRUE
         LIMIT 1`,
      [referralCode, properties.source_profile_role]
    );
    if (!known.rowCount) {
      return res.status(202).json({ accepted: false, delivered: false, reason: 'unknown_referral' });
    }
    try {
      await persistUnconvertedReferralEvent(pool, {
        referrerAccountId: Number(known.rows[0].referrer_account_id),
        referralCode,
        event,
        properties
      });
    } catch (error) {
      console.warn('Referral attribution persistence suppressed:', error.message);
    }
    return sendReferralAnalytics(res, { event, properties });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/me', jsonBody, auth, async (req, res, next) => {
  const name = clean(req.body?.display_name, 120);
  const phone = clean(req.body?.phone, 40);
  const email = normalizeEmail(req.body?.email);
  const address = clean(req.body?.address, 300);
  if (!name) return res.status(400).json({ error: 'Display name is required' });
  if (email && !validEmail(email)) return res.status(400).json({ error: 'Email is invalid' });
  let avatar = req.body?.avatar_data_url;
  if (avatar !== undefined) {
    avatar = clean(avatar, 320_000);
    if (avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) return res.status(400).json({ error: 'Avatar must be a PNG, JPEG or WebP image' });
    if (avatar.length > 300_000) return res.status(413).json({ error: 'Avatar is too large' });
  }
  try {
    if (email) {
      const duplicate = await pool.query(`SELECT id FROM accounts WHERE LOWER(email)=$1 AND id<>$2`, [email, req.accountId]);
      if (duplicate.rowCount) return res.status(409).json({ error: 'That email is already used by another account' });
    }
    await pool.query(`UPDATE accounts SET display_name=$1,phone=$2,email=$3,address=$4,avatar_data_url=COALESCE($5,avatar_data_url),updated_at=NOW() WHERE id=$6`, [name, phone, email, address, avatar === undefined ? null : avatar, req.accountId]);
    res.json(await profileSnapshot(req.accountId));
  } catch (err) { next(err); }
});

app.patch('/api/me/active-role', jsonBody, auth, async (req, res, next) => {
  const role = clean(req.body?.role, 40);
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
  try {
    const enabled = await pool.query(`SELECT 1 FROM profiles WHERE account_id=$1 AND role=$2 AND enabled=TRUE`, [req.accountId, role]);
    if (!enabled.rowCount) return res.status(403).json({ error: 'Enable this profile first' });
    await pool.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2`, [role, req.accountId]);
    res.json(await profileSnapshot(req.accountId));
  } catch (err) { next(err); }
});

app.put('/api/profiles/:role', jsonBody, auth, async (req, res, next) => {
  const role = req.params.role;
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
  const enabled = req.body?.enabled !== false;
  const visibility = ['public', 'relationship_only', 'private'].includes(req.body?.visibility) ? req.body.visibility : 'private';
  if (role === 'merchant' && req.accountId === 1 && !enabled) return res.status(409).json({ error: 'The bootstrap Merchant profile cannot be disabled during migration.' });
  try {
    await pool.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(account_id,role) DO UPDATE SET enabled=EXCLUDED.enabled,visibility=EXCLUDED.visibility,updated_at=NOW()`, [req.accountId, role, enabled, visibility]);
    if (enabled && role === 'customer') await pool.query(`INSERT INTO customer_profiles(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
    if (enabled && role === 'supplier') await pool.query(`INSERT INTO supplier_profiles(account_id,supplier_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
    if (enabled && role === 'courier') await pool.query(`INSERT INTO courier_profiles(account_id,display_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
    if (enabled && role === 'service_provider') await pool.query(`INSERT INTO service_provider_profiles(account_id,display_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
    if (enabled && role === 'merchant') {
      const membership = await pool.query(`SELECT 1 FROM business_memberships WHERE account_id=$1 AND active=TRUE LIMIT 1`, [req.accountId]);
      if (!membership.rowCount) {
        const name = await pool.query(`SELECT display_name FROM accounts WHERE id=$1`, [req.accountId]);
        const business = await pool.query(`INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id`, [`${name.rows[0]?.display_name || 'My'} Business`]);
        await pool.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)`, [business.rows[0].id, req.accountId]);
      }
    }
    if (!enabled) {
      const fallback = req.accountId === 1 ? 'merchant' : 'customer';
      await pool.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2 AND active_role=$3`, [fallback, req.accountId, role]);
    }
    res.json(await profileSnapshot(req.accountId));
  } catch (err) { next(err); }
});

app.get('/api/context/:role', auth, async (req, res, next) => {
  const role = req.params.role;
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
  try {
    const p = await pool.query(`SELECT enabled,status,visibility FROM profiles WHERE account_id=$1 AND role=$2`, [req.accountId, role]);
    if (!p.rowCount || !p.rows[0].enabled) return res.status(403).json({ error: 'This profile is not enabled' });
    const capabilities = {
      merchant: ['accounting', 'money', 'inventory', 'menu', 'orders', 'storefront', 'suppliers', 'reports'],
      customer: ['marketplace', 'food', 'non-food', 'local services', 'orders', 'payments', 'delivery tracking', 'platform store'],
      supplier: ['catalog', 'incoming purchase orders', 'production ETA', 'pickup/delivery response'],
      courier: ['eligibility', 'availability', 'assigned deliveries', 'pickup', 'live delivery status', 'proof of delivery'],
      service_provider: ['public profile', 'services', 'credentials/CV', 'quotes', 'jobs', 'portfolio', 'reviews']
    };
    res.json({ role, profile: p.rows[0], capabilities: capabilities[role] });
  } catch (err) { next(err); }
});

function pipeToAccounting(req, res, authorizationOverride = null) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalAccountingPort}` };
  if (authorizationOverride) headers.authorization = authorizationOverride;
  const upstream = http.request({ hostname: '127.0.0.1', port: internalAccountingPort, path: req.originalUrl, method: req.method, headers }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    for (const [key, value] of Object.entries(upstreamRes.headers)) if (value !== undefined) res.setHeader(key, value);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => { console.error('Accounting proxy error', err); if (!res.headersSent) res.status(502).json({ error: 'Accounting service unavailable' }); });
  req.pipe(upstream);
}

app.use('/api', async (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') return pipeToAccounting(req, res);
  try {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const session = await resolveAccountToken(raw);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    if (session.legacy) return pipeToAccounting(req, res);
    const access = await pool.query(`SELECT 1 FROM profiles p JOIN business_memberships bm ON bm.account_id=p.account_id AND bm.active=TRUE WHERE p.account_id=$1 AND p.role='merchant' AND p.enabled=TRUE LIMIT 1`, [session.accountId]);
    if (!access.rowCount) return res.status(403).json({ error: 'Merchant accounting access is not available for this account' });
    if (session.accountId !== 1) return res.status(409).json({ error: 'Multi-business accounting isolation is being migrated before this Merchant workspace can use the legacy ledger.' });
    return pipeToAccounting(req, res, `Bearer ${signLegacyToken()}`);
  } catch (err) { next(err); }
});

function startAccountingChild() {
  accountingChild = spawn(process.execPath, ['server-v03.js'], { cwd: __dirname, env: { ...process.env, PORT: String(internalAccountingPort) }, stdio: 'inherit' });
  accountingChild.on('exit', code => { if (!shuttingDown) { console.error(`Accounting child exited with code ${code}`); process.exit(code || 1); } });
}
async function waitForAccounting() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${internalAccountingPort}/health`); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Accounting child failed health check');
}
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);
  if (accountingChild && !accountingChild.killed) accountingChild.kill('SIGTERM');
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Unexpected server error' });
});

initDb().then(async () => {
  startAccountingChild();
  await waitForAccounting();
  app.listen(port, '0.0.0.0', () => console.log(`Business & Life account server listening on ${port}`));
}).catch(err => { console.error(err); process.exit(1); });
