import express from 'express';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.INTERNAL_PROFILE_GOVERNANCE_PORT || 4107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '14mb' });
const ACCOUNTS = new Set(['cash','gcash','bank','other']);
const TYPES = new Set(['sale','business_expense','money_received','personal_withdrawal','adjustment']);
let child;
let shuttingDown = false;

const clean = (value,max=500) => String(value ?? '').trim().slice(0,max);
const money = value => Math.round((Number(value)+Number.EPSILON)*100)/100;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const authHeader = req => req.headers.authorization || '';
const roleEnabled = (me,role) => Boolean(me?.profiles?.some(p=>p.role===role && p.enabled));

async function upstream(path,options={}) { return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options); }
async function identity(req) {
  const r = await upstream('/api/me',{headers:{Authorization:authHeader(req)}});
  const b = await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});
  return b;
}
async function requireAdmin(req) {
  const me = await identity(req);
  if(Number(me.account.id)!==1) throw Object.assign(new Error('Bootstrap Super Admin access required'),{status:403});
  return me;
}

async function initAccountingTenancyDb() {
  await pool.query(`
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE transactions SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE transactions ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE transactions ALTER COLUMN business_id SET NOT NULL;

    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE inventory SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE inventory ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE inventory ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_item_key;
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_business_item_unique ON inventory(business_id,item);

    ALTER TABLE daily_openings ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE daily_openings SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE daily_openings ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE daily_openings ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE daily_openings DROP CONSTRAINT IF EXISTS daily_openings_pkey;
    CREATE UNIQUE INDEX IF NOT EXISTS daily_openings_business_date_unique ON daily_openings(business_id,business_date);

    ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE daily_closings SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE daily_closings ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE daily_closings ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE daily_closings DROP CONSTRAINT IF EXISTS daily_closings_pkey;
    CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_business_date_unique ON daily_closings(business_id,business_date);

    ALTER TABLE remittances ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE remittances SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE remittances ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE remittances ALTER COLUMN business_id SET NOT NULL;

    ALTER TABLE budgets ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE budgets SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE budgets ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE budgets ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_pkey;
    CREATE UNIQUE INDEX IF NOT EXISTS budgets_business_id_unique ON budgets(business_id,id);

    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE audit_events SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE audit_events ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE audit_events ALTER COLUMN business_id SET NOT NULL;

    ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE products SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE products ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE products ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_name_key;
    CREATE UNIQUE INDEX IF NOT EXISTS products_business_name_unique ON products(business_id,name);

    ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS business_id BIGINT;
    UPDATE product_sales SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE product_sales ALTER COLUMN business_id SET DEFAULT 1;
    ALTER TABLE product_sales ALTER COLUMN business_id SET NOT NULL;

    CREATE INDEX IF NOT EXISTS transactions_business_occurred_idx ON transactions(business_id,occurred_at DESC);
    CREATE INDEX IF NOT EXISTS inventory_business_idx ON inventory(business_id,item);
    CREATE INDEX IF NOT EXISTS products_business_idx ON products(business_id,active,name);
    CREATE INDEX IF NOT EXISTS product_sales_business_idx ON product_sales(business_id,occurred_at DESC);
    CREATE INDEX IF NOT EXISTS remittances_business_idx ON remittances(business_id,sent_at DESC);
    CREATE INDEX IF NOT EXISTS audit_business_entity_idx ON audit_events(business_id,entity_type,entity_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS profile_business_bindings (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id,role,business_id),
      CHECK(role IN ('merchant','supplier')),
      CHECK(status IN ('active','suspended','revoked'))
    );
    CREATE INDEX IF NOT EXISTS profile_business_bindings_lookup_idx ON profile_business_bindings(account_id,role,status,is_primary DESC,business_id);

    CREATE TABLE IF NOT EXISTS account_business_preferences (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id,role),
      CHECK(role IN ('merchant','supplier'))
    );

    CREATE TABLE IF NOT EXISTS accounting_tenancy_events (
      id BIGSERIAL PRIMARY KEY,
      actor_account_id BIGINT REFERENCES accounts(id),
      target_account_id BIGINT REFERENCES accounts(id),
      role TEXT NOT NULL DEFAULT '',
      business_id BIGINT REFERENCES businesses(id),
      event_code TEXT NOT NULL,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await addBusinessForeignKeys();
  await provisionExistingBindings();
  await ensureBudgetRows();
}

async function addBusinessForeignKeys() {
  const tables=['transactions','inventory','daily_openings','daily_closings','remittances','budgets','audit_events','products','product_sales'];
  for(const table of tables){
    const name=`${table}_business_id_fkey`;
    const exists=await pool.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`,[name]);
    if(!exists.rowCount) await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT`);
  }
}

async function tenancyAudit(actorId,targetId,role,businessId,eventCode,detail={}) {
  await pool.query(`INSERT INTO accounting_tenancy_events(actor_account_id,target_account_id,role,business_id,event_code,detail_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[
    actorId||null,targetId||null,clean(role,40),businessId||null,clean(eventCode,100),JSON.stringify(detail)
  ]).catch(()=>{});
}

