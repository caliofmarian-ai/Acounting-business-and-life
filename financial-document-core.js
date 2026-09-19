import crypto from 'node:crypto';

export const FINANCIAL_DOCUMENT_TYPES=Object.freeze([
  'sale_invoice_candidate','service_invoice_candidate','subscription_invoice','payment_receipt',
  'refund_credit','expense_evidence','processor_fee_record','platform_fee_record','tax_record',
  'delivery_settlement_record','payout_record','profile_transfer_record','owner_distribution_record',
  'accounting_adjustment_record','generic_financial_evidence'
]);

export const FINANCIAL_DOCUMENT_PROFILE_ROLES=Object.freeze([
  'customer','merchant','supplier','courier','service_provider'
]);

export const FINANCIAL_IMPACT_CLASSES=Object.freeze([
  'revenue','expense','purchase','cash_in','cash_out','refund_in',
  'transfer_in','transfer_out','fee_expense','tax_expense','neutral'
]);

const ROLE_SET=new Set(FINANCIAL_DOCUMENT_PROFILE_ROLES);
const TYPE_SET=new Set(FINANCIAL_DOCUMENT_TYPES);
const IMPACT_SET=new Set(FINANCIAL_IMPACT_CLASSES);
const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const numericId=v=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null};
const stableId=(prefix,key)=>prefix+'_'+crypto.createHash('sha256').update(String(key),'utf8').digest('hex').slice(0,24);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

export function normalizeFinancialProfileRole(role){
  const r=clean(role,40)==='local_services'?'service_provider':clean(role,40);
  if(!ROLE_SET.has(r))fail('Unsupported financial document profile role');
  return r;
}

export function financialPeriodRange(period,anchor){
  const p=clean(period,20).toLowerCase();
  if(!['day','week','month','year'].includes(p))fail('Period must be day, week, month or year');
  const raw=clean(anchor||new Date().toISOString().slice(0,10),10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))fail('Anchor must use YYYY-MM-DD');
  const [y,m,d]=raw.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)fail('Anchor is not a valid date');
  let start;
  if(p==='day')start=new Date(date);
  if(p==='week'){
    start=new Date(date);
    const day=start.getUTCDay();
    const offset=day===0?-6:1-day;
    start.setUTCDate(start.getUTCDate()+offset);
  }
  if(p==='month')start=new Date(Date.UTC(y,m-1,1));
  if(p==='year')start=new Date(Date.UTC(y,0,1));
  const end=new Date(start);
  if(p==='day')end.setUTCDate(end.getUTCDate()+1);
  if(p==='week')end.setUTCDate(end.getUTCDate()+7);
  if(p==='month')end.setUTCMonth(end.getUTCMonth()+1);
  if(p==='year')end.setUTCFullYear(end.getUTCFullYear()+1);
  return{
    period:p,
    anchor:raw,
    start_date:start.toISOString().slice(0,10),
    end_date_exclusive:end.toISOString().slice(0,10),
    timezone:'Asia/Manila'
  };
}

export async function ensureFinancialDocumentSchema(pool){
  const statements=[
    `CREATE TABLE IF NOT EXISTS financial_documents(
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      document_key TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL DEFAULT 'PH',
      owner_scope TEXT NOT NULL,
      account_id BIGINT REFERENCES accounts(id) ON DELETE RESTRICT,
      profile_role TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL,
      document_status TEXT NOT NULL DEFAULT 'active',
      fiscal_status TEXT NOT NULL DEFAULT 'internal_evidence',
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      counterparty_label TEXT NOT NULL DEFAULT '',
      source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(owner_scope IN ('account','business')),
      CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider')),
      CHECK(document_type IN ('sale_invoice_candidate','service_invoice_candidate','subscription_invoice','payment_receipt','refund_credit','expense_evidence','processor_fee_record','platform_fee_record','tax_record','delivery_settlement_record','payout_record','profile_transfer_record','owner_distribution_record','accounting_adjustment_record','generic_financial_evidence')),
      CHECK(document_status IN ('active','reversed','void')),
      CHECK(fiscal_status IN ('internal_evidence','fiscal_candidate','fiscal_validated','not_applicable')),
      CHECK(gross_amount>=0),
      CHECK((owner_scope='business' AND business_id IS NOT NULL) OR (owner_scope='account' AND account_id IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS financial_documents_scope_idx
      ON financial_documents(profile_role,account_id,business_id,occurred_at DESC,id DESC)`,
    `CREATE INDEX IF NOT EXISTS financial_documents_source_idx
      ON financial_documents(source_type,source_id)`,
    `CREATE TABLE IF NOT EXISTS financial_document_source_links(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_relation TEXT NOT NULL DEFAULT 'primary',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id,source_type,source_id,source_relation)
    )`,
    `CREATE TABLE IF NOT EXISTS financial_document_lines(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
      line_code TEXT NOT NULL,
      line_kind TEXT NOT NULL,
      impact_class TEXT NOT NULL,
      economic_owner TEXT NOT NULL DEFAULT '',
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      note TEXT NOT NULL DEFAULT '',
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id,line_code),
      CHECK(impact_class IN ('revenue','expense','purchase','cash_in','cash_out','refund_in','transfer_in','transfer_out','fee_expense','tax_expense','neutral')),
      CHECK(amount>=0)
    )`,
    `CREATE INDEX IF NOT EXISTS financial_document_lines_document_idx
      ON financial_document_lines(document_id,id)`
  ];
  for(const sql of statements)await pool.query(sql);
}

