import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const APP_PIN = process.env.APP_PIN || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const loginAttempts = new Map();
const ACCOUNTS = new Set(['cash', 'gcash', 'bank', 'other']);
const TYPES = new Set(['sale', 'business_expense', 'money_received', 'personal_withdrawal', 'adjustment']);

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

function signToken() {
  const payload = `${Date.now()}.${crypto.randomUUID()}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
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
  next();
}
function cleanText(value, max = 250) { return String(value ?? '').trim().slice(0, max); }
function validMoney(value) { return Number.isFinite(Number(value)) && Number(value) >= 0; }
function accountOrDefault(value) { return ACCOUNTS.has(value) ? value : 'cash'; }

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('sale','business_expense','money_received','personal_withdrawal','adjustment')),
      category TEXT NOT NULL DEFAULT 'Other',
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      payment_method TEXT NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL DEFAULT '',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'cash';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id BIGINT;

    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      item TEXT UNIQUE NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
      reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_openings (
      business_date DATE PRIMARY KEY,
      opening_cash NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_closings (
      business_date DATE PRIMARY KEY,
      expected_cash NUMERIC(12,2) NOT NULL,
      actual_cash NUMERIC(12,2) NOT NULL,
      variance NUMERIC(12,2) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS remittances (
      id BIGSERIAL PRIMARY KEY,
      sent_amount NUMERIC(12,2) NOT NULL CHECK (sent_amount >= 0),
      sent_currency TEXT NOT NULL DEFAULT 'EUR',
      fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      exchange_rate NUMERIC(14,6),
      expected_php NUMERIC(12,2),
      received_php NUMERIC(12,2) NOT NULL CHECK (received_php >= 0),
      account TEXT NOT NULL DEFAULT 'gcash',
      provider TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      personal_daily_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      personal_weekly_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      business_daily_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      min_available_warning NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO budgets(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      action TEXT NOT NULL,
      before_data JSONB,
      after_data JSONB,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS transactions_occurred_idx ON transactions(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions(account);
    CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id, created_at DESC);
  `);
}

async function dayStatus() {
  const opening = await pool.query(`SELECT opening_cash,note FROM daily_openings WHERE business_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`);
  const movement = await pool.query(`
    SELECT COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) movement
    FROM transactions
    WHERE account='cash' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date
  `);
  const closing = await pool.query(`SELECT expected_cash,actual_cash,variance,note,created_at FROM daily_closings WHERE business_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`);
  const openingCash = Number(opening.rows[0]?.opening_cash || 0);
  const cashMovement = Number(movement.rows[0]?.movement || 0);
  return {
    business_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
    has_opening: opening.rowCount > 0,
    opening_cash: openingCash,
    cash_movement: cashMovement,
    expected_cash: openingCash + cashMovement,
    closing: closing.rows[0] || null
  };
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true }); }
  catch { res.status(503).json({ ok: false, db: false }); }
});

app.post('/api/login', (req, res) => {
  if (!APP_PIN || !TOKEN_SECRET) return res.status(503).json({ error: 'App security is not configured' });
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60_000 };
  if (now > current.resetAt) { current.count = 0; current.resetAt = now + 15 * 60_000; }
  if (current.count >= 5) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const supplied = String(req.body?.pin || '');
  if (supplied !== APP_PIN) {
    current.count += 1; loginAttempts.set(key, current);
    return res.status(401).json({ error: 'Incorrect PIN' });
  }
  loginAttempts.delete(key);
  res.json({ token: signToken(), expires_in_hours: 24 });
});