async function activeMemberships(accountId){
  const {rows}=await pool.query(`SELECT b.*,bm.membership_role FROM business_memberships bm JOIN businesses b ON b.id=bm.business_id WHERE bm.account_id=$1 AND bm.active=TRUE ORDER BY b.id`,[accountId]);
  return rows;
}
async function profileBindings(accountId,role){
  const {rows}=await pool.query(`SELECT b.*,pb.is_primary,pb.status binding_status,bm.membership_role FROM profile_business_bindings pb JOIN businesses b ON b.id=pb.business_id JOIN business_memberships bm ON bm.business_id=pb.business_id AND bm.account_id=pb.account_id AND bm.active=TRUE WHERE pb.account_id=$1 AND pb.role=$2 AND pb.status='active' ORDER BY pb.is_primary DESC,b.id`,[accountId,role]);
  return rows;
}
async function createBusinessForProfile(accountId,role,territoryId=null,proposedName=''){
  const a=await pool.query(`SELECT display_name FROM accounts WHERE id=$1`,[accountId]);
  const supplier=role==='supplier'?await pool.query(`SELECT supplier_name FROM supplier_profiles WHERE account_id=$1`,[accountId]):{rows:[]};
  const name=clean(proposedName,180)||clean(supplier.rows[0]?.supplier_name,180)||`${clean(a.rows[0]?.display_name,150)||'My'} ${role==='supplier'?'Supply':'Business'}`;
  const b=await pool.query(`INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',$2) RETURNING *`,[name,territoryId||null]);
  await pool.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE) ON CONFLICT(business_id,account_id) DO UPDATE SET active=TRUE`,[b.rows[0].id,accountId]);
  return b.rows[0];
}
async function ensureProfileBusinessBinding(accountId,role,territoryId=null,proposedName='',actorId=null){
  if(!['merchant','supplier'].includes(role)) return null;
  const existing=await profileBindings(accountId,role);
  if(existing.length) return existing[0];
  const memberships=await activeMemberships(accountId);
  let candidates=memberships;
  if(role==='supplier'&&memberships.length>1){
    const normalized=clean(proposedName,180).toLowerCase();
    const matched=normalized?memberships.filter(b=>String(b.name||'').trim().toLowerCase()===normalized):[];
    candidates=matched.length===1?matched:[];
  }
  let chosen;
  if(role==='merchant'&&memberships.length){
    chosen=memberships[0];
    for(const [idx,b] of memberships.entries()) await pool.query(`INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',$3) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active'`,[accountId,b.id,idx===0]);
  }else if(candidates.length===1){
    chosen=candidates[0];
    await pool.query(`INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,$2,$3,'active',TRUE) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=TRUE`,[accountId,role,chosen.id]);
  }else{
    chosen=await createBusinessForProfile(accountId,role,territoryId,proposedName);
    await pool.query(`INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,$2,$3,'active',TRUE) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=TRUE`,[accountId,role,chosen.id]);
  }
  await pool.query(`INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,$2,$3) ON CONFLICT(account_id,role) DO NOTHING`,[accountId,role,chosen.id]);
  await tenancyAudit(actorId||accountId,accountId,role,chosen.id,'profile_business_bound',{proposed_name:proposedName||''});
  await ensureBudgetRow(chosen.id);
  return chosen;
}
async function provisionExistingBindings(){
  const {rows}=await pool.query(`SELECT p.account_id,p.role,COALESCE(pa.territory_id,0) territory_id,COALESCE(pa.proposed_business_name,'') proposed_business_name FROM profiles p LEFT JOIN LATERAL (SELECT x.territory_id,x.proposed_business_name FROM profile_applications x WHERE x.account_id=p.account_id AND x.role=p.role AND x.status='approved' ORDER BY x.reviewed_at DESC NULLS LAST,x.id DESC LIMIT 1) pa ON TRUE WHERE p.enabled=TRUE AND p.role IN ('merchant','supplier') ORDER BY p.account_id,p.role`);
  for(const row of rows) await ensureProfileBusinessBinding(Number(row.account_id),row.role,Number(row.territory_id)||null,row.proposed_business_name||'').catch(err=>console.error('Business binding migration:',err.message));
}
async function ensureBudgetRow(businessId){
  await pool.query(`INSERT INTO budgets(id,business_id) VALUES(1,$1) ON CONFLICT(business_id,id) DO NOTHING`,[businessId]);
}
async function ensureBudgetRows(){
  const {rows}=await pool.query(`SELECT id FROM businesses`);
  for(const b of rows) await ensureBudgetRow(Number(b.id));
}

async function accountingContext(req){
  const me=await identity(req);
  const role=clean(me.account?.active_role,40);
  if(!['merchant','supplier'].includes(role)) throw Object.assign(new Error('Switch to Merchant or Supplier to use Accounting'),{status:403});
  if(!roleEnabled(me,role)) throw Object.assign(new Error(`${role} profile is not active`),{status:403});
  let bindings=await profileBindings(Number(me.account.id),role);
  if(!bindings.length){
    await ensureProfileBusinessBinding(Number(me.account.id),role,null,'');
    bindings=await profileBindings(Number(me.account.id),role);
  }
  if(!bindings.length) throw Object.assign(new Error('No accounting workspace is bound to this profile'),{status:409});
  const pref=await pool.query(`SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role=$2`,[me.account.id,role]);
  let selected=bindings.find(b=>Number(b.id)===Number(pref.rows[0]?.business_id))||bindings[0];
  await pool.query(`INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,$2,$3) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()`,[me.account.id,role,selected.id]);
  await ensureBudgetRow(Number(selected.id));
  return {me,role,business:selected,businesses:bindings};
}
async function specificBusiness(req,businessId){
  const ctx=await accountingContext(req);
  const b=ctx.businesses.find(x=>Number(x.id)===Number(businessId));
  if(!b) throw Object.assign(new Error('Business workspace unavailable'),{status:403});
  return {...ctx,business:b};
}

async function dayStatus(businessId){
  const opening=await pool.query(`SELECT opening_cash,note FROM daily_openings WHERE business_id=$1 AND business_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`,[businessId]);
  const movement=await pool.query(`SELECT COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) movement FROM transactions WHERE business_id=$1 AND account='cash' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date`,[businessId]);
  const closing=await pool.query(`SELECT expected_cash,actual_cash,variance,note,created_at FROM daily_closings WHERE business_id=$1 AND business_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`,[businessId]);
  const openingCash=Number(opening.rows[0]?.opening_cash||0),cashMovement=Number(movement.rows[0]?.movement||0);
  return{business_date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}),has_opening:opening.rowCount>0,opening_cash:openingCash,cash_movement:cashMovement,expected_cash:openingCash+cashMovement,closing:closing.rows[0]||null};
}
async function productsWithRecipes(businessId){
  const products=await pool.query(`SELECT * FROM products WHERE business_id=$1 ORDER BY active DESC,name`,[businessId]);
  const recipe=await pool.query(`SELECT r.product_id,r.inventory_id,r.quantity,i.item,i.unit,i.quantity stock_quantity,i.unit_cost,(r.quantity*i.unit_cost) component_cost FROM recipes r JOIN products p ON p.id=r.product_id JOIN inventory i ON i.id=r.inventory_id WHERE p.business_id=$1 AND i.business_id=$1 ORDER BY r.product_id,i.item`,[businessId]);
  const map=new Map();for(const row of recipe.rows){if(!map.has(String(row.product_id)))map.set(String(row.product_id),[]);map.get(String(row.product_id)).push({inventory_id:Number(row.inventory_id),item:row.item,unit:row.unit,quantity:Number(row.quantity),stock_quantity:Number(row.stock_quantity),unit_cost:Number(row.unit_cost),component_cost:Number(row.component_cost)})}
  return products.rows.map(p=>{const components=map.get(String(p.id))||[],unitCost=components.reduce((s,x)=>s+x.quantity*x.unit_cost,0),price=Number(p.selling_price),gp=price-unitCost;return{...p,id:Number(p.id),selling_price:price,recipe:components,estimated_unit_cost:money(unitCost),estimated_gross_profit:money(gp),estimated_margin_pct:price>0?Math.round((gp/price)*1000)/10:0}});
}
async function commercialMetrics(ctx){
  const businessId=Number(ctx.business.id);
  const merchant=await pool.query(`SELECT COALESCE(SUM(CASE WHEN order_status<>'cancelled' THEN outstanding_amount ELSE 0 END),0) receivables FROM orders WHERE business_id=$1`,[businessId]).catch(()=>({rows:[{receivables:0}]}));
  const procurement=await pool.query(`SELECT COALESCE(SUM(GREATEST(COALESCE(actual_received_total,0)-paid_amount,0)),0) payables,COALESCE(SUM(CASE WHEN status NOT IN ('received','cancelled','rejected') THEN expected_total ELSE 0 END),0) commitments FROM purchase_orders WHERE business_id=$1`,[businessId]).catch(()=>({rows:[{payables:0,commitments:0}]}));
  let supplierRevenue=0,supplierReceivables=0;
  if(ctx.role==='supplier'){
    const s=await pool.query(`SELECT COALESCE(SUM(actual_received_total),0) revenue,COALESCE(SUM(GREATEST(actual_received_total-paid_amount,0)),0) receivables FROM purchase_orders WHERE supplier_account_id=$1 AND status NOT IN ('cancelled','rejected')`,[ctx.me.account.id]);
    supplierRevenue=Number(s.rows[0].revenue);supplierReceivables=Number(s.rows[0].receivables);
  }
  return{customer_receivables:Number(merchant.rows[0].receivables),supplier_payables:Number(procurement.rows[0].payables),procurement_commitments:Number(procurement.rows[0].commitments),supplier_fulfilled_revenue:supplierRevenue,supplier_receivables:supplierReceivables};
}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const r=await upstream('/health');res.status(r.ok?200:503).json({ok:r.ok,db:true,profile_governance:r.ok,accounting_tenancy:true,version:'0.9.0-multi-business-accounting'})}catch{res.status(503).json({ok:false,db:false,profile_governance:false,accounting_tenancy:false,version:'0.9.0-multi-business-accounting'})}});
app.get('/business-accounting.css',(_req,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','business-accounting.css'),'utf8')));
app.get('/business-accounting-ui.js',(_req,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','business-accounting-ui.js'),'utf8')));
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/business-accounting.css" />\n</head>').replace('</body>','  <script type="module" src="/business-accounting-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root);

app.get('/api/accounting/workspaces',async(req,res,next)=>{try{const ctx=await accountingContext(req);res.json({role:ctx.role,active_business_id:Number(ctx.business.id),businesses:ctx.businesses.map(b=>({id:Number(b.id),name:b.name,country_code:b.country_code,currency_code:b.currency_code,territory_id:b.territory_id,membership_role:b.membership_role,is_primary:Boolean(b.is_primary)}))})}catch(e){next(e)}});
app.patch('/api/accounting/active-workspace',jsonBody,async(req,res,next)=>{try{const ctx=await specificBusiness(req,Number(req.body?.business_id));await pool.query(`INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,$2,$3) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()`,[ctx.me.account.id,ctx.role,ctx.business.id]);await tenancyAudit(ctx.me.account.id,ctx.me.account.id,ctx.role,ctx.business.id,'active_business_changed');res.json({ok:true,business:{id:Number(ctx.business.id),name:ctx.business.name}})}catch(e){next(e)}});
app.post('/api/accounting/admin/workspaces',jsonBody,async(req,res,next)=>{try{const admin=await requireAdmin(req),target=Number(req.body?.target_account_id),role=clean(req.body?.role,40);if(!Number.isInteger(target)||!['merchant','supplier'].includes(role))return res.status(400).json({error:'Target account and Merchant/Supplier role are required'});const p=await pool.query(`SELECT enabled FROM profiles WHERE account_id=$1 AND role=$2`,[target,role]);if(!p.rowCount)return res.status(404).json({error:'Target profile not found'});const name=clean(req.body?.name,180);if(!name)return res.status(400).json({error:'Business name is required'});const b=await createBusinessForProfile(target,role,Number(req.body?.territory_id)||null,name);await pool.query(`INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,$2,$3,'active',$4)`,[target,role,b.id,Boolean(req.body?.is_primary)]);if(req.body?.is_primary)await pool.query(`UPDATE profile_business_bindings SET is_primary=(business_id=$3) WHERE account_id=$1 AND role=$2`,[target,role,b.id]);await ensureBudgetRow(b.id);await tenancyAudit(admin.account.id,target,role,b.id,'admin_business_workspace_created',{name});res.status(201).json(b)}catch(e){next(e)}});
app.post('/api/accounting/admin/bindings',jsonBody,async(req,res,next)=>{try{const admin=await requireAdmin(req),target=Number(req.body?.target_account_id),businessId=Number(req.body?.business_id),role=clean(req.body?.role,40);if(!Number.isInteger(target)||!Number.isInteger(businessId)||!['merchant','supplier'].includes(role))return res.status(400).json({error:'Target account, business and role are required'});const b=await pool.query(`SELECT * FROM businesses WHERE id=$1`,[businessId]);if(!b.rowCount)return res.status(404).json({error:'Business not found'});await pool.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE) ON CONFLICT(business_id,account_id) DO UPDATE SET active=TRUE`,[businessId,target]);await pool.query(`INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,$2,$3,'active',$4) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=EXCLUDED.is_primary,updated_at=NOW()`,[target,role,businessId,Boolean(req.body?.is_primary)]);if(req.body?.is_primary)await pool.query(`UPDATE profile_business_bindings SET is_primary=(business_id=$3) WHERE account_id=$1 AND role=$2`,[target,role,businessId]);await tenancyAudit(admin.account.id,target,role,businessId,'admin_profile_business_bound');res.json({ok:true})}catch(e){next(e)}});