function transactionSemantic(type){
  const t=clean(type,40);
  if(t==='sale')return{documentType:'sale_invoice_candidate',lineKind:'sale_value',impact:'revenue',title:'Sale'};
  if(t==='business_expense')return{documentType:'expense_evidence',lineKind:'business_expense',impact:'expense',title:'Business expense'};
  if(t==='money_received')return{documentType:'payment_receipt',lineKind:'money_received',impact:'cash_in',title:'Money received'};
  if(t==='personal_withdrawal')return{documentType:'owner_distribution_record',lineKind:'owner_distribution',impact:'cash_out',title:'Owner/personal withdrawal'};
  if(t==='profile_transfer_in')return{documentType:'profile_transfer_record',lineKind:'profile_transfer_in',impact:'transfer_in',title:'Profile transfer in'};
  if(t==='profile_transfer_out')return{documentType:'profile_transfer_record',lineKind:'profile_transfer_out',impact:'transfer_out',title:'Profile transfer out'};
  return{documentType:'accounting_adjustment_record',lineKind:'accounting_adjustment',impact:'cash_in',title:'Accounting adjustment'};
}

function profileEntrySemantic(row){
  if(row.entry_type==='expense')return{documentType:'expense_evidence',lineKind:'profile_expense',impact:'expense',title:'Profile expense'};
  if(row.entry_type==='money_in')return{documentType:'payment_receipt',lineKind:'profile_money_in',impact:'cash_in',title:'Money received'};
  if(row.entry_type==='profile_transfer_in')return{documentType:'profile_transfer_record',lineKind:'profile_transfer_in',impact:'transfer_in',title:'Profile transfer in'};
  if(row.entry_type==='profile_transfer_out')return{documentType:'profile_transfer_record',lineKind:'profile_transfer_out',impact:'transfer_out',title:'Profile transfer out'};
  if(row.entry_type==='reversal')return{documentType:'accounting_adjustment_record',lineKind:'reversal',impact:row.direction==='in'?'cash_in':'cash_out',title:'Reversal'};
  return{documentType:'accounting_adjustment_record',lineKind:'profile_adjustment',impact:row.direction==='out'?'cash_out':'cash_in',title:'Profile adjustment'};
}

function inverseImpact(impact){
  if(impact==='revenue')return'expense';
  if(impact==='expense')return'revenue';
  if(impact==='cash_in')return'cash_out';
  if(impact==='cash_out')return'cash_in';
  if(impact==='transfer_in')return'transfer_out';
  if(impact==='transfer_out')return'transfer_in';
  if(impact==='purchase')return'refund_in';
  if(impact==='refund_in')return'purchase';
  if(impact==='fee_expense')return'cash_in';
  if(impact==='tax_expense')return'cash_in';
  return'neutral';
}

