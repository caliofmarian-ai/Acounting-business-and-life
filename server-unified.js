import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePersonIdentitySchema, withPublicProfileIds } from './person-profile-identity.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');
const app = express();
const port = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ROLES = new Set(['merchant', 'customer', 'supplier', 'courier', 'service_provider']);
const jsonBody = express.json({ limit: '450kb' });
let accountingChild;
let shuttingDown = false;

function validToken(token = '') {
  if (!TOKEN_SECRET || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const issued = Number(parts[0]);
  if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_TTL_MS || issued > Date.now() + 60_000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected)); } catch { return false; }
}
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!validToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  req.accountId = 1;
  next();
}
function clean(value, max = 250) { return String(value ?? '').trim().slice(0, max); }

async function initProfileDb() {
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
    INSERT INTO businesses(id,name) VALUES(1,'My Business') ON CONFLICT(id) DO NOTHING;
    INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES(1,1,'owner',TRUE)
      ON CONFLICT(business_id,account_id) DO NOTHING;
    SELECT setval(pg_get_serial_sequence('accounts','id'), GREATEST((SELECT MAX(id) FROM accounts),1));
    SELECT setval(pg_get_serial_sequence('businesses','id'), GREATEST((SELECT MAX(id) FROM businesses),1));
  `);
  await ensurePersonIdentitySchema(pool);
}

async function profileSnapshot(accountId = 1) {
  const [account, profiles, businesses, customer, supplier, courier, serviceProvider] = await Promise.all([
    pool.query(`SELECT id,display_name,phone,email,address,avatar_data_url,active_role,identity_country_code,personal_public_id,created_at,updated_at FROM accounts WHERE id=$1`, [accountId]),
    pool.query(`SELECT role,enabled,visibility,status,created_at,updated_at FROM profiles WHERE account_id=$1 ORDER BY role`, [accountId]),
    pool.query(`SELECT b.id,b.name,bm.membership_role,bm.active FROM businesses b JOIN business_memberships bm ON bm.business_id=b.id WHERE bm.account_id=$1 AND bm.active=TRUE ORDER BY b.id`, [accountId]),
    pool.query(`SELECT * FROM customer_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM supplier_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`, [accountId]),
    pool.query(`SELECT * FROM service_provider_profiles WHERE account_id=$1`, [accountId])
  ]);
  return withPublicProfileIds({
    account: account.rows[0],
    profiles: profiles.rows,
    businesses: businesses.rows,
    customer: customer.rows[0] || null,
    supplier: supplier.rows[0] || null,
    courier: courier.rows[0] || null,
    service_provider: serviceProvider.rows[0] || null
  });
}

function injectedIndex() {
  const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
  return html
    .replace('</head>', '  <link rel="stylesheet" href="/shell.css" />\n</head>')
    .replace('</body>', '  <script type="module" src="/shell.js"></script>\n</body>');
}

app.get('/', (_req, res) => res.type('html').send(injectedIndex()));
app.get('/index.html', (_req, res) => res.type('html').send(injectedIndex()));
app.use(express.static(publicDir, { index: false }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const child = await fetch(`http://127.0.0.1:${internalPort}/health`).then(r => r.ok).catch(() => false);
    if (!child) return res.status(503).json({ ok: false, db: true, accounting: false, version: '0.3.6-unified-shell' });
    res.json({ ok: true, db: true, accounting: true, version: '0.3.6-unified-shell' });
  } catch {
    res.status(503).json({ ok: false, db: false, accounting: false, version: '0.3.6-unified-shell' });
  }
});