app.get('/api/summary',async(req,res,next)=>{try{const ctx=await accountingContext(req),bid=Number(ctx.business.id);const totals=await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business_expenses,COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) money_received,COALESCE(SUM(CASE WHEN type='money_received' AND source='remittance' THEN amount ELSE 0 END),0) remittance_received,COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal_withdrawals,COALESCE(SUM(CASE WHEN type='adjustment' THEN amount ELSE 0 END),0) adjustments,COALESCE(SUM(CASE WHEN type='sale' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_sales,COALESCE(SUM(CASE WHEN type='business_expense' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_business_expenses,COALESCE(SUM(CASE WHEN type='personal_withdrawal' AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date THEN amount ELSE 0 END),0) today_personal FROM transactions WHERE business_id=$1`,[bid]);const productToday=await pool.query(`SELECT COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit,COALESCE(SUM(quantity),0) portions FROM product_sales WHERE business_id=$1 AND (occurred_at AT TIME ZONE 'Asia/Manila')::date=(NOW() AT TIME ZONE 'Asia/Manila')::date`,[bid]);const accounts=await pool.query(`SELECT account,COALESCE(SUM(CASE WHEN type IN ('sale','money_received','adjustment') THEN amount ELSE -amount END),0) balance FROM transactions WHERE business_id=$1 GROUP BY account`,[bid]);const low=await pool.query(`SELECT COUNT(*)::int count FROM inventory WHERE business_id=$1 AND quantity<=reorder_level`,[bid]);await ensureBudgetRow(bid);const budget=(await pool.query(`SELECT * FROM budgets WHERE business_id=$1 AND id=1`,[bid])).rows[0];const t=totals.rows[0],p=productToday.rows[0],available=Number(t.sales)+Number(t.money_received)+Number(t.adjustments)-Number(t.business_expenses)-Number(t.personal_withdrawals);const personal7=await pool.query(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE business_id=$1 AND type='personal_withdrawal' AND occurred_at>=NOW()-INTERVAL '7 days'`,[bid]);const warnings=[];if(Number(budget.personal_daily_limit)>0&&Number(t.today_personal)>Number(budget.personal_daily_limit))warnings.push('Personal spending is over today’s limit.');if(Number(budget.personal_weekly_limit)>0&&Number(personal7.rows[0].v)>Number(budget.personal_weekly_limit))warnings.push('Personal spending is over the 7-day limit.');if(Number(budget.business_daily_limit)>0&&Number(t.today_business_expenses)>Number(budget.business_daily_limit))warnings.push('Business spending is over today’s limit.');if(Number(budget.min_available_warning)>0&&available<Number(budget.min_available_warning))warnings.push('Available money is below the safety level.');const byAccount={cash:0,gcash:0,bank:0,other:0};for(const row of accounts.rows)byAccount[row.account]=Number(row.balance);const revenue=Number(p.revenue),gross=Number(p.gross_profit);res.json({...t,profit:Number(t.sales)-Number(t.business_expenses),available_total:available,today_profit:Number(t.today_sales)-Number(t.today_business_expenses),accounts:byAccount,low_stock:low.rows[0].count,budget,warnings,product_today_revenue:revenue,product_today_cogs:Number(p.cogs),product_today_gross_profit:gross,product_today_margin_pct:revenue>0?Math.round((gross/revenue)*1000)/10:0,product_today_portions:Number(p.portions),business:{id:bid,name:ctx.business.name,currency_code:ctx.business.currency_code},accounting_role:ctx.role,...await commercialMetrics(ctx)})}catch(e){next(e)}});

app.get('/api/transactions',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT * FROM transactions WHERE business_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 500`,[business.id]);res.json(rows)}catch(e){next(e)}});
app.post('/api/transactions',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),{type,category='Other',amount,account='cash',note='',occurred_at}=req.body||{};if(!TYPES.has(type)||!Number.isFinite(Number(amount))||Number(amount)<0||!ACCOUNTS.has(account))return res.status(400).json({error:'Invalid transaction'});const{rows}=await pool.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,occurred_at) VALUES($1,$2,$3,$4,$5,$5,$6,COALESCE($7::timestamptz,NOW())) RETURNING *`,[business.id,type,clean(category,80)||'Other',Number(amount),account,clean(note,250),occurred_at||null]);res.status(201).json(rows[0])}catch(e){next(e)}});
app.patch('/api/transactions/:id',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),id=Number(req.params.id),old=await pool.query(`SELECT * FROM transactions WHERE id=$1 AND business_id=$2`,[id,business.id]);if(!old.rowCount)return res.status(404).json({error:'Transaction not found'});const prev=old.rows[0];if(['remittance','product_sale','order_payment','supplier_payment','supplier_receipt'].includes(prev.source))return res.status(409).json({error:'This entry is linked to another record and cannot be corrected separately.'});const type=req.body?.type??prev.type,amount=req.body?.amount??prev.amount,account=req.body?.account??prev.account;if(!TYPES.has(type)||!Number.isFinite(Number(amount))||Number(amount)<0||!ACCOUNTS.has(account))return res.status(400).json({error:'Invalid correction'});const nextTx=await pool.query(`UPDATE transactions SET type=$1,category=$2,amount=$3,payment_method=$4,account=$4,note=$5,occurred_at=COALESCE($6::timestamptz,occurred_at) WHERE id=$7 AND business_id=$8 RETURNING *`,[type,clean(req.body?.category??prev.category,80)||'Other',Number(amount),account,clean(req.body?.note??prev.note,250),req.body?.occurred_at||null,id,business.id]);await pool.query(`INSERT INTO audit_events(business_id,entity_type,entity_id,action,before_data,after_data,reason) VALUES($1,'transaction',$2,'correction',$3::jsonb,$4::jsonb,$5)`,[business.id,id,JSON.stringify(prev),JSON.stringify(nextTx.rows[0]),clean(req.body?.reason||'Manual correction',500)]);res.json(nextTx.rows[0])}catch(e){next(e)}});
app.get('/api/transactions/:id/audit',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT * FROM audit_events WHERE business_id=$1 AND entity_type='transaction' AND entity_id=$2 ORDER BY created_at DESC`,[business.id,Number(req.params.id)]);res.json(rows)}catch(e){next(e)}});

app.get('/api/inventory',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT * FROM inventory WHERE business_id=$1 ORDER BY (quantity<=reorder_level) DESC,item`,[business.id]);res.json(rows)}catch(e){next(e)}});
app.post('/api/inventory',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),{item,unit='pcs',quantity=0,reorder_level=0,unit_cost=0}=req.body||{};if(!clean(item,100))return res.status(400).json({error:'Item is required'});const{rows}=await pool.query(`INSERT INTO inventory(business_id,item,unit,quantity,reorder_level,unit_cost) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id,item) DO UPDATE SET unit=EXCLUDED.unit,quantity=EXCLUDED.quantity,reorder_level=EXCLUDED.reorder_level,unit_cost=EXCLUDED.unit_cost,updated_at=NOW() RETURNING *`,[business.id,clean(item,100),clean(unit,20)||'pcs',Number(quantity)||0,Number(reorder_level)||0,Number(unit_cost)||0]);res.status(201).json(rows[0])}catch(e){next(e)}});