async function upsertDocument(pool,input,lines=[],links=[]){
  const role=normalizeFinancialProfileRole(input.profileRole);
  const ownerScope=input.ownerScope==='business'?'business':'account';
  const businessId=ownerScope==='business'?numericId(input.businessId):null;
  const accountId=ownerScope==='account'?numericId(input.accountId):input.accountId==null?null:numericId(input.accountId);
  if(ownerScope==='business'&&!businessId)fail('Business financial document requires a business scope');
  if(ownerScope==='account'&&!accountId)fail('Account financial document requires an account scope');
  if(!TYPE_SET.has(input.documentType))fail('Unsupported financial document type');
  const key=clean(input.documentKey,260);
  if(!key)fail('Financial document key is required');
  const occurredAt=input.occurredAt instanceof Date?input.occurredAt.toISOString():String(input.occurredAt||new Date().toISOString());
  const publicId=stableId('fd',key);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ins=await client.query(`
      INSERT INTO financial_documents(
        public_id,document_key,owner_scope,account_id,profile_role,business_id,document_type,
        document_status,fiscal_status,source_type,source_id,currency_code,gross_amount,title,
        counterparty_label,source_snapshot,metadata_json,occurred_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::timestamptz)
      ON CONFLICT(document_key) DO NOTHING
      RETURNING *
    `,[
      publicId,key,ownerScope,accountId,role,businessId,input.documentType,
      clean(input.documentStatus||'active',20),clean(input.fiscalStatus||'internal_evidence',30),
      clean(input.sourceType,80),clean(input.sourceId,160),clean(input.currencyCode||'PHP',3).toUpperCase(),
      money(input.grossAmount),clean(input.title,220),clean(input.counterpartyLabel,220),
      JSON.stringify(input.sourceSnapshot||{}),JSON.stringify(input.metadata||{}),occurredAt
    ]);
    const doc=ins.rows[0]||(await client.query('SELECT * FROM financial_documents WHERE document_key=$1',[key])).rows[0];
    for(const line of lines){
      const impact=clean(line.impactClass||'neutral',30);
      if(!IMPACT_SET.has(impact))fail('Unsupported financial impact class');
      await client.query(`
        INSERT INTO financial_document_lines(
          document_id,line_code,line_kind,impact_class,economic_owner,amount,currency_code,note,metadata_json
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT(document_id,line_code) DO NOTHING
      `,[
        doc.id,clean(line.lineCode,120),clean(line.lineKind,80),impact,clean(line.economicOwner,160),
        money(line.amount),clean(line.currencyCode||input.currencyCode||'PHP',3).toUpperCase(),
        clean(line.note,500),JSON.stringify(line.metadata||{})
      ]);
    }
    const allLinks=[
      {sourceType:input.sourceType,sourceId:input.sourceId,sourceRelation:'primary'},
      ...(links||[])
    ];
    for(const link of allLinks){
      if(!clean(link.sourceType,80)||!clean(link.sourceId,160))continue;
      await client.query(`
        INSERT INTO financial_document_source_links(document_id,source_type,source_id,source_relation)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(document_id,source_type,source_id,source_relation) DO NOTHING
      `,[doc.id,clean(link.sourceType,80),clean(link.sourceId,160),clean(link.sourceRelation||'related',40)]);
    }
    await client.query('COMMIT');
    return doc;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}

function transactionSnapshot(row){
  return{
    id:Number(row.id),type:row.type,category:row.category,amount:money(row.amount),account:row.account,
    source:row.source||'',source_id:row.source_id==null?null:Number(row.source_id),note:row.note||'',
    occurred_at:row.occurred_at
  };
}

async function syncBusinessTransactions(pool,{profileRole,businessId}){
  const role=normalizeFinancialProfileRole(profileRole);
  if(!['merchant','supplier'].includes(role))return 0;
  const {rows}=await pool.query(`
    SELECT t.*,
      (SELECT ae.before_data FROM audit_events ae
       WHERE ae.business_id=t.business_id AND ae.entity_type='transaction' AND ae.entity_id=t.id AND ae.action='correction'
       ORDER BY ae.created_at,ae.id LIMIT 1) original_snapshot
    FROM transactions t
    WHERE t.business_id=$1
    ORDER BY t.occurred_at,t.id
  `,[Number(businessId)]);
  let count=0;
  for(const row of rows){
    const original=row.original_snapshot&&typeof row.original_snapshot==='object'?{...row,...row.original_snapshot}:row;
    const sem=transactionSemantic(original.type);
    await upsertDocument(pool,{
      documentKey:`business_transaction:${role}:${businessId}:${row.id}`,
      ownerScope:'business',profileRole:role,businessId:Number(businessId),
      documentType:sem.documentType,sourceType:'transaction',sourceId:String(row.id),
      currencyCode:'PHP',grossAmount:original.amount,title:sem.title,
      sourceSnapshot:transactionSnapshot(original),
      metadata:{category:original.category||'',account:original.account||'',source:original.source||''},
      occurredAt:original.occurred_at||row.occurred_at
    },[{
      lineCode:'primary',lineKind:sem.lineKind,impactClass:sem.impact,
      economicOwner:'profile',amount:original.amount,note:original.category||''
    }]);
    count++;
  }
  const audits=await pool.query(`
    SELECT * FROM audit_events
    WHERE business_id=$1 AND entity_type='transaction' AND action='correction'
    ORDER BY created_at,id
  `,[Number(businessId)]);
  for(const a of audits.rows){
    const before=a.before_data||{},after=a.after_data||{};
    const beforeSem=transactionSemantic(before.type),afterSem=transactionSemantic(after.type);
    await upsertDocument(pool,{
      documentKey:`business_transaction_correction:${role}:${businessId}:${a.id}`,
      ownerScope:'business',profileRole:role,businessId:Number(businessId),
      documentType:'accounting_adjustment_record',sourceType:'transaction_audit',sourceId:String(a.id),
      currencyCode:'PHP',grossAmount:Math.max(money(before.amount),money(after.amount)),
      title:'Transaction correction',sourceSnapshot:{before,after,reason:a.reason||''},
      metadata:{transaction_id:Number(a.entity_id),reason:a.reason||''},occurredAt:a.created_at
    },[
      {lineCode:'reverse_previous',lineKind:beforeSem.lineKind,impactClass:inverseImpact(beforeSem.impact),economicOwner:'profile',amount:before.amount||0,note:'Reverse previous transaction snapshot'},
      {lineCode:'apply_replacement',lineKind:afterSem.lineKind,impactClass:afterSem.impact,economicOwner:'profile',amount:after.amount||0,note:'Apply corrected transaction snapshot'}
    ],[{sourceType:'transaction',sourceId:String(a.entity_id),sourceRelation:'corrects'}]);
    count++;
  }
  return count;
}