app.get('/api/summary', auth, async (_req, res) => {
  const totals = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,
      COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business_expenses,
      COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) money_received,
      COALESCE(SUM(CASE WHEN type='money_received' AND source='remittance' THEN amount ELSE 0 END),0) remittance_received,
      COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal_withdrawals,
      COALESCE(SUM(CASE WHEN type='adjustment' THEN amount ELSE 0 END),0) adjustments,
      COALESCE(SUM(CASE WHEN type='sale' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_sales,
      COALESCE(SUM(CASE WHEN type='business_expense' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_business_expenses,
      COALESCE(SUM(CASE WHEN type='personal_withdrawal' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_personal
    FROM transactions
  `);
  const accounts = await pool.query(`
    SELECT account, COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) balance
    FROM transactions GROUP BY account
  `);
  const low = await pool.query(`SELECT COUNT(*)::int count FROM inventory WHERE quantity <= reorder_level`);
  const budget = await pool.query(`SELECT * FROM budgets WHERE id=1`);
  const t = totals.rows[0];
  const available = Number(t.sales) + Number(t.money_received) + Number(t.adjustments) - Number(t.business_expenses) - Number(t.personal_withdrawals);
  const personal7 = await pool.query(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE type='personal_withdrawal' AND occurred_at >= NOW() - INTERVAL '7 days'`);
  const b = budget.rows[0];
  const warnings = [];
  if (Number(b.personal_daily_limit) > 0 && Number(t.today_personal) > Number(b.personal_daily_limit)) warnings.push('Personal spending is over today’s limit.');
  if (Number(b.personal_weekly_limit) > 0 && Number(personal7.rows[0].v) > Number(b.personal_weekly_limit)) warnings.push('Personal spending is over the 7-day limit.');
  if (Number(b.min_available_warning) > 0 && available < Number(b.min_available_warning)) warnings.push('Available money is below the safety level.');
  const byAccount = { cash: 0, gcash: 0, bank: 0, other: 0 };
  for (const row of accounts.rows) byAccount[row.account] = Number(row.balance);
  res.json({
    ...t,
    profit: Number(t.sales) - Number(t.business_expenses),
    available_total: available,
    today_profit: Number(t.today_sales) - Number(t.today_business_expenses),
    accounts: byAccount,
    low_stock: low.rows[0].count,
    budget: b,
    warnings
  });
});

app.get('/api/transactions', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC LIMIT 500`);
  res.json(rows);
});
app.post('/api/transactions', auth, async (req, res) => {
  const { type, category='Other', amount, account='cash', note='', occurred_at } = req.body || {};
  if (!TYPES.has(type) || !validMoney(amount) || !ACCOUNTS.has(account)) return res.status(400).json({ error: 'Invalid transaction' });
  const { rows } = await pool.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,occurred_at) VALUES($1,$2,$3,$4,$4,$5,COALESCE($6::timestamptz,NOW())) RETURNING *`, [type, cleanText(category,80)||'Other', Number(amount), account, cleanText(note), occurred_at || null]);
  res.status(201).json(rows[0]);
});
app.patch('/api/transactions/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const old = await pool.query(`SELECT * FROM transactions WHERE id=$1`, [id]);
  if (!old.rowCount) return res.status(404).json({ error: 'Transaction not found' });
  const prev = old.rows[0];
  const type = req.body.type ?? prev.type;
  const amount = req.body.amount ?? prev.amount;
  const account = req.body.account ?? prev.account;
  if (!TYPES.has(type) || !validMoney(amount) || !ACCOUNTS.has(account)) return res.status(400).json({ error: 'Invalid correction' });
  const next = await pool.query(`UPDATE transactions SET type=$1,category=$2,amount=$3,payment_method=$4,account=$4,note=$5,occurred_at=COALESCE($6::timestamptz,occurred_at) WHERE id=$7 RETURNING *`, [type, cleanText(req.body.category ?? prev.category,80)||'Other', Number(amount), account, cleanText(req.body.note ?? prev.note), req.body.occurred_at || null, id]);
  await pool.query(`INSERT INTO audit_events(entity_type,entity_id,action,before_data,after_data,reason) VALUES('transaction',$1,'correction',$2::jsonb,$3::jsonb,$4)`, [id, JSON.stringify(prev), JSON.stringify(next.rows[0]), cleanText(req.body.reason || 'Manual correction')]);
  res.json(next.rows[0]);
});
app.get('/api/transactions/:id/audit', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM audit_events WHERE entity_type='transaction' AND entity_id=$1 ORDER BY created_at DESC`, [Number(req.params.id)]);
  res.json(rows);
});

app.get('/api/inventory', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM inventory ORDER BY (quantity <= reorder_level) DESC, item ASC`);
  res.json(rows);
});
app.post('/api/inventory', auth, async (req, res) => {
  const { item, unit='pcs', quantity=0, reorder_level=0, unit_cost=0 } = req.body || {};
  if (!cleanText(item,100)) return res.status(400).json({ error: 'Item is required' });
  const { rows } = await pool.query(`INSERT INTO inventory(item,unit,quantity,reorder_level,unit_cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(item) DO UPDATE SET unit=EXCLUDED.unit,quantity=EXCLUDED.quantity,reorder_level=EXCLUDED.reorder_level,unit_cost=EXCLUDED.unit_cost,updated_at=NOW() RETURNING *`, [cleanText(item,100), cleanText(unit,20)||'pcs', Number(quantity)||0, Number(reorder_level)||0, Number(unit_cost)||0]);
  res.status(201).json(rows[0]);
});