app.get('/api/remittances',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT *,(received_php-COALESCE(expected_php,received_php)) difference_php FROM remittances WHERE business_id=$1 ORDER BY sent_at DESC,id DESC LIMIT 100`,[business.id]);res.json(rows)}catch(e){next(e)}});
app.post('/api/remittances',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),{sent_amount,sent_currency='EUR',fee_amount=0,exchange_rate=null,expected_php=null,received_php,account='gcash',provider='',reference='',note='',sent_at,received_at}=req.body||{};if(!Number.isFinite(Number(sent_amount))||Number(sent_amount)<0||!Number.isFinite(Number(fee_amount))||Number(fee_amount)<0||!Number.isFinite(Number(received_php))||Number(received_php)<0||!ACCOUNTS.has(account))return res.status(400).json({error:'Invalid remittance'});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO remittances(business_id,sent_amount,sent_currency,fee_amount,exchange_rate,expected_php,received_php,account,provider,reference,note,sent_at,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW()),COALESCE($13::timestamptz,NOW())) RETURNING *`,[business.id,Number(sent_amount),clean(sent_currency,8).toUpperCase()||'EUR',Number(fee_amount),exchange_rate?Number(exchange_rate):null,expected_php===''||expected_php==null?null:Number(expected_php),Number(received_php),account,clean(provider,80),clean(reference,120),clean(note,250),sent_at||null,received_at||null]);const rem=r.rows[0];if(Number(received_php)>0)await client.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES($1,'money_received','Remittance',$2,$3,$3,$4,'remittance',$5,COALESCE($6::timestamptz,NOW()))`,[business.id,Number(received_php),account,clean(`${provider}${reference?` • ${reference}`:''}`,250),rem.id,received_at||null]);await client.query('COMMIT');res.status(201).json(rem)}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}});

app.get('/api/day-status',async(req,res,next)=>{try{const{business}=await accountingContext(req);res.json(await dayStatus(Number(business.id)))}catch(e){next(e)}});
app.post('/api/open-day',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req);if(!Number.isFinite(Number(req.body?.opening_cash))||Number(req.body.opening_cash)<0)return res.status(400).json({error:'Opening cash is required'});const{rows}=await pool.query(`INSERT INTO daily_openings(business_id,business_date,opening_cash,note) VALUES($1,(NOW() AT TIME ZONE 'Asia/Manila')::date,$2,$3) ON CONFLICT(business_id,business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,note=EXCLUDED.note,updated_at=NOW() RETURNING *`,[business.id,Number(req.body.opening_cash),clean(req.body?.note,250)]);res.json({opening:rows[0],status:await dayStatus(Number(business.id))})}catch(e){next(e)}});
app.post('/api/close-day',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),actual=Number(req.body?.actual_cash);if(!Number.isFinite(actual)||actual<0)return res.status(400).json({error:'Actual cash is required'});const status=await dayStatus(Number(business.id));if(!status.has_opening)return res.status(400).json({error:'Record opening cash first.'});const variance=actual-status.expected_cash;const{rows}=await pool.query(`INSERT INTO daily_closings(business_id,business_date,opening_cash,expected_cash,actual_cash,variance,note) VALUES($1,(NOW() AT TIME ZONE 'Asia/Manila')::date,$2,$3,$4,$5,$6) ON CONFLICT(business_id,business_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash,expected_cash=EXCLUDED.expected_cash,actual_cash=EXCLUDED.actual_cash,variance=EXCLUDED.variance,note=EXCLUDED.note RETURNING *`,[business.id,status.opening_cash,status.expected_cash,actual,variance,clean(req.body?.note,250)]);res.json(rows[0])}catch(e){next(e)}});

app.get('/api/budget',async(req,res,next)=>{try{const{business}=await accountingContext(req);await ensureBudgetRow(Number(business.id));res.json((await pool.query(`SELECT * FROM budgets WHERE business_id=$1 AND id=1`,[business.id])).rows[0])}catch(e){next(e)}});
app.post('/api/budget',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),keys=['personal_daily_limit','personal_weekly_limit','business_daily_limit','min_available_warning'];if(keys.some(k=>!Number.isFinite(Number(req.body?.[k]??0))||Number(req.body?.[k]??0)<0))return res.status(400).json({error:'Budget values must be zero or greater'});await ensureBudgetRow(Number(business.id));const{rows}=await pool.query(`UPDATE budgets SET personal_daily_limit=$1,personal_weekly_limit=$2,business_daily_limit=$3,min_available_warning=$4,updated_at=NOW() WHERE business_id=$5 AND id=1 RETURNING *`,[...keys.map(k=>Number(req.body?.[k]||0)),business.id]);res.json(rows[0])}catch(e){next(e)}});

app.get('/api/analysis',async(req,res,next)=>{try{const{business}=await accountingContext(req),days=Number(req.query.days)===30?30:7;const categories=await pool.query(`SELECT CASE WHEN type='business_expense' THEN 'business' ELSE 'personal' END kind,category,COALESCE(SUM(amount),0) total FROM transactions WHERE business_id=$1 AND type IN ('business_expense','personal_withdrawal') AND occurred_at>=NOW()-($2::int*INTERVAL '1 day') GROUP BY kind,category ORDER BY total DESC`,[business.id,days]);const totals=await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='business_expense' THEN amount ELSE 0 END),0) business,COALESCE(SUM(CASE WHEN type='personal_withdrawal' THEN amount ELSE 0 END),0) personal,COALESCE(SUM(CASE WHEN type='sale' THEN amount ELSE 0 END),0) sales,COALESCE(SUM(CASE WHEN type='money_received' THEN amount ELSE 0 END),0) received FROM transactions WHERE business_id=$1 AND occurred_at>=NOW()-($2::int*INTERVAL '1 day')`,[business.id,days]);res.json({days,totals:totals.rows[0],categories:categories.rows})}catch(e){next(e)}});