async function syncProfileMoneyEntries(pool,{accountId,profileRole}){
  const role=normalizeFinancialProfileRole(profileRole);
  if(!['customer','courier','service_provider'].includes(role))return 0;
  const {rows}=await pool.query(`
    SELECT * FROM profile_money_entries
    WHERE account_id=$1 AND profile_role=$2
    ORDER BY occurred_at,id
  `,[Number(accountId),role]);
  for(const row of rows){
    const sem=profileEntrySemantic(row);
    await upsertDocument(pool,{
      documentKey:`profile_money_entry:${row.id}`,ownerScope:'account',accountId:Number(accountId),
      profileRole:role,documentType:sem.documentType,documentStatus:'active',
      sourceType:'profile_money_entry',sourceId:String(row.id),currencyCode:row.currency_code||'PHP',
      grossAmount:row.amount,title:sem.title,sourceSnapshot:{
        id:Number(row.id),entry_type:row.entry_type,direction:row.direction,category:row.category,
        amount:money(row.amount),source_type:row.source_type,source_id:row.source_id,note:row.note||'',
        reversal_of_id:row.reversal_of_id,occurred_at:row.occurred_at
      },metadata:{category:row.category||'',financial_account_id:row.financial_account_id},occurredAt:row.occurred_at
    },[{
      lineCode:'primary',lineKind:sem.lineKind,impactClass:sem.impact,economicOwner:'profile',
      amount:row.amount,note:row.category||''
    }],row.reversal_of_id?[{sourceType:'profile_money_entry',sourceId:String(row.reversal_of_id),sourceRelation:'reverses'}]:[]);
  }
  return rows.length;
}

