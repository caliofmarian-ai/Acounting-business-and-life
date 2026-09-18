import crypto from 'node:crypto';

export const ADMIN_FINANCE_ENTRY_TYPES=Object.freeze([
  'income','expense','payroll','owner_distribution','transfer_in','transfer_out','adjustment_in','adjustment_out'
]);
export const ADMIN_FINANCE_CATEGORIES=Object.freeze([
  'platform_income','merchant_fees','delivery_fees','service_fees','supplier_fees',
  'infrastructure','database','storage','monitoring_security','maps_api','ai_api','notification',
  'payroll_contractor','marketing','support','legal_compliance','accounting','insurance_licence',
  'tax','refund_loss','chargeback_dispute','operator_share','owner_distribution','other'
]);
export const ADMIN_BUDGET_CATEGORIES=Object.freeze([
  'infrastructure','apis_ai','payroll_contractors','marketing_growth','support_operations',
  'legal_compliance','accounting_tax','insurance_licence','territory_operations','other'
]);

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const positive=(v,label='amount')=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0)throw Object.assign(new Error(label+' must be greater than zero'),{status:400});
  return money(n);
};
const publicId=prefix=>prefix+'_'+crypto.randomBytes(10).toString('hex');
const signFor=type=>['income','transfer_in','adjustment_in'].includes(type)?1:-1;