app.get('/api/remittances', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT *, (received_php-COALESCE(expected_php,received_php)) difference_php FROM remittances ORDER BY sent_at DESC,id DESC LIMIT 100`);
  res.json(rows);
});
app.post('/api/remittances', auth, async (req, res) => {
  const { sent_amount, sent_currency='EUR', fee_amount=0, exchange_rate=null, expected_php=null, received_php, account='gcash', provider='', reference='', note='', sent_at, received_at } = req.body || {};
  if (!validMoney(sent_amount) || !validMoney(fee_amount) || !validMoney(received_php) || !ACCOUNTS.has(account)) return res.status(400).json({ error: 'Invalid remittance' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`INSERT INTO remittances(sent_amount,sent_currency,fee_amount,exchange_rate,expected_php,received_php,account,provider,reference,note,sent_at,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,NOW()),COALESCE($12::timestamptz,NOW())) RETURNING *`, [Number(sent_amount), cleanText(sent_currency,8).toUpperCase()||'EUR', Number(fee_amount), exchange_rate ? Number(exchange_rate) : null, expected_php === '' || expected_php == null ? null : Number(expected_php), Number(received_php), account, cleanText(provider,80), cleanText(reference,120), cleanText(note), sent_at || null, received_at || null]);
    const rem = r.rows[0];
    if (Number(received_php) > 0) await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES('money_received','Remittance',$1,$2,$2,$3,'remittance',$4,COALESCE($5::timestamptz,NOW()))`, [Number(received_php), account, cleanText(`${provider}${reference ? ` • ${reference}` : ''}`), rem.id, received_at || null]);
    await client.query('COMMIT');
    res.status(201).json(rem);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});

app.get('/api/day-status', auth, async (_req, res) => res.json(await dayStatus()));
app.post('/api/open-day', auth, async (req, res) => {
  if (!validMoney(req.body?.opening_cash)) return res.status(400).json({ error: 'Opening cash is required' });
  const { rows } = await pool.query(`INSERT INTO daily_openings(business_date,opening_cash,note) VALUES((NOW() AT TIME ZONE 'Asia/Manila')::date,$1,$2) ON CONFLICT(business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,note=EXCLUDED.note,updated_at=NOW() RETURNING *`, [Number(req.body.opening_cash), cleanText(req.body.note)]);
  res.json({ opening: rows[0], status: await dayStatus() });
});
app.post('/api/close-day', auth, async (req, res) => {
  const actual = Number(req.body?.actual_cash);
  if (!Number.isFinite(actual) || actual < 0) return res.status(400).json({ error: 'Actual cash is required' });
  const status = await dayStatus();
  if (!status.has_opening) return res.status(400).json({ error: 'Record opening cash first.' });
  const variance = actual - status.expected_cash;
  const { rows } = await pool.query(`INSERT INTO daily_closings(business_date,opening_cash,expected_cash,actual_cash,variance,note) VALUES((NOW() AT TIME ZONE 'Asia/Manila')::date,$1,$2,$3,$4,$5) ON CONFLICT(business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,expected_cash=EXCLUDED.expected_cash,actual_cash=EXCLUDED.actual_cash,variance=EXCLUDED.variance,note=EXCLUDED.note RETURNING *`, [status.opening_cash, status.expected_cash, actual, variance, cleanText(req.body?.note)]);
  res.json(rows[0]);
});

app.get('/api/budget', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM budgets WHERE id=1`); res.json(rows[0]);
});
app.post('/api/budget', auth, async (req, res) => {
  const keys = ['personal_daily_limit','personal_weekly_limit','business_daily_limit','min_available_warning'];
  if (keys.some(k => !validMoney(req.body?.[k] ?? 0))) return res.status(400).json({ error: 'Budget values must be zero or greater' });
  const { rows } = await pool.query(`UPDATE budgets SET personal_daily_limit=$1,personal_weekly_limit=$2,business_daily_limit=$3,min_available_warning=$4,updated_at=NOW() WHERE id=1 RETURNING *`, keys.map(k => Number(req.body?.[k] || 0)));
  res.json(rows[0]);
});

app.get('/api/analysis', auth, async (req, res) => {
  const days = Number(req.query.days) === 30 ? 30 : 7;
  const categories = await pool.query(`SELECT CASE WHEN type='business_expense' THEN 'business' ELSE 'personal' END kind,category,COALESCE(SUM(amount),0) total FROM transactions WHERE type IN ('business_expense','personal_withdrawal') AND occurred_at >= NOW() - ($1::int * INTERVAL '1 day') GROUP BY kind,category ORDER BY total DESC`, [days]);
  const totals = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal,COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) received FROM transactions WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day')`, [days]);
  res.json({ days, totals: totals.rows[0], categories: categories.rows });
});

app.get('/api/export.csv', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT id,type,category,amount,account,source,note,occurred_at FROM transactions ORDER BY occurred_at ASC`);
  const esc = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const csv = ['id,type,category,amount,account,source,note,occurred_at', ...rows.map(r => [r.id,r.type,r.category,r.amount,r.account,r.source,r.note,r.occurred_at.toISOString()].map(esc).join(','))].join('\n');
  res.type('text/csv').set('Content-Disposition','attachment; filename="transactions.csv"').send(csv);
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error' }); });

initDb().then(() => app.listen(port, '0.0.0.0', () => console.log(`Accounting app listening on ${port}`))).catch(err => { console.error(err); process.exit(1); });