app.get('/api/products',async(req,res,next)=>{try{const{business}=await accountingContext(req);res.json(await productsWithRecipes(Number(business.id)))}catch(e){next(e)}});
app.post('/api/products',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),name=clean(req.body?.name,120),category=clean(req.body?.category||'Food',80)||'Food',price=Number(req.body?.selling_price);if(!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Product name and valid selling price are required.'});const{rows}=await pool.query(`INSERT INTO products(business_id,name,category,selling_price,active) VALUES($1,$2,$3,$4,$5) RETURNING *`,[business.id,name,category,price,req.body?.active!==false]);res.status(201).json(rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'A product with this name already exists in this business.'});next(e)}});
app.patch('/api/products/:id',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),id=Number(req.params.id),old=await pool.query(`SELECT * FROM products WHERE id=$1 AND business_id=$2`,[id,business.id]);if(!old.rowCount)return res.status(404).json({error:'Product not found'});const prev=old.rows[0],name=clean(req.body?.name??prev.name,120),category=clean(req.body?.category??prev.category,80)||'Food',price=Number(req.body?.selling_price??prev.selling_price),active=req.body?.active??prev.active;if(!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Invalid product'});const{rows}=await pool.query(`UPDATE products SET name=$1,category=$2,selling_price=$3,active=$4,updated_at=NOW() WHERE id=$5 AND business_id=$6 RETURNING *`,[name,category,price,Boolean(active),id,business.id]);res.json(rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'A product with this name already exists in this business.'});next(e)}});
app.put('/api/products/:id/recipe',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),productId=Number(req.params.id),components=Array.isArray(req.body?.components)?req.body.components:[];const exists=await pool.query(`SELECT id FROM products WHERE id=$1 AND business_id=$2`,[productId,business.id]);if(!exists.rowCount)return res.status(404).json({error:'Product not found'});const normalized=[],seen=new Set();for(const c of components){const inventoryId=Number(c.inventory_id),quantity=Number(c.quantity);if(!Number.isInteger(inventoryId)||!positive(quantity))return res.status(400).json({error:'Every recipe component needs an inventory item and quantity greater than zero.'});if(seen.has(inventoryId))return res.status(400).json({error:'The same ingredient cannot appear twice in one recipe.'});seen.add(inventoryId);normalized.push({inventoryId,quantity})}if(normalized.length){const check=await pool.query(`SELECT id FROM inventory WHERE business_id=$1 AND id=ANY($2::bigint[])`,[business.id,normalized.map(x=>x.inventoryId)]);if(check.rowCount!==normalized.length)return res.status(400).json({error:'One or more inventory ingredients do not belong to this business.'})}const client=await pool.connect();try{await client.query('BEGIN');await client.query(`DELETE FROM recipes WHERE product_id=$1`,[productId]);for(const c of normalized)await client.query(`INSERT INTO recipes(product_id,inventory_id,quantity) VALUES($1,$2,$3)`,[productId,c.inventoryId,c.quantity]);await client.query('COMMIT');res.json((await productsWithRecipes(Number(business.id))).find(p=>p.id===productId))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}});

