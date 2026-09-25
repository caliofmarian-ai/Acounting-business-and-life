import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { ensureLegacyAccountingBaseSchema } from './accounting-base-schema.js';

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

app.use(express.json({ limit: '150kb' }));
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
function positiveNumber(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

async function initDb() {
  await ensureLegacyAccountingBaseSchema(pool);
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

async function productsWithRecipes() {
  const products = await pool.query(`SELECT * FROM products ORDER BY active DESC,name ASC`);
  const recipe = await pool.query(`
    SELECT r.product_id,r.inventory_id,r.quantity,i.item,i.unit,i.quantity stock_quantity,i.unit_cost,
           (r.quantity * i.unit_cost) component_cost
    FROM recipes r JOIN inventory i ON i.id=r.inventory_id
    ORDER BY r.product_id,i.item
  `);
  const byProduct = new Map();
  for (const row of recipe.rows) {
    if (!byProduct.has(String(row.product_id))) byProduct.set(String(row.product_id), []);
    byProduct.get(String(row.product_id)).push({
      inventory_id: Number(row.inventory_id), item: row.item, unit: row.unit,
      quantity: Number(row.quantity), stock_quantity: Number(row.stock_quantity),
      unit_cost: Number(row.unit_cost), component_cost: Number(row.component_cost)
    });
  }
  return products.rows.map(p => {
    const components = byProduct.get(String(p.id)) || [];
    const unitCost = components.reduce((sum,x)=>sum + x.quantity*x.unit_cost,0);
    const price = Number(p.selling_price);
    const gp = price - unitCost;
    return {
      ...p,
      id: Number(p.id), selling_price: price,
      recipe: components,
      estimated_unit_cost: roundMoney(unitCost),
      estimated_gross_profit: roundMoney(gp),
      estimated_margin_pct: price > 0 ? Math.round((gp/price)*1000)/10 : 0
    };
  });
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true, version: '0.3.0' }); }
  catch { res.status(503).json({ ok: false, db: false, version: '0.3.0' }); }
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
  const productToday = await pool.query(`
    SELECT COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit,
           COALESCE(SUM(quantity),0) portions
    FROM product_sales WHERE (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date
  `);
  const accounts = await pool.query(`
    SELECT account, COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) balance
    FROM transactions GROUP BY account
  `);
  const low = await pool.query(`SELECT COUNT(*)::int count FROM inventory WHERE quantity <= reorder_level`);
  const budget = await pool.query(`SELECT * FROM budgets WHERE id=1`);
  const t = totals.rows[0];
  const p = productToday.rows[0];
  const available = Number(t.sales)+Number(t.money_received)+Number(t.adjustments)-Number(t.business_expenses)-Number(t.personal_withdrawals);
  const personal7 = await pool.query(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE type='personal_withdrawal' AND occurred_at >= NOW() - INTERVAL '7 days'`);
  const b = budget.rows[0];
  const warnings = [];
  if (Number(b.personal_daily_limit)>0 && Number(t.today_personal)>Number(b.personal_daily_limit)) warnings.push('Personal spending is over today’s limit.');
  if (Number(b.personal_weekly_limit)>0 && Number(personal7.rows[0].v)>Number(b.personal_weekly_limit)) warnings.push('Personal spending is over the 7-day limit.');
  if (Number(b.business_daily_limit)>0 && Number(t.today_business_expenses)>Number(b.business_daily_limit)) warnings.push('Business spending is over today’s limit.');
  if (Number(b.min_available_warning)>0 && available<Number(b.min_available_warning)) warnings.push('Available money is below the safety level.');
  const byAccount = { cash:0,gcash:0,bank:0,other:0 };
  for (const row of accounts.rows) byAccount[row.account]=Number(row.balance);
  const productRevenue=Number(p.revenue), productGross=Number(p.gross_profit);
  res.json({
    ...t,
    profit: Number(t.sales)-Number(t.business_expenses),
    available_total: available,
    today_profit: Number(t.today_sales)-Number(t.today_business_expenses),
    accounts: byAccount, low_stock: low.rows[0].count, budget:b, warnings,
    product_today_revenue: productRevenue,
    product_today_cogs: Number(p.cogs),
    product_today_gross_profit: productGross,
    product_today_margin_pct: productRevenue>0 ? Math.round((productGross/productRevenue)*1000)/10 : 0,
    product_today_portions: Number(p.portions)
  });
});

app.get('/api/transactions', auth, async (_req,res)=>{
  const {rows}=await pool.query(`SELECT * FROM transactions ORDER BY occurred_at DESC,id DESC LIMIT 500`); res.json(rows);
});
app.post('/api/transactions', auth, async (req,res)=>{
  const {type,category='Other',amount,account='cash',note='',occurred_at}=req.body||{};
  if(!TYPES.has(type)||!validMoney(amount)||!ACCOUNTS.has(account)) return res.status(400).json({error:'Invalid transaction'});
  const {rows}=await pool.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,occurred_at) VALUES($1,$2,$3,$4,$4,$5,COALESCE($6::timestamptz,NOW())) RETURNING *`,[type,cleanText(category,80)||'Other',Number(amount),account,cleanText(note),occurred_at||null]);
  res.status(201).json(rows[0]);
});
app.patch('/api/transactions/:id', auth, async (req,res)=>{
  const id=Number(req.params.id); const old=await pool.query(`SELECT * FROM transactions WHERE id=$1`,[id]);
  if(!old.rowCount) return res.status(404).json({error:'Transaction not found'});
  const prev=old.rows[0];
  if(['remittance','product_sale'].includes(prev.source)) return res.status(409).json({error:'This entry is linked to another record and cannot be corrected separately.'});
  const type=req.body.type??prev.type, amount=req.body.amount??prev.amount, account=req.body.account??prev.account;
  if(!TYPES.has(type)||!validMoney(amount)||!ACCOUNTS.has(account)) return res.status(400).json({error:'Invalid correction'});
  const next=await pool.query(`UPDATE transactions SET type=$1,category=$2,amount=$3,payment_method=$4,account=$4,note=$5,occurred_at=COALESCE($6::timestamptz,occurred_at) WHERE id=$7 RETURNING *`,[type,cleanText(req.body.category??prev.category,80)||'Other',Number(amount),account,cleanText(req.body.note??prev.note),req.body.occurred_at||null,id]);
  await pool.query(`INSERT INTO audit_events(entity_type,entity_id,action,before_data,after_data,reason) VALUES('transaction',$1,'correction',$2::jsonb,$3::jsonb,$4)`,[id,JSON.stringify(prev),JSON.stringify(next.rows[0]),cleanText(req.body.reason||'Manual correction')]);
  res.json(next.rows[0]);
});
app.get('/api/transactions/:id/audit',auth,async(req,res)=>{const{rows}=await pool.query(`SELECT * FROM audit_events WHERE entity_type='transaction' AND entity_id=$1 ORDER BY created_at DESC`,[Number(req.params.id)]);res.json(rows)});