async function syncCustomerPayments(pool,{accountId}){
  const intents=await pool.query(`
    SELECT i.*,b.name business_name
    FROM payment_intents i
    LEFT JOIN businesses b ON b.id=i.business_id
    WHERE i.payer_account_id=$1 AND i.status IN ('succeeded','partially_refunded','refunded')
    ORDER BY COALESCE(i.succeeded_at,i.created_at),i.id
  `,[Number(accountId)]);
  let count=0;
  for(const i of intents.rows){
    const alloc=await pool.query('SELECT * FROM payment_allocations WHERE payment_intent_id=$1 AND settlement_status<>\'reversed\' ORDER BY id',[i.id]);
    const base=alloc.rows.filter(a=>['merchandise','delivery'].includes(a.component_code));
    const lines=[];
    if(base.length){
      for(const a of base){
        lines.push({
          lineCode:`allocation_${a.id}`,
          lineKind:a.component_code==='delivery'?'delivery_value':'purchase_value',
          impactClass:'purchase',economicOwner:a.economic_party_type||'',
          amount:a.amount,currencyCode:a.currency_code||i.currency_code,
          note:a.component_code==='delivery'?'Delivery amount':'Commercial purchase amount',
          metadata:{allocation_id:Number(a.id),settlement_status:a.settlement_status}
        });
      }
    }else{
      lines.push({lineCode:'payment_amount',lineKind:'purchase_value',impactClass:'purchase',economicOwner:'merchant/provider',amount:i.amount});
    }
    for(const a of alloc.rows.filter(a=>!['merchandise','delivery'].includes(a.component_code))){
      const impact=a.component_code==='tax'?'neutral':'neutral';
      lines.push({
        lineCode:`allocation_context_${a.id}`,lineKind:a.component_code,impactClass:impact,
        economicOwner:a.economic_party_type||'',amount:a.amount,
        note:'Separate payment allocation; not automatically a Customer surcharge.',
        metadata:{allocation_id:Number(a.id),settlement_status:a.settlement_status,rule_snapshot:a.rule_snapshot||{}}
      });
    }
    await upsertDocument(pool,{
      documentKey:`customer_payment_intent:${i.id}`,ownerScope:'account',accountId:Number(accountId),
      profileRole:'customer',documentType:'payment_receipt',sourceType:'payment_intent',sourceId:String(i.id),
      currencyCode:i.currency_code||'PHP',grossAmount:i.amount,title:'Payment receipt',
      counterpartyLabel:i.business_name||'',sourceSnapshot:{
        id:Number(i.id),public_id:i.public_id,source_type:i.source_type,source_id:Number(i.source_id),
        provider_code:i.provider_code||'',logical_method:i.logical_method,status:i.status,amount:money(i.amount),
        succeeded_at:i.succeeded_at
      },metadata:{business_id:i.business_id==null?null:Number(i.business_id)},occurredAt:i.succeeded_at||i.created_at
    },lines,[{sourceType:i.source_type,sourceId:String(i.source_id),sourceRelation:'commercial_source'}]);
    count++;
  }
  const refunds=await pool.query(`
    SELECT r.*,i.payer_account_id,i.business_id,i.source_type,i.source_id
    FROM refunds r JOIN payment_intents i ON i.id=r.payment_intent_id
    WHERE i.payer_account_id=$1 AND r.status='succeeded'
    ORDER BY COALESCE(r.processed_at,r.created_at),r.id
  `,[Number(accountId)]);
  for(const r of refunds.rows){
    await upsertDocument(pool,{
      documentKey:`customer_refund:${r.id}`,ownerScope:'account',accountId:Number(accountId),
      profileRole:'customer',documentType:'refund_credit',sourceType:'refund',sourceId:String(r.id),
      currencyCode:r.currency_code||'PHP',grossAmount:r.amount,title:'Refund credit',
      sourceSnapshot:{id:Number(r.id),public_id:r.public_id,payment_intent_id:Number(r.payment_intent_id),amount:money(r.amount),reason:r.reason||'',processed_at:r.processed_at,status:r.status},
      metadata:{business_id:r.business_id==null?null:Number(r.business_id)},occurredAt:r.processed_at||r.created_at
    },[{lineCode:'refund',lineKind:'refund',impactClass:'refund_in',economicOwner:'customer',amount:r.amount,note:r.reason||''}],
    [{sourceType:'payment_intent',sourceId:String(r.payment_intent_id),sourceRelation:'refunds'}]);
    count++;
  }
  return count;
}

async function syncBusinessFees(pool,{accountId,profileRole,businessId}){
  const role=normalizeFinancialProfileRole(profileRole);
  if(!['merchant','supplier'].includes(role))return 0;
  const chargedTo=role==='merchant'?'merchant_deduction':'supplier_deduction';
  const args=role==='merchant'?[Number(businessId)]:[Number(accountId)];
  const ownerJoin=role==='merchant'
    ?''
    :" JOIN purchase_orders po ON i.source_type='purchase_order' AND po.id=i.source_id";
  const ownerWhere=role==='merchant'?'i.business_id=$1':'po.supplier_account_id=$1';
  const {rows}=await pool.query(`
    SELECT a.*,i.source_type,i.source_id,i.succeeded_at,i.created_at intent_created_at,
      r.charged_to,r.beneficiary_type
    FROM payment_allocations a
    JOIN payment_intents i ON i.id=a.payment_intent_id
    ${ownerJoin}
    LEFT JOIN fee_policy_rules r
      ON r.fee_policy_version_id=a.fee_policy_version_id
     AND r.component_code=a.component_code
    WHERE ${ownerWhere}
      AND i.status IN ('succeeded','partially_refunded','refunded')
      AND a.settlement_status<>'reversed'
      AND a.component_code IN ('processor_fee','platform_fee','country_operator_fee','territory_operator_fee','tax','withholding')
    ORDER BY a.created_at,a.id
  `,args);
  for(const a of rows){
    const type=a.component_code==='processor_fee'?'processor_fee_record'
      :a.component_code==='platform_fee'?'platform_fee_record'
      :a.component_code==='tax'||a.component_code==='withholding'?'tax_record'
      :'generic_financial_evidence';
    const explicitlyCharged=a.charged_to===chargedTo;
    const impact=explicitlyCharged
      ?(a.component_code==='tax'||a.component_code==='withholding'?'tax_expense':'fee_expense')
      :'neutral';
    await upsertDocument(pool,{
      documentKey:`business_payment_allocation:${role}:${businessId}:${a.id}`,
      ownerScope:'business',profileRole:role,businessId:Number(businessId),documentType:type,
      sourceType:'payment_allocation',sourceId:String(a.id),currencyCode:a.currency_code||'PHP',
      grossAmount:a.amount,title:a.component_code.replaceAll('_',' '),sourceSnapshot:{
        id:Number(a.id),payment_intent_id:Number(a.payment_intent_id),component_code:a.component_code,
        economic_party_type:a.economic_party_type,economic_party_id:a.economic_party_id,
        gross_base:money(a.gross_base),amount:money(a.amount),settlement_status:a.settlement_status,
        rule_snapshot:a.rule_snapshot||{},charged_to:a.charged_to||''
      },metadata:{
        fee_policy_version_id:a.fee_policy_version_id,
        charged_to:a.charged_to||'',
        participant_expense:explicitlyCharged,
        note:explicitlyCharged
          ?'This allocation is explicitly charged to this profile by fee policy.'
          :'Visible as separate fee context; not counted as this profile expense.'
      },occurredAt:a.created_at||a.succeeded_at||a.intent_created_at
    },[{lineCode:'fee',lineKind:a.component_code,impactClass:impact,economicOwner:a.economic_party_type||'',amount:a.amount,
      note:explicitlyCharged?'Explicit participant deduction':'Separate provider/platform cost context',
      metadata:{settlement_status:a.settlement_status,charged_to:a.charged_to||'',rule_snapshot:a.rule_snapshot||{}}}],
    [{sourceType:'payment_intent',sourceId:String(a.payment_intent_id),sourceRelation:'allocated_from'}]);
  }
  return rows.length;
}