app.post('/api/product-sales',jsonBody,async(req,res,next)=>{try{const{business}=await accountingContext(req),productId=Number(req.body?.product_id),quantity=Number(req.body?.quantity),account=req.body?.account||'cash',note=clean(req.body?.note||'',250),occurredAt=req.body?.occurred_at||null;if(!Number.isInteger(productId)||!positive(quantity)||!ACCOUNTS.has(account))return res.status(400).json({error:'Product, quantity and valid account are required.'});const client=await pool.connect();try{await client.query('BEGIN');const pr=await client.query(`SELECT * FROM products WHERE id=$1 AND business_id=$2 FOR SHARE`,[productId,business.id]);if(!pr.rowCount)throw Object.assign(new Error('Product not found.'),{status:404});const product=pr.rows[0];if(!product.active)throw Object.assign(new Error('This product is inactive.'),{status:409});const recipe=await client.query(`SELECT r.inventory_id,r.quantity recipe_quantity,i.item,i.unit,i.quantity stock_quantity,i.unit_cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 AND i.business_id=$2 ORDER BY i.id FOR UPDATE OF i`,[productId,business.id]);const shortages=[];let unitCost=0;for(const row of recipe.rows){const needed=Number(row.recipe_quantity)*quantity,stock=Number(row.stock_quantity);unitCost+=Number(row.recipe_quantity)*Number(row.unit_cost);if(stock+1e-9<needed)shortages.push({item:row.item,unit:row.unit,required:needed,available:stock,short:needed-stock})}if(shortages.length)throw Object.assign(new Error('Not enough stock for this sale.'),{status:409,shortages});const unitPrice=Number(product.selling_price),revenue=money(unitPrice*quantity),cogs=money(unitCost*quantity),gross=money(revenue-cogs);const tx=await client.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,occurred_at) VALUES($1,'sale',$2,$3,$4,$4,$5,'product_sale',COALESCE($6::timestamptz,NOW())) RETURNING *`,[business.id,product.name,revenue,account,clean(`${quantity} × ${product.name}${note?` • ${note}`:''}`,250),occurredAt]);const sale=await client.query(`INSERT INTO product_sales(business_id,product_id,product_name_snapshot,quantity,unit_price_snapshot,unit_cost_snapshot,revenue,estimated_cogs,gross_profit,account,transaction_id,note,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,NOW())) RETURNING *`,[business.id,productId,product.name,quantity,unitPrice,unitCost,revenue,cogs,gross,account,tx.rows[0].id,note,occurredAt]);const saleId=sale.rows[0].id;await client.query(`UPDATE transactions SET source_id=$1 WHERE id=$2`,[saleId,tx.rows[0].id]);for(const row of recipe.rows){const used=Number(row.recipe_quantity)*quantity,componentCost=used*Number(row.unit_cost);await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,[used,row.inventory_id,business.id]);await client.query(`INSERT INTO product_sale_ingredients(sale_id,inventory_id,item_name_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot) VALUES($1,$2,$3,$4,$5,$6)`,[saleId,row.inventory_id,row.item,used,Number(row.unit_cost),componentCost])}await client.query('COMMIT');res.status(201).json({...sale.rows[0],margin_pct:revenue>0?Math.round((gross/revenue)*1000)/10:0})}catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.shortages)return res.status(e.status||409).json({error:e.message,shortages:e.shortages});throw e}finally{client.release()}}catch(e){next(e)}});
app.get('/api/product-sales',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT ps.*,t.created_at transaction_created_at FROM product_sales ps JOIN transactions t ON t.id=ps.transaction_id WHERE ps.business_id=$1 ORDER BY ps.occurred_at DESC,ps.id DESC LIMIT 250`,[business.id]);res.json(rows)}catch(e){next(e)}});
app.get('/api/product-profitability',async(req,res,next)=>{try{const{business}=await accountingContext(req),days=Number(req.query.days)===30?30:7;const totals=await pool.query(`SELECT COALESCE(SUM(quantity),0) portions,COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit FROM product_sales WHERE business_id=$1 AND occurred_at>=NOW()-($2::int*INTERVAL '1 day')`,[business.id,days]);const products=await pool.query(`SELECT product_id,product_name_snapshot name,COALESCE(SUM(quantity),0) quantity,COALESCE(SUM(revenue),0) revenue,COALESCE(SUM(estimated_cogs),0) cogs,COALESCE(SUM(gross_profit),0) gross_profit FROM product_sales WHERE business_id=$1 AND occurred_at>=NOW()-($2::int*INTERVAL '1 day') GROUP BY product_id,product_name_snapshot ORDER BY gross_profit DESC,revenue DESC`,[business.id,days]);const t=totals.rows[0],revenue=Number(t.revenue),gross=Number(t.gross_profit);res.json({days,totals:{portions:Number(t.portions),revenue,cogs:Number(t.cogs),gross_profit:gross,margin_pct:revenue>0?Math.round((gross/revenue)*1000)/10:0},products:products.rows.map(r=>{const rev=Number(r.revenue),gp=Number(r.gross_profit);return{...r,product_id:Number(r.product_id),quantity:Number(r.quantity),revenue:rev,cogs:Number(r.cogs),gross_profit:gp,margin_pct:rev>0?Math.round((gp/rev)*1000)/10:0}})})}catch(e){next(e)}});

app.get('/api/export.csv',async(req,res,next)=>{try{const{business}=await accountingContext(req);const{rows}=await pool.query(`SELECT id,type,category,amount,account,source,note,occurred_at FROM transactions WHERE business_id=$1 ORDER BY occurred_at`,[business.id]);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv=['id,type,category,amount,account,source,note,occurred_at',...rows.map(r=>[r.id,r.type,r.category,r.amount,r.account,r.source,r.note,r.occurred_at.toISOString()].map(esc).join(','))].join('\n');res.type('text/csv').set('Content-Disposition',`attachment; filename="transactions-business-${business.id}.csv"`).send(csv)}catch(e){next(e)}});

