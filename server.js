import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const APP_PIN = process.env.APP_PIN || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';

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
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected)); } catch { return false; }
}
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!validToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

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
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      item TEXT UNIQUE NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
      reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
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
  `);
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/login', (req, res) => {
  if (!APP_PIN || !TOKEN_SECRET) return res.status(503).json({ error: 'App security is not configured' });
  const supplied = String(req.body?.pin || '');
  if (supplied !== APP_PIN) return res.status(401).json({ error: 'Incorrect PIN' });
  res.json({ token: signToken() });
});

app.get('/api/summary', auth, async (_req, res) => {
  const { rows } = await pool.query(`
    WITH totals AS (
      SELECT
        COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,
        COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business_expenses,
        COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) money_received,
        COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal_withdrawals,
        COALESCE(SUM(CASE WHEN type='adjustment' THEN amount ELSE 0 END),0) adjustments
      FROM transactions
    ), today AS (
      SELECT
        COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) today_sales,
        COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) today_business_expenses,
        COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) today_personal
      FROM transactions
      WHERE (occurred_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
    )
    SELECT *,
      (sales - business_expenses) profit,
      (sales + money_received + adjustments - business_expenses - personal_withdrawals) cash_expected,
      (today_sales - today_business_expenses) today_profit
    FROM totals CROSS JOIN today;
  `);
  const low = await pool.query(`SELECT COUNT(*)::int count FROM inventory WHERE quantity <= reorder_level`);
  res.json({ ...rows[0], low_stock: low.rows[0].count });
});

app.get('/api/transactions', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC LIMIT 250`);
  res.json(rows);
});
app.post('/api/transactions', auth, async (req, res) => {
  const { type, category = 'Other', amount, payment_method = 'cash', note = '', occurred_at } = req.body || {};
  const allowed = new Set(['sale','business_expense','money_received','personal_withdrawal','adjustment']);
  if (!allowed.has(type) || !Number.isFinite(Number(amount)) || Number(amount) < 0) return res.status(400).json({ error: 'Invalid transaction' });
  const { rows } = await pool.query(`INSERT INTO transactions(type,category,amount,payment_method,note,occurred_at) VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz,NOW())) RETURNING *`, [type, category, Number(amount), payment_method, note, occurred_at || null]);
  res.status(201).json(rows[0]);
});

app.get('/api/inventory', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM inventory ORDER BY (quantity <= reorder_level) DESC, item ASC`);
  res.json(rows);
});
app.post('/api/inventory', auth, async (req, res) => {
  const { item, unit='pcs', quantity=0, reorder_level=0, unit_cost=0 } = req.body || {};
  if (!String(item || '').trim()) return res.status(400).json({ error: 'Item is required' });
  const { rows } = await pool.query(`INSERT INTO inventory(item,unit,quantity,reorder_level,unit_cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(item) DO UPDATE SET unit=EXCLUDED.unit, quantity=EXCLUDED.quantity, reorder_level=EXCLUDED.reorder_level, unit_cost=EXCLUDED.unit_cost, updated_at=NOW() RETURNING *`, [String(item).trim(), unit, Number(quantity), Number(reorder_level), Number(unit_cost)]);
  res.status(201).json(rows[0]);
});

app.post('/api/close-day', auth, async (req, res) => {
  const actual = Number(req.body?.actual_cash);
  if (!Number.isFinite(actual)) return res.status(400).json({ error: 'Actual cash is required' });
  const s = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) expected FROM transactions`);
  const expected = Number(s.rows[0].expected);
  const variance = actual - expected;
  const { rows } = await pool.query(`INSERT INTO daily_closings(business_date,expected_cash,actual_cash,variance,note) VALUES((NOW() AT TIME ZONE 'Asia/Manila')::date,$1,$2,$3,$4) ON CONFLICT(business_date) DO UPDATE SET expected_cash=EXCLUDED.expected_cash,actual_cash=EXCLUDED.actual_cash,variance=EXCLUDED.variance,note=EXCLUDED.note RETURNING *`, [expected, actual, variance, String(req.body?.note || '')]);
  res.json(rows[0]);
});

app.get('/api/export.csv', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT id,type,category,amount,payment_method,note,occurred_at FROM transactions ORDER BY occurred_at ASC`);
  const esc = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const csv = ['id,type,category,amount,payment_method,note,occurred_at', ...rows.map(r => [r.id,r.type,r.category,r.amount,r.payment_method,r.note,r.occurred_at.toISOString()].map(esc).join(','))].join('\n');
  res.type('text/csv').set('Content-Disposition','attachment; filename="transactions.csv"').send(csv);
});

initDb().then(() => app.listen(port, () => console.log(`Accounting app listening on ${port}`))).catch(err => { console.error(err); process.exit(1); });