async function syncProviderCommercialSources(pool,{accountId,profileRole}){
  const role=normalizeFinancialProfileRole(profileRole);
  let count=0;
  if(role==='service_provider'){
    const jobs=await pool.query(`
      SELECT * FROM service_jobs
      WHERE provider_account_id=$1 AND status='completed' AND customer_confirmed_at IS NOT NULL
      ORDER BY customer_confirmed_at,id
    `,[Number(accountId)]);
    for(const j of jobs.rows){
      const value=money(j.final_price??j.quote_amount??0);
      await upsertDocument(pool,{
        documentKey:`service_job_completed:${j.id}`,ownerScope:'account',accountId:Number(accountId),
        profileRole:'service_provider',documentType:'service_invoice_candidate',sourceType:'service_job',sourceId:String(j.id),
        currencyCode:j.currency_code||'PHP',grossAmount:value,title:'Completed service',
        sourceSnapshot:{id:Number(j.id),service_label:j.service_label,status:j.status,quote_amount:j.quote_amount,final_price:j.final_price,customer_confirmed_at:j.customer_confirmed_at},
        metadata:{fiscal_note:'Internal service evidence; fiscal invoice status is determined separately.'},occurredAt:j.customer_confirmed_at
      },[{lineCode:'service_value',lineKind:'service_value',impactClass:'revenue',economicOwner:'service_provider',amount:value}]);
      count++;
    }
  }
  if(role==='courier'){
    const ds=await pool.query(`
      SELECT * FROM deliveries
      WHERE courier_account_id=$1 AND status='delivered'
      ORDER BY COALESCE(delivered_at,created_at),id
    `,[Number(accountId)]);
    for(const d of ds.rows){
      await upsertDocument(pool,{
        documentKey:`courier_delivery_context:${d.id}`,ownerScope:'account',accountId:Number(accountId),
        profileRole:'courier',documentType:'delivery_settlement_record',sourceType:'delivery',sourceId:String(d.id),
        currencyCode:d.currency_code||'PHP',grossAmount:d.delivery_fee||0,title:'Completed delivery',
        sourceSnapshot:{id:Number(d.id),order_id:Number(d.order_id),delivery_fee:money(d.delivery_fee),status:d.status,delivered_at:d.delivered_at},
        metadata:{earnings_note:'Delivery fee is commercial context; Courier earnings require courier_net allocation evidence.'},occurredAt:d.delivered_at||d.created_at
      },[{lineCode:'delivery_context',lineKind:'delivery_value_context',impactClass:'neutral',economicOwner:'delivery_service',amount:d.delivery_fee||0}]);
      count++;
    }
  }
  const component=role==='courier'?'courier_net':role==='service_provider'?'service_provider_net':'';
  if(component){
    const allocations=await pool.query(`
      SELECT a.*,i.source_type,i.source_id,i.succeeded_at,i.created_at intent_created_at
      FROM payment_allocations a JOIN payment_intents i ON i.id=a.payment_intent_id
      WHERE a.component_code=$1 AND a.economic_party_id=$2 AND a.settlement_status<>'reversed'
      ORDER BY a.created_at,a.id
    `,[component,String(accountId)]);
    for(const a of allocations.rows){
      await upsertDocument(pool,{
        documentKey:`profile_net_allocation:${a.id}`,ownerScope:'account',accountId:Number(accountId),profileRole:role,
        documentType:role==='courier'?'delivery_settlement_record':'payment_receipt',
        sourceType:'payment_allocation',sourceId:String(a.id),currencyCode:a.currency_code||'PHP',
        grossAmount:a.amount,title:role==='courier'?'Courier earnings allocation':'Service payment allocation',
        sourceSnapshot:{id:Number(a.id),payment_intent_id:Number(a.payment_intent_id),component_code:a.component_code,amount:money(a.amount),settlement_status:a.settlement_status},
        metadata:{gross_base:money(a.gross_base)},occurredAt:a.created_at||a.succeeded_at||a.intent_created_at
      },[{lineCode:'net_allocation',lineKind:'settlement_income',impactClass:'cash_in',economicOwner:role,amount:a.amount,
        metadata:{settlement_status:a.settlement_status}}],
      [{sourceType:'payment_intent',sourceId:String(a.payment_intent_id),sourceRelation:'allocated_from'}]);
      count++;
    }
  }
  return count;
}