app.post('/api/orders/merchant/:id/payment',jsonBody,async(req,res,next)=>{const client=await pool.connect();try{const ctx=await accountingContext(req);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});await client.query('BEGIN');const q=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[Number(req.params.id)]);if(!q.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const order=q.rows[0];if(!ctx.businesses.some(b=>Number(b.id)===Number(order.business_id)))throw Object.assign(new Error('Business workspace unavailable'),{status:403});const amount=money(req.body?.amount),account=clean(req.body?.account,30);if(!positive(amount)||!ACCOUNTS.has(account))throw Object.assign(new Error('Choose a valid payment amount and receiving account'),{status:400});const outstanding=money(Number(order.total)-Number(order.paid_amount));if(amount>outstanding+0.001)throw Object.assign(new Error('Payment exceeds the outstanding amount'),{status:409});const allocated=await client.query(`SELECT COALESCE(SUM(merchandise_amount),0) merchandise,COALESCE(SUM(delivery_amount),0) delivery FROM order_payments WHERE order_id=$1 AND status='confirmed'`,[order.id]);const merchandiseRemaining=Math.max(0,money(Number(order.subtotal)-Number(allocated.rows[0].merchandise))),deliveryRemaining=Math.max(0,money(Number(order.delivery_fee)-Number(allocated.rows[0].delivery))),merchandiseAmount=money(Math.min(amount,merchandiseRemaining)),deliveryAmount=money(Math.min(amount-merchandiseAmount,deliveryRemaining));if(money(merchandiseAmount+deliveryAmount)!==amount)throw Object.assign(new Error('Payment allocation does not match order balance'),{status:409});const payment=await client.query(`INSERT INTO order_payments(order_id,amount,merchandise_amount,delivery_amount,account,method_code,provider_code,provider_reference,status,received_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9) RETURNING *`,[order.id,amount,merchandiseAmount,deliveryAmount,account,clean(req.body?.method_code||order.payment_method,40),clean(req.body?.provider_code||'manual_merchant_confirmation',80),clean(req.body?.provider_reference,160),ctx.me.account.id]);const paymentId=Number(payment.rows[0].id),paid=money(Number(order.paid_amount)+amount),remaining=money(Number(order.total)-paid),paymentStatus=remaining<=0.001?'paid':'partial';await client.query(`UPDATE orders SET paid_amount=$1,outstanding_amount=$2,payment_status=$3,updated_at=NOW() WHERE id=$4`,[paid,remaining,paymentStatus,order.id]);if(merchandiseAmount>0)await client.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES($1,'sale',$2,$3,$4,$4,$5,'order_payment',$6,NOW()) ON CONFLICT DO NOTHING`,[order.business_id,`Order ${order.order_number||order.id}`,merchandiseAmount,account,`Merchandise payment received for ${order.order_number||`order ${order.id}`}`,paymentId]);if(deliveryAmount>0){const d=await client.query(`SELECT id FROM deliveries WHERE order_id=$1`,[order.id]);await client.query(`INSERT INTO delivery_financial_events(order_id,delivery_id,event_type,amount,currency_code,source_payment_id) VALUES($1,$2,'delivery_fee_received',$3,$4,$5) ON CONFLICT(event_type,source_payment_id) DO NOTHING`,[order.id,d.rows[0]?.id||null,deliveryAmount,order.currency_code||'PHP',paymentId])}if(paymentStatus==='paid'&&order.order_status==='awaiting_payment'){await client.query(`UPDATE orders SET order_status='accepted',accepted_at=COALESCE(accepted_at,NOW()),updated_at=NOW() WHERE id=$1`,[order.id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,'awaiting_payment','accepted',$2,'Payment confirmed')`,[order.id,ctx.me.account.id])}await client.query('COMMIT');const r=await upstream(`/api/orders/${order.id}`,{headers:{Authorization:authHeader(req)}});res.status(r.status).json(await r.json())}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}});