app.get('/api/me', auth, async (req, res) => res.json(await profileSnapshot(req.accountId)));
app.patch('/api/me', jsonBody, auth, async (req, res) => {
  const name = clean(req.body?.display_name, 120);
  const phone = clean(req.body?.phone, 40);
  const email = clean(req.body?.email, 160);
  const address = clean(req.body?.address, 300);
  if (!name) return res.status(400).json({ error: 'Display name is required' });
  let avatar = req.body?.avatar_data_url;
  if (avatar !== undefined) {
    avatar = clean(avatar, 320_000);
    if (avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) return res.status(400).json({ error: 'Avatar must be a PNG, JPEG or WebP image' });
    if (avatar.length > 300_000) return res.status(413).json({ error: 'Avatar is too large' });
  }
  await pool.query(`UPDATE accounts SET display_name=$1,phone=$2,email=$3,address=$4,avatar_data_url=COALESCE($5,avatar_data_url),updated_at=NOW() WHERE id=$6`, [name, phone, email, address, avatar === undefined ? null : avatar, req.accountId]);
  res.json(await profileSnapshot(req.accountId));
});

app.patch('/api/me/active-role', jsonBody, auth, async (req, res) => {
  const role = clean(req.body?.role, 40);
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
  const enabled = await pool.query(`SELECT 1 FROM profiles WHERE account_id=$1 AND role=$2 AND enabled=TRUE`, [req.accountId, role]);
  if (!enabled.rowCount) return res.status(403).json({ error: 'Enable this profile first' });
  await pool.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2`, [role, req.accountId]);
  res.json(await profileSnapshot(req.accountId));
});

app.put('/api/profiles/:role', jsonBody, auth, async (req, res) => {
  const role = req.params.role;
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
  const enabled = req.body?.enabled !== false;
  const visibility = ['public', 'relationship_only', 'private'].includes(req.body?.visibility) ? req.body.visibility : 'private';
  await pool.query(`INSERT INTO profiles(account_id,role,enabled,visibility,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,role) DO UPDATE SET enabled=EXCLUDED.enabled,visibility=EXCLUDED.visibility,status=EXCLUDED.status,updated_at=NOW()`, [req.accountId, role, enabled, visibility,enabled?'active':'disabled']);
  if (enabled && role === 'customer') await pool.query(`INSERT INTO customer_profiles(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
  if (enabled && role === 'supplier') await pool.query(`INSERT INTO supplier_profiles(account_id,supplier_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
  if (enabled && role === 'courier') await pool.query(`INSERT INTO courier_profiles(account_id,display_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
  if (enabled && role === 'service_provider') await pool.query(`INSERT INTO service_provider_profiles(account_id,display_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`, [req.accountId]);
  if (!enabled) { const next=await pool.query(`SELECT role FROM profiles WHERE account_id=$1 AND enabled=TRUE AND role<>$2 ORDER BY created_at LIMIT 1`,[req.accountId,role]);await pool.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2 AND active_role=$3`, [next.rows[0]?.role||null,req.accountId,role]); }
  res.json(await profileSnapshot(req.accountId));
});

app.get('/api/context/:role', auth, async (req, res) => {
  const role = req.params.role;
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Unknown profile role' });
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
});

function proxyToAccounting(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  const upstream = http.request({ hostname: '127.0.0.1', port: internalPort, path: req.originalUrl, method: req.method, headers }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    for (const [key, value] of Object.entries(upstreamRes.headers)) if (value !== undefined) res.setHeader(key, value);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    console.error('Accounting proxy error', err);
    if (!res.headersSent) res.status(502).json({ error: 'Accounting service unavailable' });
  });
  req.pipe(upstream);
}
app.use('/api', proxyToAccounting);

function startAccountingChild() {
  accountingChild = spawn(process.execPath, ['server-v03.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(internalPort) },
    stdio: 'inherit'
  });
  accountingChild.on('exit', code => {
    if (!shuttingDown) {
      console.error(`Accounting child exited with code ${code}`);
      process.exit(code || 1);
    }
  });
}

async function waitForAccounting() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${internalPort}/health`);
      if (r.ok) return;
    } catch {}
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

initProfileDb()
  .then(async () => {
    startAccountingChild();
    await waitForAccounting();
    app.listen(port, '0.0.0.0', () => console.log(`Unified Business & Life shell listening on ${port}`));
  })
  .catch(err => { console.error(err); process.exit(1); });