app.get('/api/inventory',auth,async(_req,res)=>{const{rows}=await pool.query(`SELECT * FROM inventory ORDER BY (quantity<=reorder_level) DESC,item ASC`);res.json(rows)});
app.post('/api/inventory',auth,async(req,res)=>{
  const{item,unit='pcs',quantity=0,reorder_level=0,unit_cost=0}=req.body||{};
  if(!cleanText(item,100)) return res.status(400).json({error:'Item is required'});
  const{rows}=await pool.query(`INSERT INTO inventory(item,unit,quantity,reorder_level,unit_cost) VALUES($1,$2,$3,$4,$5) ON CONFLICT(item) DO UPDATE SET unit=EXCLUDED.unit,quantity=EXCLUDED.quantity,reorder_level=EXCLUDED.reorder_level,unit_cost=EXCLUDED.unit_cost,updated_at=NOW() RETURNING *`,[cleanText(item,100),cleanText(unit,20)||'pcs',Number(quantity)||0,Number(reorder_level)||0,Number(unit_cost)||0]);
  res.status(201).json(rows[0]);
});

app.get('/api/remittances',auth,async(_req,res)=>{const{rows}=await pool.query(`SELECT *,(received_php-COALESCE(expected_php,received_php)) difference_php FROM remittances ORDER BY sent_at DESC,id DESC LIMIT 100`);res.json(rows)});
app.post('/api/remittances',auth,async(req,res)=>{
  const{sent_amount,sent_currency='EUR',fee_amount=0,exchange_rate=null,expected_php=null,received_php,account='gcash',provider='',reference='',note='',sent_at,received_at}=req.body||{};
  if(!validMoney(sent_amount)||!validMoney(fee_amount)||!validMoney(received_php)||!ACCOUNTS.has(account)) return res.status(400).json({error:'Invalid remittance'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(`INSERT INTO remittances(sent_amount,sent_currency,fee_amount,exchange_rate,expected_php,received_php,account,provider,reference,note,sent_at,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,NOW()),COALESCE($12::timestamptz,NOW())) RETURNING *`,[Number(sent_amount),cleanText(sent_currency,8).toUpperCase()||'EUR',Number(fee_amount),exchange_rate?Number(exchange_rate):null,expected_php===''||expected_php==null?null:Number(expected_php),Number(received_php),account,cleanText(provider,80),cleanText(reference,120),cleanText(note),sent_at||null,received_at||null]);
    const rem=r.rows[0];
    if(Number(received_php)>0) await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES('money_received','Remittance',$1,$2,$2,$3,'remittance',$4,COALESCE($5::timestamptz,NOW()))`,[Number(received_php),account,cleanText(`${provider}${reference?` • ${reference}`:''}`),rem.id,received_at||null]);
    await client.query('COMMIT'); res.status(201).json(rem);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/day-status',auth,async(_req,res)=>res.json(await dayStatus()));
app.post('/api/open-day',auth,async(req,res)=>{
  if(!validMoney(req.body?.opening_cash)) return res.status(400).json({error:'Opening cash is required'});
  const{rows}=await pool.query(`INSERT INTO daily_openings(business_date,opening_cash,note) VALUES((NOW() AT TIME ZONE 'Asia/Manila')::date,$1,$2) ON CONFLICT(business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,note=EXCLUDED.note,updated_at=NOW() RETURNING *`,[Number(req.body.opening_cash),cleanText(req.body.note)]);
  res.json({opening:rows[0],status:await dayStatus()});
});
app.post('/api/close-day',auth,async(req,res)=>{
  const actual=Number(req.body?.actual_cash); if(!Number.isFinite(actual)||actual<0) return res.status(400).json({error:'Actual cash is required'});
  const status=await dayStatus(); if(!status.has_opening) return res.status(400).json({error:'Record opening cash first.'});
  const variance=actual-status.expected_cash;
  const{rows}=await pool.query(`INSERT INTO daily_closings(business_date,opening_cash,expected_cash,actual_cash,variance,note) VALUES((NOW() AT TIME ZONE 'Asia/Manila')::date,$1,$2,$3,$4,$5) ON CONFLICT(business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,expected_cash=EXCLUDED.expected_cash,actual_cash=EXCLUDED.actual_cash,variance=EXCLUDED.variance,note=EXCLUDED.note RETURNING *`,[status.opening_cash,status.expected_cash,actual,variance,cleanText(req.body?.note)]);
  res.json(rows[0]);
});

app.get('/api/budget',auth,async(_req,res)=>{const{rows}=await pool.query(`SELECT * FROM budgets WHERE id=1`);res.json(rows[0])});
app.post('/api/budget',auth,async(req,res)=>{
  const keys=['personal_daily_limit','personal_weekly_limit','business_daily_limit','min_available_warning'];
  if(keys.some(k=>!validMoney(req.body?.[k]??0))) return res.status(400).json({error:'Budget values must be zero or greater'});
  const{rows}=await pool.query(`UPDATE budgets SET personal_daily_limit=$1,personal_weekly_limit=$2,business_daily_limit=$3,min_available_warning=$4,updated_at=NOW() WHERE id=1 RETURNING *`,keys.map(k=>Number(req.body?.[k]||0))); res.json(rows[0]);
});

app.get('/api/analysis',auth,async(req,res)=>{
  const days=Number(req.query.days)===30?30:7;
  const categories=await pool.query(`SELECT CASE WHEN type='business_expense' THEN 'business' ELSE 'personal' END kind,category,COALESCE(SUM(amount),0) total FROM transactions WHERE type IN ('business_expense','personal_withdrawal') AND occurred_at>=NOW()-($1::int*INTERVAL '1 day') GROUP BY kind,category ORDER BY total DESC`,[days]);
  const totals=await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal,COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) received FROM transactions WHERE occurred_at>=NOW()-($1::int*INTERVAL '1 day')`,[days]);
  res.json({days,totals:totals.rows[0],categories:categories.rows});
});

// V0.3 menu and product profitability
app.get('/api/products',auth,async(_req,res)=>res.json(await productsWithRecipes()));
app.post('/api/products',auth,async(req,res)=>{
  const name=cleanText(req.body?.name,120), category=cleanText(req.body?.category||'Food',80)||'Food', price=Number(req.body?.selling_price);
  if(!name||!Number.isFinite(price)||price<0) return res.status(400).json({error:'Product name and valid selling price are required.'});
  try{
    const{rows}=await pool.query(`INSERT INTO products(name,category,selling_price,active) VALUES($1,$2,$3,$4) RETURNING *`,[name,category,price,req.body?.active!==false]);
    res.status(201).json(rows[0]);
  }catch(e){if(e.code==='23505') return res.status(409).json({error:'A product with this name already exists.'});throw e}
});
app.patch('/api/products/:id',auth,async(req,res)=>{
  const id=Number(req.params.id); const old=await pool.query(`SELECT * FROM products WHERE id=$1`,[id]); if(!old.rowCount) return res.status(404).json({error:'Product not found'});
  const prev=old.rows[0], name=cleanText(req.body?.name??prev.name,120), category=cleanText(req.body?.category??prev.category,80)||'Food', price=Number(req.body?.selling_price??prev.selling_price), active=req.body?.active??prev.active;
  if(!name||!Number.isFinite(price)||price<0) return res.status(400).json({error:'Invalid product'});
  try{const{rows}=await pool.query(`UPDATE products SET name=$1,category=$2,selling_price=$3,active=$4,updated_at=NOW() WHERE id=$5 RETURNING *`,[name,category,price,Boolean(active),id]);res.json(rows[0])}
  catch(e){if(e.code==='23505') return res.status(409).json({error:'A product with this name already exists.'});throw e}
});
app.put('/api/products/:id/recipe',auth,async(req,res)=>{
  const productId=Number(req.params.id), components=Array.isArray(req.body?.components)?req.body.components:[];
  const exists=await pool.query(`SELECT id FROM products WHERE id=$1`,[productId]); if(!exists.rowCount) return res.status(404).json({error:'Product not found'});
  const normalized=[]; const seen=new Set();
  for(const c of components){const inventoryId=Number(c.inventory_id), quantity=Number(c.quantity);if(!Number.isInteger(inventoryId)||!positiveNumber(quantity)) return res.status(400).json({error:'Every recipe component needs an inventory item and quantity greater than zero.'});if(seen.has(inventoryId)) return res.status(400).json({error:'The same ingredient cannot appear twice in one recipe.'});seen.add(inventoryId);normalized.push({inventoryId,quantity})}
  if(normalized.length){const check=await pool.query(`SELECT id FROM inventory WHERE id=ANY($1::bigint[])`,[normalized.map(x=>x.inventoryId)]);if(check.rowCount!==normalized.length) return res.status(400).json({error:'One or more inventory ingredients no longer exist.'})}
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query(`DELETE FROM recipes WHERE product_id=$1`,[productId]);for(const c of normalized) await client.query(`INSERT INTO recipes(product_id,inventory_id,quantity) VALUES($1,$2,$3)`,[productId,c.inventoryId,c.quantity]);await client.query('COMMIT');res.json((await productsWithRecipes()).find(p=>p.id===productId))}
  catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.post('/api/product-sales',auth,async(req,res)=>{
  const productId=Number(req.body?.product_id), quantity=Number(req.body?.quantity), account=req.body?.account||'cash', note=cleanText(req.body?.note||'',250), occurredAt=req.body?.occurred_at||null;
  if(!Number.isInteger(productId)||!positiveNumber(quantity)||!ACCOUNTS.has(account)) return res.status(400).json({error:'Product, quantity and valid account are required.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const pr=await client.query(`SELECT * FROM products WHERE id=$1 FOR SHARE`,[productId]);
    if(!pr.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Product not found.'})}
    const product=pr.rows[0]; if(!product.active){await client.query('ROLLBACK');return res.status(409).json({error:'This product is inactive.'})}
    const recipe=await client.query(`SELECT r.inventory_id,r.quantity recipe_quantity,i.item,i.unit,i.quantity stock_quantity,i.unit_cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 ORDER BY i.id FOR UPDATE OF i`,[productId]);
    const shortages=[]; let unitCost=0;
    for(const row of recipe.rows){const needed=Number(row.recipe_quantity)*quantity, stock=Number(row.stock_quantity);unitCost+=Number(row.recipe_quantity)*Number(row.unit_cost);if(stock+1e-9<needed) shortages.push({item:row.item,unit:row.unit,required:needed,available:stock,short:needed-stock})}
    if(shortages.length){await client.query('ROLLBACK');return res.status(409).json({error:'Not enough stock for this sale.',shortages})}
    const unitPrice=Number(product.selling_price), revenue=roundMoney(unitPrice*quantity), cogs=roundMoney(unitCost*quantity), gross=roundMoney(revenue-cogs);
    const tx=await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,occurred_at) VALUES('sale',$1,$2,$3,$3,$4,'product_sale',COALESCE($5::timestamptz,NOW())) RETURNING *`,[product.name,revenue,account,cleanText(`${quantity} × ${product.name}${note?` • ${note}`:''}`,250),occurredAt]);
    const sale=await client.query(`INSERT INTO product_sales(product_id,product_name_snapshot,quantity,unit_price_snapshot,unit_cost_snapshot,revenue,estimated_cogs,gross_profit,account,transaction_id,note,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW())) RETURNING *`,[productId,product.name,quantity,unitPrice,unitCost,revenue,cogs,gross,account,tx.rows[0].id,note,occurredAt]);
    const saleId=sale.rows[0].id; await client.query(`UPDATE transactions SET source_id=$1 WHERE id=$2`,[saleId,tx.rows[0].id]);
    for(const row of recipe.rows){const used=Number(row.recipe_quantity)*quantity, componentCost=used*Number(row.unit_cost);await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2`,[used,row.inventory_id]);await client.query(`INSERT INTO product_sale_ingredients(sale_id,inventory_id,item_name_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot) VALUES($1,$2,$3,$4,$5,$6)`,[saleId,row.inventory_id,row.item,used,Number(row.unit_cost),componentCost])}
    await client.query('COMMIT');
    res.status(201).json({...sale.rows[0],margin_pct:revenue>0?Math.round((gross/revenue)*1000)/10:0});
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e}finally{client.release()}
});

app.get('/api/product-sales',auth,async(_req,res)=>{
  const{rows}=await pool.query(`SELECT ps.*,t.created_at transaction_created_at FROM product_sales ps JOIN transactions t ON t.id=ps.transaction_id ORDER BY ps.occurred_at DESC,ps.id DESC LIMIT 250`);res.json(rows);
});
app.get('/api/product-profitability',auth,async(req,res)=>{
  const days=Number(req.query.days)===30?30:7;
  const totals=await pool.query(`SELECT COALESCE(SUM(quantity),0) portions,COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit FROM product_sales WHERE occurred_at>=NOW()-($1::int*INTERVAL '1 day')`,[days]);
  const products=await pool.query(`SELECT product_id,product_name_snapshot name,COALESCE(SUM(quantity),0) quantity,COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit FROM product_sales WHERE occurred_at>=NOW()-($1::int*INTERVAL '1 day') GROUP BY product_id,product_name_snapshot ORDER BY gross_profit DESC,revenue DESC`,[days]);
  const t=totals.rows[0], revenue=Number(t.revenue), gross=Number(t.gross_profit);
  res.json({days,totals:{portions:Number(t.portions),revenue,cogs:Number(t.cogs),gross_profit:gross,margin_pct:revenue>0?Math.round((gross/revenue)*1000)/10:0},products:products.rows.map(r=>{const rev=Number(r.revenue),gp=Number(r.gross_profit);return{...r,product_id:Number(r.product_id),quantity:Number(r.quantity),revenue:rev,cogs:Number(r.cogs),gross_profit:gp,margin_pct:rev>0?Math.round((gp/rev)*1000)/10:0}})});
});

app.get('/api/export.csv',auth,async(_req,res)=>{
  const{rows}=await pool.query(`SELECT id,type,category,amount,account,source,note,occurred_at FROM transactions ORDER BY occurred_at ASC`);
  const escCsv=v=>`"${String(v??'').replaceAll('"','""')}"`; const csv=['id,type,category,amount,account,source,note,occurred_at',...rows.map(r=>[r.id,r.type,r.category,r.amount,r.account,r.source,r.note,r.occurred_at.toISOString()].map(escCsv).join(','))].join('\n');
  res.type('text/csv').set('Content-Disposition','attachment; filename="transactions.csv"').send(csv);
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Unexpected server error'})});

initDb().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Accounting app v0.3 listening on ${port}`))).catch(err=>{console.error(err);process.exit(1)});