export async function ensureAdminFinanceSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_finance_budgets(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id),
      function_code TEXT NOT NULL DEFAULT '',
      budget_category TEXT NOT NULL,
      label TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      allocated_amount NUMERIC(14,2) NOT NULL CHECK(allocated_amount>=0),
      period_start DATE,
      period_end DATE,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(status IN ('active','closed','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS admin_finance_budgets_scope_idx
      ON admin_finance_budgets(country_code,territory_id,function_code,status,created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_finance_entries(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      entry_key TEXT NOT NULL UNIQUE,
      entry_type TEXT NOT NULL,
      category TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id),
      function_code TEXT NOT NULL DEFAULT '',
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      direction TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      counterparty TEXT NOT NULL DEFAULT '',
      evidence_reference TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      provider_code TEXT NOT NULL DEFAULT '',
      provider_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_by_account_id BIGINT REFERENCES accounts(id),
      voided_by_account_id BIGINT REFERENCES accounts(id),
      void_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(entry_type IN ('income','expense','payroll','owner_distribution','transfer_in','transfer_out','adjustment_in','adjustment_out')),
      CHECK(direction IN ('in','out')),
      CHECK(status IN ('active','void'))
    );
    CREATE INDEX IF NOT EXISTS admin_finance_entries_scope_idx
      ON admin_finance_entries(country_code,territory_id,function_code,occurred_at DESC,status);
    CREATE INDEX IF NOT EXISTS admin_finance_entries_category_idx
      ON admin_finance_entries(category,occurred_at DESC,status);
  `);
}

export async function createAdminBudget(pool,input={}){
  const category=clean(input.budgetCategory,80);
  if(!ADMIN_BUDGET_CATEGORIES.includes(category))throw Object.assign(new Error('Unsupported Admin budget category'),{status:400});
  const label=clean(input.label,180);
  if(!label)throw Object.assign(new Error('Budget label is required'),{status:400});
  const amount=positive(input.allocatedAmount,'allocated_amount');
  const territoryId=input.territoryId==null?null:Number(input.territoryId);
  const functionCode=clean(input.functionCode,100);
  const {rows}=await pool.query(`
    INSERT INTO admin_finance_budgets(
      public_id,country_code,territory_id,function_code,budget_category,label,currency_code,
      allocated_amount,period_start,period_end,created_by_account_id
    ) VALUES($1,'PH',$2,$3,$4,$5,'PHP',$6,$7,$8,$9)
    RETURNING *
  `,[
    publicId('afb'),territoryId,functionCode,category,label,amount,
    input.periodStart||null,input.periodEnd||null,input.createdByAccountId||null
  ]);
  return rows[0];
}

export async function createAdminFinanceEntry(pool,input={}){
  const type=clean(input.entryType,40);
  if(!ADMIN_FINANCE_ENTRY_TYPES.includes(type))throw Object.assign(new Error('Unsupported Admin finance entry type'),{status:400});
  const category=clean(input.category,80);
  if(!ADMIN_FINANCE_CATEGORIES.includes(category))throw Object.assign(new Error('Unsupported Admin finance category'),{status:400});
  const amount=positive(input.amount);
  const entryKey=clean(input.entryKey,220);
  if(!entryKey)throw Object.assign(new Error('Idempotency key is required'),{status:400});
  const expectedDirection=signFor(type)>0?'in':'out';
  const territoryId=input.territoryId==null?null:Number(input.territoryId);
  try{
    const {rows}=await pool.query(`
      INSERT INTO admin_finance_entries(
        public_id,entry_key,entry_type,category,country_code,territory_id,function_code,currency_code,
        amount,direction,occurred_at,counterparty,evidence_reference,description,
        provider_code,provider_reference,created_by_account_id
      ) VALUES($1,$2,$3,$4,'PH',$5,$6,'PHP',$7,$8,COALESCE($9::timestamptz,NOW()),$10,$11,$12,$13,$14,$15)
      RETURNING *
    `,[
      publicId('afe'),entryKey,type,category,territoryId,clean(input.functionCode,100),
      amount,expectedDirection,input.occurredAt||null,clean(input.counterparty,180),
      clean(input.evidenceReference,500),clean(input.description,1000),clean(input.providerCode,80),
      clean(input.providerReference,220),input.createdByAccountId||null
    ]);
    return rows[0];
  }catch(e){
    if(e?.code==='23505'){
      const q=await pool.query('SELECT * FROM admin_finance_entries WHERE entry_key=$1',[entryKey]);
      if(q.rowCount)return q.rows[0];
    }
    throw e;
  }
}

function scopeSql({countryWide=false,territoryIds=[]},alias='e'){
  if(countryWide)return{sql:`${alias}.country_code='PH'`,args:[]};
  const ids=(territoryIds||[]).map(Number).filter(Number.isFinite);
  if(!ids.length)return{sql:'FALSE',args:[]};
  return{sql:`${alias}.territory_id=ANY($1::bigint[])`,args:[ids]};
}

export async function adminFinanceSummary(pool,{countryWide=false,territoryIds=[],functionCodes=[]}={}){
  const scope=scopeSql({countryWide,territoryIds},'e');
  const fn=(functionCodes||[]).map(x=>clean(x,100)).filter(Boolean);
  const fnSql=fn.length?` AND e.function_code=ANY(${scope.args.length+1}::text[])`:'';
  const args=[...scope.args,...(fn.length?[fn]:[])];
  const entries=await pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND direction='in'),0) money_in,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND direction='out'),0) money_out,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND entry_type='income'),0) income,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND entry_type='expense'),0) expenses,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND entry_type='payroll'),0) payroll,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND entry_type='owner_distribution'),0) owner_distributions,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND category IN ('infrastructure','database','storage','monitoring_security')),0) infrastructure,
      COALESCE(SUM(amount) FILTER(WHERE status='active' AND category IN ('ai_api','maps_api','notification')),0) api_ai,
      COUNT(*) FILTER(WHERE status='active')::int entry_count
    FROM admin_finance_entries e
    WHERE ${scope.sql}${fnSql}
  `,args);
  const budgets=await pool.query(`
    SELECT COALESCE(SUM(allocated_amount),0) allocated_budget,COUNT(*) FILTER(WHERE status='active')::int budget_count
    FROM admin_finance_budgets e
    WHERE ${scope.sql.replaceAll('e.','e.')}${fnSql.replaceAll('e.function_code','e.function_code')}
  `,args);
  const recent=await pool.query(`
    SELECT e.* FROM admin_finance_entries e
    WHERE ${scope.sql}${fnSql}
    ORDER BY occurred_at DESC,id DESC LIMIT 60
  `,args);
  const b=budgets.rows[0]||{},x=entries.rows[0]||{};
  const moneyIn=money(x.money_in),moneyOut=money(x.money_out),allocated=money(b.allocated_budget);
  return{
    currency_code:'PHP',
    summary:{
      recorded_company_balance:money(moneyIn-moneyOut),
      money_in:moneyIn,money_out:moneyOut,
      income:money(x.income),expenses:money(x.expenses),payroll:money(x.payroll),
      owner_distributions:money(x.owner_distributions),
      infrastructure:money(x.infrastructure),api_ai:money(x.api_ai),
      allocated_budget:allocated,
      recorded_unallocated:money((moneyIn-moneyOut)-allocated),
      entry_count:Number(x.entry_count||0),budget_count:Number(b.budget_count||0)
    },
    authority:{
      recorded_company_balance:'Internal recorded Admin finance ledger only',
      provider_balance:null,
      provider_balance_status:'NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE',
      owner_distribution_rule:'Owner distribution is separate from operating expense and payroll.'
    },
    recent_entries:recent.rows
  };
}

export async function listAdminBudgets(pool,{countryWide=false,territoryIds=[],functionCodes=[]}={}){
  const scope=scopeSql({countryWide,territoryIds},'b');
  const fn=(functionCodes||[]).map(x=>clean(x,100)).filter(Boolean);
  const fnSql=fn.length?` AND b.function_code=ANY(${scope.args.length+1}::text[])`:'';
  const args=[...scope.args,...(fn.length?[fn]:[])];
  const {rows}=await pool.query(`
    SELECT b.*,t.name territory_name FROM admin_finance_budgets b
    LEFT JOIN territories t ON t.id=b.territory_id
    WHERE ${scope.sql}${fnSql}
    ORDER BY b.status='active' DESC,b.created_at DESC
  `,args);
  return rows;
}