async function syncSubscriptionInvoices(pool,{accountId,profileRole,businessId}){
  const role=normalizeFinancialProfileRole(profileRole);
  const serviceScope=role==='merchant'?'marketplace':role==='supplier'?'supplier':role==='service_provider'?'local_services':'';
  if(!serviceScope)return 0;
  const args=[serviceScope];
  let clause='';
  if(role==='merchant'){
    clause=' AND e.subject_type=\'business\' AND e.subject_id=$2';
    args.push(Number(businessId));
  }else{
    clause=' AND e.subject_type=\'account\' AND e.subject_id=$2';
    args.push(Number(accountId));
  }
  const {rows}=await pool.query(`
    SELECT i.*,e.service_scope,e.subject_type,e.subject_id
    FROM profile_subscription_invoices i
    JOIN service_monetization_entitlements e ON e.id=i.entitlement_id
    WHERE e.service_scope=$1 ${clause}
    ORDER BY i.billing_period_start,i.id
  `,args);
  for(const i of rows){
    const paid=i.status==='paid';
    await upsertDocument(pool,{
      documentKey:`subscription_invoice:${i.id}`,
      ownerScope:role==='merchant'?'business':'account',accountId:role==='merchant'?null:Number(accountId),
      profileRole:role,businessId:role==='merchant'?Number(businessId):null,
      documentType:'subscription_invoice',documentStatus:i.status==='void'?'void':'active',
      sourceType:'profile_subscription_invoice',sourceId:String(i.id),currencyCode:i.currency_code||'PHP',
      grossAmount:i.amount,title:'Business & Life subscription invoice',
      sourceSnapshot:{id:Number(i.id),public_id:i.public_id,status:i.status,amount:money(i.amount),billing_period_start:i.billing_period_start,billing_period_end:i.billing_period_end,due_at:i.due_at,paid_at:i.paid_at},
      metadata:{policy_version_id:Number(i.policy_version_id),entitlement_id:Number(i.entitlement_id)},occurredAt:i.created_at
    },[{lineCode:'subscription',lineKind:'business_life_subscription',impactClass:paid?'fee_expense':'neutral',economicOwner:'business_life',amount:i.amount,
      note:paid?'Paid subscription expense':'Invoice issued; not treated as paid until payment evidence confirms it.'}]);
  }
  return rows.length;
}

export async function synchronizeFinancialDocumentsForScope(pool,{accountId,profileRole,businessId=null}){
  const role=normalizeFinancialProfileRole(profileRole);
  let synchronized=0;
  if(['merchant','supplier'].includes(role)){
    if(!numericId(businessId))fail('Business scope is required');
    synchronized+=await syncBusinessTransactions(pool,{profileRole:role,businessId:Number(businessId)});
    synchronized+=await syncBusinessFees(pool,{accountId:Number(accountId),profileRole:role,businessId:Number(businessId)});
    synchronized+=await syncSubscriptionInvoices(pool,{accountId,profileRole:role,businessId:Number(businessId)});
  }else{
    synchronized+=await syncProfileMoneyEntries(pool,{accountId:Number(accountId),profileRole:role});
    if(role==='customer')synchronized+=await syncCustomerPayments(pool,{accountId:Number(accountId)});
    if(['courier','service_provider'].includes(role))synchronized+=await syncProviderCommercialSources(pool,{accountId:Number(accountId),profileRole:role});
    synchronized+=await syncSubscriptionInvoices(pool,{accountId:Number(accountId),profileRole:role,businessId:null});
  }
  return{synchronized};
}