async function purchaseOrderDetail(id){const q=await pool.query(`SELECT p.*,b.name business_name,a.display_name supplier_account_name,s.supplier_name FROM purchase_orders p JOIN businesses b ON b.id=p.business_id JOIN accounts a ON a.id=p.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=a.id WHERE p.id=$1`,[id]);if(!q.rowCount)return null;const items=await pool.query(`SELECT i.*,l.legacy_inventory_id,inv.item legacy_inventory_name FROM purchase_order_items i LEFT JOIN merchant_supplier_item_links l ON l.business_id=$1 AND l.catalog_item_id=i.catalog_item_id LEFT JOIN inventory inv ON inv.id=l.legacy_inventory_id AND inv.business_id=$1 WHERE i.purchase_order_id=$2 ORDER BY i.id`,[q.rows[0].business_id,id]);return{...q.rows[0],items:items.rows}}
app.put('/api/procurement/catalog/:catalogId/link',jsonBody,async(req,res,next)=>{try{const ctx=await accountingContext(req);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});const businessId=Number(req.body?.business_id||ctx.business.id),owned=ctx.businesses.find(b=>Number(b.id)===businessId);if(!owned)return res.status(403).json({error:'Business unavailable'});const catalogId=Number(req.params.catalogId),item=await pool.query(`SELECT supplier_account_id,product_name FROM supplier_catalog_items WHERE id=$1`,[catalogId]);if(!item.rowCount)return res.status(404).json({error:'Catalog item not found'});const rel=await pool.query(`SELECT 1 FROM supplier_relationships WHERE business_id=$1 AND supplier_account_id=$2 AND state='accepted'`,[businessId,item.rows[0].supplier_account_id]);if(!rel.rowCount)return res.status(403).json({error:'Accepted relationship required'});const inventoryId=req.body?.legacy_inventory_id?Number(req.body.legacy_inventory_id):null;if(inventoryId){const inv=await pool.query(`SELECT id FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,businessId]);if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found in this business'})}await pool.query(`INSERT INTO merchant_supplier_item_links(business_id,catalog_item_id,legacy_inventory_id,merchant_item_name) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,catalog_item_id) DO UPDATE SET legacy_inventory_id=EXCLUDED.legacy_inventory_id,merchant_item_name=EXCLUDED.merchant_item_name`,[businessId,catalogId,inventoryId,clean(req.body?.merchant_item_name,150)||item.rows[0].product_name]);res.json({ok:true})}catch(e){next(e)}});
app.post('/api/procurement/orders/:id/receive',jsonBody,async(req,res,next)=>{try{const id=Number(req.params.id),po=await purchaseOrderDetail(id);if(!po)return res.status(404).json({error:'PO not found'});const ctx=await specificBusiness(req,po.business_id);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});const received=Array.isArray(req.body?.items)?req.body.items:[];if(!received.length)return res.status(400).json({error:'Enter received quantities'});const client=await pool.connect();try{await client.query('BEGIN');const lock=await client.query(`SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE`,[id]);if(['received','cancelled','rejected'].includes(lock.rows[0].status))throw Object.assign(new Error('PO can no longer be received'),{status:409});const receipt=await client.query(`INSERT INTO purchase_receipts(purchase_order_id,received_by_account_id,note) VALUES($1,$2,$3) RETURNING id`,[id,ctx.me.account.id,clean(req.body?.note,800)]);let actual=0;for(const r of received){const itemId=Number(r.item_id),packs=Number(r.received_packs);if(!positive(packs))continue;const item=await client.query(`SELECT i.*,l.legacy_inventory_id FROM purchase_order_items i LEFT JOIN merchant_supplier_item_links l ON l.business_id=$1 AND l.catalog_item_id=i.catalog_item_id WHERE i.id=$2 AND i.purchase_order_id=$3 FOR UPDATE`,[ctx.business.id,itemId,id]);if(!item.rowCount)continue;const x=item.rows[0],maxPacks=Number(x.confirmed_packs??x.ordered_packs),remaining=maxPacks-Number(x.received_packs);if(packs>remaining+1e-9)throw Object.assign(new Error(`Received quantity for ${x.name_snapshot} exceeds remaining confirmed quantity`),{status:409});const baseUnits=packs*Number(x.base_units_per_pack_snapshot),price=Number(r.actual_price_per_pack??x.confirmed_price_per_pack??x.price_per_pack_snapshot);if(!Number.isFinite(price)||price<0)throw Object.assign(new Error('Actual price is invalid'),{status:400});if(x.legacy_inventory_id){const inv=await client.query(`SELECT id FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,[x.legacy_inventory_id,ctx.business.id]);if(!inv.rowCount)throw Object.assign(new Error('Linked inventory item does not belong to this business'),{status:409});await client.query(`UPDATE inventory SET quantity=quantity+$1,unit_cost=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4`,[baseUnits,price/Number(x.base_units_per_pack_snapshot),x.legacy_inventory_id,ctx.business.id])}await client.query(`INSERT INTO purchase_receipt_items(receipt_id,purchase_order_item_id,received_packs,received_base_units,actual_price_per_pack,legacy_inventory_id) VALUES($1,$2,$3,$4,$5,$6)`,[receipt.rows[0].id,x.id,packs,baseUnits,price,x.legacy_inventory_id]);await client.query(`UPDATE purchase_order_items SET received_packs=received_packs+$1 WHERE id=$2`,[packs,x.id]);actual+=packs*price}const remaining=await client.query(`SELECT COUNT(*)::int open_count FROM purchase_order_items WHERE purchase_order_id=$1 AND received_packs+0.000001<COALESCE(confirmed_packs,ordered_packs)`,[id]);const status=Number(remaining.rows[0].open_count)===0?'received':'partially_received';await client.query(`UPDATE purchase_orders SET status=$1,actual_received_total=actual_received_total+$2,received_at=CASE WHEN $1='received' THEN NOW() ELSE received_at END,updated_at=NOW() WHERE id=$3`,[status,money(actual),id]);await client.query('COMMIT');res.json(await purchaseOrderDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/procurement/orders/:id/payment',jsonBody,async(req,res,next)=>{try{const id=Number(req.params.id),po=await purchaseOrderDetail(id);if(!po)return res.status(404).json({error:'PO not found'});const ctx=await specificBusiness(req,po.business_id);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});const amount=Number(req.body?.amount),account=clean(req.body?.account,30);if(!positive(amount)||!ACCOUNTS.has(account))return res.status(400).json({error:'Valid payment amount and account required'});const outstanding=Math.max(0,Number(po.expected_total)-Number(po.paid_amount));if(amount>outstanding+0.001)return res.status(409).json({error:'Payment exceeds PO outstanding amount'});const paid=money(Number(po.paid_amount)+amount),status=paid+0.001>=Number(po.expected_total)?'paid':'partial',sourceId=Number(id)*1000000+Math.round(paid*100);const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE purchase_orders SET paid_amount=$1,payment_status=$2,updated_at=NOW() WHERE id=$3`,[paid,status,id]);await client.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES($1,'business_expense','Supplier payment',$2,$3,$3,$4,'supplier_payment',$5,NOW()) ON CONFLICT DO NOTHING`,[ctx.business.id,amount,account,`Payment for ${po.po_number}`,sourceId]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}const supplierBusiness=await ensureProfileBusinessBinding(Number(po.supplier_account_id),'supplier',null,po.supplier_name||'',ctx.me.account.id);if(supplierBusiness)await pool.query(`INSERT INTO transactions(business_id,type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES($1,'sale','Supplier order',$2,$3,$3,$4,'supplier_receipt',$5,NOW()) ON CONFLICT DO NOTHING`,[supplierBusiness.id,amount,account,`Payment received for ${po.po_number}`,sourceId]);res.json(await purchaseOrderDetail(id))}catch(e){next(e)}});
app.get('/api/procurement/reorder-suggestions',async(req,res,next)=>{try{const ctx=await accountingContext(req);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});const businessId=Number(req.query.business_id||ctx.business.id),owned=ctx.businesses.find(b=>Number(b.id)===businessId);if(!owned)return res.status(403).json({error:'Business unavailable'});const{rows}=await pool.query(`SELECT i.id inventory_id,i.item,i.quantity,i.reorder_level,i.unit,i.unit_cost,l.catalog_item_id,c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,c.price_per_pack,c.minimum_packs,c.lead_time_days,c.supplier_account_id,COALESCE(s.supplier_name,a.display_name) supplier_name FROM inventory i LEFT JOIN merchant_supplier_item_links l ON l.business_id=$1 AND l.legacy_inventory_id=i.id LEFT JOIN supplier_catalog_items c ON c.id=l.catalog_item_id AND c.active=TRUE LEFT JOIN accounts a ON a.id=c.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=c.supplier_account_id WHERE i.business_id=$1 AND i.quantity<=i.reorder_level ORDER BY (i.reorder_level-i.quantity) DESC`,[businessId]);res.json(rows.map(x=>({...x,suggested_packs:x.catalog_item_id?Math.max(Number(x.minimum_packs||1),Math.ceil(Math.max(0,Number(x.reorder_level)-Number(x.quantity))/Number(x.base_units_per_pack||1))):null})))}catch(e){next(e)}});
app.post('/api/merchant/storefront/import-legacy',jsonBody,async(req,res,next)=>{try{const ctx=await accountingContext(req);if(ctx.role!=='merchant')throw Object.assign(new Error('Merchant profile required'),{status:403});const businessId=Number(req.body?.business_id||ctx.business.id),owned=ctx.businesses.find(b=>Number(b.id)===businessId);if(!owned)return res.status(403).json({error:'Business unavailable'});const r=await pool.query(`INSERT INTO marketplace_products(business_id,legacy_product_id,name,description,category,product_domain,product_kind,unit_code,quantity_per_unit,selling_price,stock_tracked,stock_quantity,active,published) SELECT $1,p.id,p.name,'',p.category,'food','prepared_food','item',1,p.selling_price,FALSE,NULL,p.active,FALSE FROM products p WHERE p.business_id=$1 ON CONFLICT(business_id,legacy_product_id) WHERE legacy_product_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,selling_price=EXCLUDED.selling_price,active=EXCLUDED.active,updated_at=NOW() RETURNING id`,[businessId]);const products=await pool.query(`SELECT * FROM marketplace_products WHERE business_id=$1 ORDER BY category,name`,[businessId]);res.json({imported_or_updated:r.rowCount,products:products.rows})}catch(e){next(e)}});

app.post('/api/governance/admin/applications/:id/review',jsonBody,async(req,res,next)=>{try{const response=await upstream(req.originalUrl,{method:'POST',headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:JSON.stringify(req.body||{})});const data=await response.json().catch(()=>({}));if(response.ok&&req.body?.decision==='approve'){const a=await pool.query(`SELECT account_id,role,territory_id,proposed_business_name FROM profile_applications WHERE id=$1`,[Number(req.params.id)]);if(a.rowCount&&['merchant','supplier'].includes(a.rows[0].role))await ensureProfileBusinessBinding(Number(a.rows[0].account_id),a.rows[0].role,Number(a.rows[0].territory_id)||null,a.rows[0].proposed_business_name||'',1)}res.status(response.status).json(data)}catch(e){next(e)}});

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${upstreamPort}`};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Platform upstream unavailable'})});req.pipe(up)}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'});});

function start(){child=spawn(process.execPath,['server-profile-governance.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Profile governance child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<180;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,250))}throw new Error('Profile governance child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initAccountingTenancyDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life multi-business accounting gateway listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