function scopeWhere({accountId,profileRole,businessId},offset=1){
  const role=normalizeFinancialProfileRole(profileRole);
  if(['merchant','supplier'].includes(role)){
    return{role,sql:`d.profile_role=$${offset} AND d.owner_scope='business' AND d.business_id=$${offset+1}`,params:[role,Number(businessId)]};
  }
  return{role,sql:`d.profile_role=$${offset} AND d.owner_scope='account' AND d.account_id=$${offset+1}`,params:[role,Number(accountId)]};
}

export async function listFinancialDocuments(pool,{accountId,profileRole,businessId=null,fromDate=null,toDate=null,limit=200}){
  const scope=scopeWhere({accountId,profileRole,businessId},1);
  const params=[...scope.params];
  let clause=scope.sql;
  if(fromDate){params.push(String(fromDate));clause+=` AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date >= $${params.length}::date`;}
  if(toDate){params.push(String(toDate));clause+=` AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date < $${params.length}::date`;}
  params.push(Math.min(500,Math.max(1,Number(limit)||200)));
  const {rows}=await pool.query(`
    SELECT d.*,
      COALESCE((SELECT jsonb_agg(l ORDER BY l.id) FROM financial_document_lines l WHERE l.document_id=d.id),'[]'::jsonb) lines,
      COALESCE((SELECT jsonb_agg(s ORDER BY s.id) FROM financial_document_source_links s WHERE s.document_id=d.id),'[]'::jsonb) source_links
    FROM financial_documents d
    WHERE ${clause}
    ORDER BY d.occurred_at DESC,d.id DESC
    LIMIT $${params.length}
  `,params);
  return rows;
}

export async function financialStatementForScope(pool,{accountId,profileRole,businessId=null,period='month',anchor}){
  const range=financialPeriodRange(period,anchor);
  await synchronizeFinancialDocumentsForScope(pool,{accountId,profileRole,businessId});
  const scope=scopeWhere({accountId,profileRole,businessId},1);
  const params=[...scope.params,range.start_date,range.end_date_exclusive];
  const startParam=params.length-1,endParam=params.length;
  const totals=await pool.query(`
    SELECT l.impact_class,COUNT(*)::int line_count,COALESCE(SUM(l.amount),0) amount
    FROM financial_documents d
    JOIN financial_document_lines l ON l.document_id=d.id
    WHERE ${scope.sql}
      AND d.document_status='active'
      AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date >= $${startParam}::date
      AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date < $${endParam}::date
    GROUP BY l.impact_class
    ORDER BY l.impact_class
  `,params);
  const docCount=await pool.query(`
    SELECT COUNT(*)::int count
    FROM financial_documents d
    WHERE ${scope.sql}
      AND d.document_status='active'
      AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date >= $${startParam}::date
      AND (d.occurred_at AT TIME ZONE 'Asia/Manila')::date < $${endParam}::date
  `,params);
  const byImpact={};
  for(const row of totals.rows)byImpact[row.impact_class]={amount:money(row.amount),line_count:Number(row.line_count)};
  for(const key of FINANCIAL_IMPACT_CLASSES)if(!byImpact[key])byImpact[key]={amount:0,line_count:0};
  const revenue=byImpact.revenue.amount;
  const expenses=money(byImpact.expense.amount+byImpact.fee_expense.amount+byImpact.tax_expense.amount);
  return{
    scope:{
      profile_role:scope.role,
      owner_scope:['merchant','supplier'].includes(scope.role)?'business':'account',
      account_id:['merchant','supplier'].includes(scope.role)?null:Number(accountId),
      business_id:['merchant','supplier'].includes(scope.role)?Number(businessId):null
    },
    period:range,
    currency_code:'PHP',
    document_count:Number(docCount.rows[0]?.count||0),
    totals:byImpact,
    derived:{
      operating_result:money(revenue-expenses),
      documented_purchases:byImpact.purchase.amount,
      documented_refunds:byImpact.refund_in.amount,
      transfers_net:money(byImpact.transfer_in.amount-byImpact.transfer_out.amount),
      cash_movement_context:money(byImpact.cash_in.amount+byImpact.refund_in.amount-byImpact.cash_out.amount-byImpact.purchase.amount)
    },
    authority:{
      source_ledgers_remain_authoritative:true,
      statements_are_derived:true,
      fiscal_document_status:'Internal document/evidence status does not by itself establish BIR-valid fiscal issuance.'
    }
  };
}
