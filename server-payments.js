import {startupWaitAttempts} from './startup-wait.js';
import express from 'express';
import pg from 'pg';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensurePaymentSchema,backfillLegacyOrderPayments,createOrderPaymentIntent,paymentIntentDetail,
  createFeePolicy,addFeeRule,feePolicyOverview,createRefundRequest,createReconciliationRun,
  paymentFinanceOverview,mirrorConfirmedOrderPayment
} from './payment-core.js';
import {
  ensureFinanceSchema,createPlatformCostEntry,allocatePlatformCost,voidPlatformCostEntry,
  listPlatformCostEntries,financeKpiOverview,pricingScenario,commissionSustainabilityScenario,FINANCE_EVIDENCE_CLASSES
} from './finance-core.js';
import { requireAdminPermission,appendAdminAudit } from './admin-authorization.js';
import { ensureMonetizationSchema,backfillMonetizationHistory } from './monetization-core.js';
import {ensureProfileSubscriptionSchema,createSubscriptionPolicyDraft,listSubscriptionPolicies,subscriptionBillingReadiness,SUBSCRIPTION_SERVICE_SCOPES,SUBSCRIPTION_SCOPE_LABELS} from './profile-subscription-core.js';
import {
  ensureProfileFinanceSchema,listProfileFinancialAccounts,listMoneyPreferences,
  createProfileFinancialAccount,updateProfileFinancialAccount,upsertMoneyPreference,
  listProfileBudgetEnvelopes,createProfileBudgetEnvelope,postProfileBudgetEntry,transferProfileBudgetAllocation,
  listProfileMoneyMovements,createProfileMoneyMovementRequest,
  listProfileMoneyEntries,createProfileMoneyEntry,reverseProfileMoneyEntry,profileMoneyEntryCapabilities,
  listProfileFundScopes,listProfileFundTransfers,transferFundsBetweenProfiles,
  isBusinessFinanceRole,PROFILE_FINANCE_ROLES,FINANCIAL_ACCOUNT_KINDS,MONEY_METHODS,PAYOUT_SCHEDULES,
  BUDGET_PURPOSES,MONEY_MOVEMENT_TYPES
} from './profile-finance-core.js';
import {profileMoneySnapshot} from './profile-money-core.js';
import {allocateSharedCompanyCost50x50,PROFILE_MONETIZATION_MODEL,DIGITAL_PAYMENT_INCENTIVE_DEFAULT,monetizationPolicyDraft,OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT,OWNER_APPROVED_MONTHLY_SUBSCRIPTION_PHP,OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,OWNER_APPROVED_DELIVERY_PROMO_DAYS} from './monetization-policy-v2.js';
import {PAYMONGO_PH_BENCHMARK_AS_OF,PAYMONGO_PH_PAYMENT_BENCHMARKS,digitalPaymentIncentiveScenario,compareDigitalPaymentRails} from './digital-payment-incentive-core.js';
import {
  ensureAccountMoneySchema,accountMoneySettings,updateAccountMoneyIdentity,
  createAccountFinancialDestination,updateAccountFinancialDestination,setDefaultAccountPayoutDestination
} from './account-money-core.js';
import {
  ensureFinancialDocumentSchema,synchronizeFinancialDocumentsForScope,listFinancialDocuments,
  getFinancialDocumentByPublicId,financialStatementForScope,FINANCIAL_IMPACT_CLASSES,
  normalizeFinancialProfileRole
} from './financial-document-core.js';

const {Pool}=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const upstreamPort=Number(process.env.INTERNAL_LEGAL_PORT||4507);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const body=express.json({limit:'30mb'});
let child;let shuttingDown=false;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||crypto.randomUUID(),120);
async function upstream(path,options={}){return fetch('http://127.0.0.1:'+upstreamPort+path,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
async function forwardJson(req,res,after){
  const r=await upstream(req.originalUrl,{method:req.method,headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body??{})});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
  if(r.ok&&after)Promise.resolve().then(()=>after(data)).catch(e=>console.error('Payment mirror hook:',e.message));
  res.status(r.status);const ct=r.headers.get('content-type');if(ct)res.type(ct);res.send(text);
}
function financeEvidence(req){
  const raw=clean(req.query?.evidence||'',200);
  if(!raw)return undefined;
  const values=[...new Set(raw.split(',').map(x=>clean(x,30)).filter(x=>FINANCE_EVIDENCE_CLASSES.includes(x)))];
  return values.length?values:undefined;
}
function financeTerritory(value){
  if(value==null||value==='')return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<=0)throw Object.assign(new Error('territory_id must be a positive integer'),{status:400});
  return n;
}
async function canSeeIntent(me,intent){
  if(Number(intent.payer_account_id)===Number(me.account.id))return true;
  if((me.businesses||[]).some(b=>Number(b.id)===Number(intent.business_id)&&b.active!==false))return true;
  try{await requireAdminPermission(pool,me.account.id,'payment.view',intent.territory_id);return true}catch{return false}
}
async function initDb(){await ensurePaymentSchema(pool);await ensureFinanceSchema(pool);await ensureMonetizationSchema(pool);await ensureProfileSubscriptionSchema(pool);await ensureProfileFinanceSchema(pool);await ensureAccountMoneySchema(pool);await ensureFinancialDocumentSchema(pool);await backfillLegacyOrderPayments(pool);await backfillMonetizationHistory(pool)}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const childAlive=Boolean(child&&!child.killed&&child.exitCode==null);res.status(childAlive?200:503).json({ok:childAlive,db:true,legal:childAlive,payments:true,version:'0.13-payment-core'})}catch{res.status(503).json({ok:false,db:false,legal:false,payments:false,version:'0.13-payment-core'})}});
app.get('/payments.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','payments.css'),'utf8')));
app.get('/payments-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','payments-ui.js'),'utf8')));
app.get('/profile-settings.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','profile-settings.css'),'utf8')));
app.get('/profile-settings-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','profile-settings-ui.js'),'utf8')));
app.get('/profile-money.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','profile-money.css'),'utf8')));
app.get('/profile-money-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','profile-money-ui.js'),'utf8')));
app.get('/pricing-transparency.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','pricing-transparency.css'),'utf8')));
app.get('/pricing-transparency.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','pricing-transparency.js'),'utf8')));
app.get('/financial-documents.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','financial-documents.css'),'utf8')));
app.get('/financial-documents-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','financial-documents-ui.js'),'utf8')));
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:'127.0.0.1:'+upstreamPort}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/mobile-feature-loader.css" />\n  <link rel="stylesheet" href="/profile-settings.css" />\n  <link rel="stylesheet" href="/profile-money.css" />\n  <link rel="stylesheet" href="/pricing-transparency.css" />\n  <link rel="stylesheet" href="/financial-documents.css" />\n</head>').replace('</body>','  <script type="module" src="/mobile-feature-loader.js"></script>\n  <script type="module" src="/profile-settings-ui.js"></script>\n  <script type="module" src="/profile-money-ui.js"></script>\n  <script type="module" src="/pricing-transparency.js"></script>\n  <script type="module" src="/financial-documents-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root);

app.get('/api/public/pricing',(_req,res)=>{
  const role=(key,promoDays=90)=>({
    promo_days:promoDays,
    business_life_transaction_rate_during_promo_pct:0,
    post_promo_transaction_rate_pct:OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT,
    monthly_subscription_amount:OWNER_APPROVED_MONTHLY_SUBSCRIPTION_PHP,
    monthly_subscription_status:'OWNER_APPROVED_LIVE_BILLING_GATED'
  });
  res.set('Cache-Control','public, max-age=300').json({
    version:'2026-09-19-owner-approved-v1',
    status:'OWNER_APPROVED_TARGET_LIVE_COLLECTION_GATED',
    country_code:'PH',
    currency_code:'PHP',
    principle:{
      headline:`Low, transparent platform fee — ${OWNER_APPROVED_PLATFORM_TRANSACTION_RATE_PCT.toFixed(2)}%.`,
      message:'Business & Life is designed to be sustainable, not extractive.',
      fee_separation:'Business & Life, payment processor, delivery and applicable tax/statutory costs are disclosed separately.'
    },
    profiles:{
      customer:{promo_days:0,customer_free:true,business_life_platform_fee_pct:0,monthly_subscription_amount:0},
      merchant:role('merchant'),
      supplier:role('supplier'),
      local_services:role('local_services'),
      courier:{
        promo_days:OWNER_APPROVED_DELIVERY_PROMO_DAYS,
        monthly_subscription_amount:0,
        business_life_delivery_production_rate_during_promo_pct:0,
        post_promo_delivery_production_rate_pct:OWNER_APPROVED_DELIVERY_PRODUCTION_RATE_PCT,
        fee_basis:'verified_delivery_price'
      }
    },
    payment_processor:{
      provider:'PayMongo',
      benchmark_as_of:PAYMONGO_PH_BENCHMARK_AS_OF,
      pricing_exclusive_of_vat:true,
      actual_provider_evidence_overrides_benchmark:true,
      rails:Object.values(PAYMONGO_PH_PAYMENT_BENCHMARKS).map(({code,label,variable_rate_pct,fixed_fee_php,published_fee_excludes_vat,source,note})=>({code,label,variable_rate_pct,fixed_fee_php,published_fee_excludes_vat,source,note}))
    },
    promotion_disclosure:'Business & Life promotion waives applicable Business & Life charges only. Third-party payment-processing charges may still apply.',
    live_collection:false
  });
});

function rejectSensitiveFinancialFields(value){
  const blocked=/account_number|routing|iban|card_number|pan|cvv|cvc|password|pin|secret|private_key/i;
  for(const key of Object.keys(value||{}))if(blocked.test(key))throw Object.assign(new Error('Do not store raw bank/card credentials in Business & Life settings. Use a provider destination reference and last four characters only.'),{status:400});
}
function enabledProfile(me,role){return Boolean((me.profiles||[]).find(p=>p.role===role&&p.enabled&&p.status==='active'))}
function authorizedBusiness(me,businessId){
  const id=Number(businessId);
  return Number.isInteger(id)&&(me.businesses||[]).some(b=>Number(b.id)===id&&b.active!==false);
}
function financeScope(me,role,businessId){
  if(!PROFILE_FINANCE_ROLES.includes(role))throw Object.assign(new Error('Unsupported profile role'),{status:400});
  if(!enabledProfile(me,role))throw Object.assign(new Error('Enable this profile before configuring its financial settings'),{status:403});
  if(isBusinessFinanceRole(role)){
    if(!authorizedBusiness(me,businessId))throw Object.assign(new Error('Choose a business workspace that this account is allowed to manage'),{status:403});
    return{owner_scope:'business',business_id:Number(businessId)};
  }
  return{owner_scope:'account',business_id:null};
}
async function financialDocumentScope(me,rawRole,rawBusinessId){
  const role=normalizeFinancialProfileRole(rawRole);
  if(!enabledProfile(me,role))throw Object.assign(new Error('Enable this profile before opening its financial documents'),{status:403});
  if(['merchant','supplier'].includes(role)){
    const businessId=Number(rawBusinessId);
    if(!Number.isInteger(businessId)||businessId<=0)throw Object.assign(new Error('Choose the active business workspace for this profile'),{status:400});
    const q=await pool.query(`
      SELECT 1
      FROM profile_business_bindings pb
      JOIN business_memberships bm
        ON bm.business_id=pb.business_id
       AND bm.account_id=pb.account_id
       AND bm.active=TRUE
      WHERE pb.account_id=$1
        AND pb.role=$2
        AND pb.business_id=$3
        AND pb.status='active'
      LIMIT 1
    `,[Number(me.account.id),role,businessId]);
    if(!q.rowCount)throw Object.assign(new Error('This business workspace is not bound to the selected financial profile'),{status:403});
    return{role,business_id:businessId};
  }
  return{role,business_id:null};
}
function emptyImpactTotals(){
  return Object.fromEntries(FINANCIAL_IMPACT_CLASSES.map(k=>[k,{amount:0,line_count:0}]));
}
function combineStatements(statements){
  const totals=emptyImpactTotals();
  let documentCount=0;
  for(const item of statements){
    documentCount+=Number(item.statement?.document_count||0);
    for(const key of FINANCIAL_IMPACT_CLASSES){
      totals[key].amount=Math.round((totals[key].amount+Number(item.statement?.totals?.[key]?.amount||0)+Number.EPSILON)*100)/100;
      totals[key].line_count+=Number(item.statement?.totals?.[key]?.line_count||0);
    }
  }
  const expenses=Math.round((totals.expense.amount+totals.fee_expense.amount+totals.tax_expense.amount+Number.EPSILON)*100)/100;
  return{
    document_count:documentCount,
    totals,
    derived:{
      operating_result:Math.round((totals.revenue.amount-expenses+Number.EPSILON)*100)/100,
      documented_purchases:totals.purchase.amount,
      documented_refunds:totals.refund_in.amount,
      transfers_net:Math.round((totals.transfer_in.amount-totals.transfer_out.amount+Number.EPSILON)*100)/100,
      cash_movement_context:Math.round((totals.cash_in.amount+totals.refund_in.amount-totals.cash_out.amount-totals.purchase.amount+Number.EPSILON)*100)/100
    }
  };
}
async function financialAccountOwnedForScope(accountId,id,role,businessId,purpose){
  if(id==null||id==='')return null;
  const q=await pool.query(
    `SELECT * FROM profile_financial_accounts
     WHERE id=$1 AND account_id=$2 AND profile_role=$3 AND status='active'
       AND COALESCE(business_id,0)=COALESCE($4::bigint,0)`,
    [Number(id),Number(accountId),role,businessId==null?null:Number(businessId)]
  );
  if(!q.rowCount)throw Object.assign(new Error('Selected financial account is outside this profile/business scope'),{status:403});
  const row=q.rows[0];
  if(purpose==='receive'&&!row.can_receive)throw Object.assign(new Error('Selected account is not enabled to receive money'),{status:409});
  if(purpose==='pay'&&!row.can_pay)throw Object.assign(new Error('Selected account is not enabled for payments'),{status:409});
  if(purpose==='payout'&&!row.can_payout)throw Object.assign(new Error('Selected account is not enabled as a payout destination'),{status:409});
  return Number(row.id);
}

app.get('/api/financial-documents',async(req,res,next)=>{try{
  const me=await identity(req);
  const scope=await financialDocumentScope(me,req.query?.profile_role,req.query?.business_id);
  await synchronizeFinancialDocumentsForScope(pool,{
    accountId:me.account.id,profileRole:scope.role,businessId:scope.business_id
  });
  const rows=await listFinancialDocuments(pool,{
    accountId:me.account.id,profileRole:scope.role,businessId:scope.business_id,
    fromDate:req.query?.from||null,toDate:req.query?.to||null,limit:req.query?.limit||200
  });
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json({
    profile_role:scope.role,business_id:scope.business_id,currency_code:'PHP',
    fiscal_boundary:'Documents are internal financial evidence unless a separate fiscal status says otherwise.',
    documents:rows
  });
}catch(e){next(e)}});

app.get('/api/financial-documents/:publicId',async(req,res,next)=>{try{
  const me=await identity(req);
  const scope=await financialDocumentScope(me,req.query?.profile_role,req.query?.business_id);
  await synchronizeFinancialDocumentsForScope(pool,{
    accountId:me.account.id,profileRole:scope.role,businessId:scope.business_id
  });
  const row=await getFinancialDocumentByPublicId(pool,{
    accountId:me.account.id,profileRole:scope.role,businessId:scope.business_id,publicId:req.params.publicId
  });
  if(!row)return res.status(404).json({error:'Financial document not found in this profile/business scope'});
  res.json(row);
}catch(e){next(e)}});

app.get('/api/financial-statements/consolidated/:period',async(req,res,next)=>{try{
  const me=await identity(req),period=clean(req.params.period,20),anchor=clean(req.query?.anchor,10)||undefined;
  const items=[];
  for(const role of ['customer','courier','service_provider']){
    if(!enabledProfile(me,role))continue;
    const statement=await financialStatementForScope(pool,{accountId:me.account.id,profileRole:role,period,anchor});
    items.push({scope_key:'account:'+role,label:role,profile_roles:[role],statement});
  }
  const bindings=await pool.query(`
    SELECT pb.role,pb.business_id,b.name business_name,b.currency_code
    FROM profile_business_bindings pb
    JOIN business_memberships bm ON bm.business_id=pb.business_id AND bm.account_id=pb.account_id AND bm.active=TRUE
    JOIN businesses b ON b.id=pb.business_id
    WHERE pb.account_id=$1 AND pb.status='active' AND pb.role IN ('merchant','supplier')
    ORDER BY pb.business_id,pb.is_primary DESC,pb.role
  `,[Number(me.account.id)]);
  const byBusiness=new Map();
  for(const row of bindings.rows){
    const id=Number(row.business_id);
    if(!byBusiness.has(id))byBusiness.set(id,{business_id:id,business_name:row.business_name||('Business '+id),roles:[]});
    const x=byBusiness.get(id);if(!x.roles.includes(row.role))x.roles.push(row.role);
  }
  for(const x of byBusiness.values()){
    const role=x.roles.includes('merchant')?'merchant':x.roles[0];
    const statement=await financialStatementForScope(pool,{
      accountId:me.account.id,profileRole:role,businessId:x.business_id,period,anchor
    });
    items.push({
      scope_key:'business:'+x.business_id,label:x.business_name,profile_roles:x.roles,
      shared_business_scope:x.roles.length>1,statement
    });
  }
  const combined=combineStatements(items);
  res.json({
    period:items[0]?.statement?.period||null,currency_code:'PHP',
    scopes:items,consolidated:combined,
    consolidation_rule:'Shared business workspaces are counted once even when the same account uses both Merchant and Supplier roles.',
    authority:{
      source_ledgers_remain_authoritative:true,
      no_cross_account_or_cross_business_data:true,
      fiscal_document_status:'Internal financial evidence is not automatically a statutory tax invoice.'
    }
  });
}catch(e){next(e)}});

app.get('/api/financial-statements/:period',async(req,res,next)=>{try{
  const me=await identity(req);
  const scope=await financialDocumentScope(me,req.query?.profile_role,req.query?.business_id);
  const statement=await financialStatementForScope(pool,{
    accountId:me.account.id,profileRole:scope.role,businessId:scope.business_id,
    period:req.params.period,anchor:req.query?.anchor||undefined
  });
  res.json(statement);
}catch(e){next(e)}});

app.get('/api/profile-money/:role',async(req,res,next)=>{try{
  const me=await identity(req),role=clean(req.params.role,40);
  if(!['customer','courier','service_provider'].includes(role))return res.status(400).json({error:'This profile uses business accounting or does not have a personal Money workspace'});
  if(!enabledProfile(me,role))return res.status(403).json({error:'Enable this profile before opening its Money workspace'});
  const [snapshot,accounts,preferences,budgets,profileLedger,accountMoney]=await Promise.all([
    profileMoneySnapshot(pool,role,me.account.id),
    listProfileFinancialAccounts(pool,me.account.id),
    listMoneyPreferences(pool,me.account.id),
    listProfileBudgetEnvelopes(pool,me.account.id),
    listProfileMoneyEntries(pool,{accountId:me.account.id,profileRole:role}),
    accountMoneySettings(pool,{accountId:me.account.id,legalName:me.account.display_name||''})
  ]);
  const profileAccounts=accounts.filter(a=>a.profile_role===role&&a.owner_scope==='account');
  const preference=preferences.find(p=>p.profile_role===role&&p.business_id==null)||null;
  const profileBudgets=budgets.filter(b=>b.profile_role===role&&b.business_id==null);
  res.json({...snapshot,financial_accounts:profileAccounts,legacy_profile_financial_accounts:profileAccounts,money_preference:preference,budgets:profileBudgets,profile_ledger:profileLedger,account_money:accountMoney});
}catch(e){next(e)}});

app.post('/api/profile-money/:role/entries',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req),role=clean(req.params.role,40);
  if(!['customer','courier','service_provider'].includes(role))return res.status(400).json({error:'This profile does not use the personal/profile Money ledger'});
  if(!enabledProfile(me,role))return res.status(403).json({error:'Enable this profile before recording Money entries'});
  profileMoneyEntryCapabilities(role);
  const key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const row=await createProfileMoneyEntry(pool,{
    publicId:'pme_'+crypto.randomUUID().replaceAll('-',''),entryKey:key,accountId:me.account.id,profileRole:role,
    entryType:req.body?.entry_type,direction:req.body?.direction,category:req.body?.category,
    amount:req.body?.amount,currencyCode:req.body?.currency_code||'PHP',
    financialAccountId:req.body?.financial_account_id||null,sourceType:req.body?.source_type||'manual',
    sourceId:req.body?.source_id||null,note:req.body?.note||'',evidenceReference:req.body?.evidence_reference||'',
    occurredAt:req.body?.occurred_at||null,actorAccountId:me.account.id
  });
  await synchronizeFinancialDocumentsForScope(pool,{accountId:me.account.id,profileRole:role});
  res.status(201).json({...row,provider_balance_effect:false});
}catch(e){next(e)}});

app.post('/api/profile-money/:role/entries/:id/reverse',body,async(req,res,next)=>{try{
  const me=await identity(req),role=clean(req.params.role,40);
  if(!['customer','courier','service_provider'].includes(role))return res.status(400).json({error:'This profile does not use the personal/profile Money ledger'});
  if(!enabledProfile(me,role))return res.status(403).json({error:'Enable this profile before correcting Money entries'});
  const key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const row=await reverseProfileMoneyEntry(pool,{
    publicId:'pme_rev_'+crypto.randomUUID().replaceAll('-',''),reversalKey:key,accountId:me.account.id,
    profileRole:role,entryId:Number(req.params.id),note:req.body?.note||'',actorAccountId:me.account.id
  });
  await synchronizeFinancialDocumentsForScope(pool,{accountId:me.account.id,profileRole:role});
  res.json({...row,provider_balance_effect:false});
}catch(e){next(e)}});

app.get('/api/settings/finance',async(req,res,next)=>{try{
  const me=await identity(req);
  const [accounts,preferences,budgets,movements,fundScopes,fundTransfers,accountMoney,providers]=await Promise.all([
    listProfileFinancialAccounts(pool,me.account.id),
    listMoneyPreferences(pool,me.account.id),
    listProfileBudgetEnvelopes(pool,me.account.id),
    listProfileMoneyMovements(pool,me.account.id),
    listProfileFundScopes(pool,me.account.id),
    listProfileFundTransfers(pool,me.account.id),
    accountMoneySettings(pool,{accountId:me.account.id,legalName:me.account.display_name||''}),
    pool.query("SELECT provider_code,display_name,adapter_version,status,supported_methods,ledger_account FROM payment_provider_configs WHERE country_code='PH' ORDER BY provider_code")
  ]);
  const defaultProvider=clean(process.env.PAYMENT_PROVIDER_DEFAULT,80);
  const selected=providers.rows.find(x=>x.provider_code===defaultProvider&&['sandbox','active'].includes(x.status))||null;
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json({
    account:{id:Number(me.account.id),display_name:me.account.display_name,email:me.account.email||'',phone:me.account.phone||'',address:me.account.address||'',avatar_data_url:me.account.avatar_data_url||''},
    active_role:me.account.active_role,
    profiles:(me.profiles||[]).map(p=>({role:p.role,profile_id:p.profile_id||null,enabled:Boolean(p.enabled),status:p.status,visibility:p.visibility})),
    businesses:(me.businesses||[]).map(b=>({id:Number(b.id),name:b.name,active:b.active!==false})),
    financial_accounts:accounts,legacy_profile_financial_accounts:accounts,preferences,budgets,money_movements:movements,profile_fund_scopes:fundScopes,profile_fund_transfers:fundTransfers,account_money:accountMoney,
    catalog:{roles:PROFILE_FINANCE_ROLES,account_kinds:FINANCIAL_ACCOUNT_KINDS,methods:MONEY_METHODS,payout_schedules:PAYOUT_SCHEDULES,budget_purposes:BUDGET_PURPOSES,movement_types:MONEY_MOVEMENT_TYPES},
    provider:{
      default_provider:defaultProvider,provider_ready:Boolean(selected),selected_provider:selected,
      payout_execution_ready:false,
      payout_execution_code:'PROVIDER_DISBURSEMENT_ADAPTER_NOT_CONNECTED',
      note:'Financial destinations can be configured now. Real withdrawals/transfers remain disabled until a verified money-movement adapter confirms execution.'
    }
  });
}catch(e){next(e)}});

app.put('/api/settings/account-money/identity',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req);
  const result=await updateAccountMoneyIdentity(pool,{
    accountId:me.account.id,identityKind:req.body?.identity_kind,legalName:req.body?.legal_name
  });
  res.json(result);
}catch(e){next(e)}});

app.post('/api/settings/account-money/destinations',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req);
  const row=await createAccountFinancialDestination(pool,{
    publicId:'afd_'+crypto.randomUUID().replaceAll('-',''),accountId:me.account.id,
    destinationKind:req.body?.destination_kind,displayName:req.body?.display_name,
    institutionName:req.body?.institution_name,accountName:req.body?.account_name,
    referenceLast4:req.body?.reference_last4,currencyCode:req.body?.currency_code||'PHP',
    canReceive:req.body?.can_receive!==false,canPayout:req.body?.can_payout!==false
  });
  res.status(201).json(row);
}catch(e){next(e)}});

app.patch('/api/settings/account-money/destinations/:id',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req);
  const row=await updateAccountFinancialDestination(pool,{
    accountId:me.account.id,id:Number(req.params.id),displayName:req.body?.display_name,
    institutionName:req.body?.institution_name,accountName:req.body?.account_name,
    referenceLast4:req.body?.reference_last4,canReceive:req.body?.can_receive,
    canPayout:req.body?.can_payout,status:req.body?.status
  });
  res.json(row);
}catch(e){next(e)}});

app.post('/api/settings/account-money/destinations/:id/default-payout',body,async(req,res,next)=>{try{
  const me=await identity(req);
  res.json(await setDefaultAccountPayoutDestination(pool,{accountId:me.account.id,id:Number(req.params.id)}));
}catch(e){next(e)}});

app.post('/api/settings/financial-accounts',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req),role=clean(req.body?.profile_role,40),scope=financeScope(me,role,req.body?.business_id);
  const row=await createProfileFinancialAccount(pool,{
    publicId:'fa_'+crypto.randomUUID().replaceAll('-',''),
    accountId:me.account.id,profileRole:role,ownerScope:scope.owner_scope,businessId:scope.business_id,
    accountKind:req.body?.account_kind,providerCode:req.body?.provider_code,
    providerDestinationRef:req.body?.provider_destination_ref,displayName:req.body?.display_name,
    institutionName:req.body?.institution_name,accountName:req.body?.account_name,
    referenceLast4:req.body?.reference_last4,currencyCode:req.body?.currency_code||'PHP',
    canPay:req.body?.can_pay,canReceive:req.body?.can_receive,canPayout:req.body?.can_payout
  });
  res.status(201).json(row);
}catch(e){next(e)}});

app.patch('/api/settings/financial-accounts/:id',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req);
  const row=await updateProfileFinancialAccount(pool,{
    accountId:me.account.id,id:Number(req.params.id),displayName:req.body?.display_name,
    institutionName:req.body?.institution_name,accountName:req.body?.account_name,
    referenceLast4:req.body?.reference_last4,providerCode:req.body?.provider_code,
    providerDestinationRef:req.body?.provider_destination_ref,canPay:req.body?.can_pay,
    canReceive:req.body?.can_receive,canPayout:req.body?.can_payout,status:req.body?.status
  });
  res.json(row);
}catch(e){next(e)}});

app.put('/api/settings/money-preferences/:role',body,async(req,res,next)=>{try{
  const me=await identity(req),role=clean(req.params.role,40),scope=financeScope(me,role,req.body?.business_id);
  const receive=await financialAccountOwnedForScope(me.account.id,req.body?.default_receive_account_id,role,scope.business_id,'receive');
  const spend=await financialAccountOwnedForScope(me.account.id,req.body?.default_spend_account_id,role,scope.business_id,'pay');
  const payout=await financialAccountOwnedForScope(me.account.id,req.body?.default_payout_account_id,role,scope.business_id,'payout');
  const pref=await upsertMoneyPreference(pool,{
    accountId:me.account.id,profileRole:role,businessId:scope.business_id,
    defaultReceiveAccountId:receive,defaultSpendAccountId:spend,defaultPayoutAccountId:payout,
    acceptedMethods:req.body?.accepted_methods,payoutSchedulePreference:req.body?.payout_schedule_preference
  });
  res.json(pref);
}catch(e){next(e)}});

app.post('/api/settings/budgets',body,async(req,res,next)=>{try{
  const me=await identity(req),role=clean(req.body?.profile_role,40),scope=financeScope(me,role,req.body?.business_id);
  const row=await createProfileBudgetEnvelope(pool,{
    publicId:'budget_'+crypto.randomUUID().replaceAll('-',''),
    accountId:me.account.id,profileRole:role,businessId:scope.business_id,
    linkedFinancialAccountId:req.body?.linked_financial_account_id||null,
    label:req.body?.label,purpose:req.body?.purpose||'custom',currencyCode:req.body?.currency_code||'PHP'
  });
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/settings/budgets/:id/entries',body,async(req,res,next)=>{try{
  const me=await identity(req),key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const direction=req.body?.direction==='debit'?'debit':'credit';
  const entryType=clean(req.body?.entry_type||(direction==='credit'?'allocation':'release'),40);
  const row=await postProfileBudgetEntry(pool,{
    accountId:me.account.id,envelopeId:Number(req.params.id),entryKey:key,
    direction,entryType,amount:req.body?.amount,sourceType:'manual_plan',
    sourceId:req.body?.source_id||'',note:req.body?.note||'',actorAccountId:me.account.id
  });
  res.status(201).json({...row,balance_type:'planned_allocation',provider_money_moved:false});
}catch(e){next(e)}});

app.post('/api/settings/budget-transfers',body,async(req,res,next)=>{try{
  const me=await identity(req),key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const row=await transferProfileBudgetAllocation(pool,{
    publicId:'btx_'+crypto.randomUUID().replaceAll('-',''),transferKey:key,accountId:me.account.id,
    sourceEnvelopeId:req.body?.source_envelope_id,destinationEnvelopeId:req.body?.destination_envelope_id,
    amount:req.body?.amount,actorAccountId:me.account.id,note:req.body?.note||''
  });
  res.status(201).json(row);
}catch(e){next(e)}});

app.get('/api/settings/money-movements',async(req,res,next)=>{try{
  const me=await identity(req);
  res.json(await listProfileMoneyMovements(pool,me.account.id));
}catch(e){next(e)}});

app.post('/api/settings/money-movements',body,async(req,res,next)=>{try{
  rejectSensitiveFinancialFields(req.body);
  const me=await identity(req),key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const row=await createProfileMoneyMovementRequest(pool,{
    publicId:'move_'+crypto.randomUUID().replaceAll('-',''),idempotencyKey:key,accountId:me.account.id,
    movementType:req.body?.movement_type,sourceFinancialAccountId:req.body?.source_financial_account_id,
    destinationFinancialAccountId:req.body?.destination_financial_account_id,
    amount:req.body?.amount,currencyCode:req.body?.currency_code||'PHP',
    providerCode:req.body?.provider_code||'',note:req.body?.note||''
  });
  res.status(202).json({
    ...row,
    provider_money_moved:false,
    execution_status:'HOLD',
    next_action:'CONNECT_VERIFIED_MONEY_MOVEMENT_ADAPTER'
  });
}catch(e){next(e)}});

app.post('/api/settings/profile-fund-transfers',body,async(req,res,next)=>{try{
  const me=await identity(req),key=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const row=await transferFundsBetweenProfiles(pool,{
    publicId:'pft_'+crypto.randomUUID().replaceAll('-',''),transferKey:key,accountId:me.account.id,
    sourceProfileRole:req.body?.source_profile_role,sourceBusinessId:req.body?.source_business_id||null,
    destinationProfileRole:req.body?.destination_profile_role,destinationBusinessId:req.body?.destination_business_id||null,
    amount:req.body?.amount,currencyCode:req.body?.currency_code||'PHP',note:req.body?.note||''
  });
  res.status(201).json({...row,platform_fee:0,provider_money_moved:false});
}catch(e){next(e)}});

app.get('/api/settings/profile-fund-transfers',async(req,res,next)=>{try{
  const me=await identity(req);
  res.json({scopes:await listProfileFundScopes(pool,me.account.id),transfers:await listProfileFundTransfers(pool,me.account.id)});
}catch(e){next(e)}});

app.get('/api/payments/config',async(req,res,next)=>{try{
  await identity(req);
  const q=await pool.query("SELECT provider_code,display_name,adapter_version,status,supported_methods,ledger_account FROM payment_provider_configs WHERE country_code='PH' ORDER BY provider_code");
  const defaultProvider=clean(process.env.PAYMENT_PROVIDER_DEFAULT,80);
  const selected=q.rows.find(x=>x.provider_code===defaultProvider&&['sandbox','active'].includes(x.status))||null;
  res.json({country_code:'PH',currency_code:'PHP',default_provider:defaultProvider,provider_ready:Boolean(selected),selected_provider:selected,providers:q.rows,authority:'server_webhook_only'});
}catch(e){next(e)}});

app.get('/api/payments/open-orders',async(req,res,next)=>{try{
  const me=await identity(req);
  const q=await pool.query("SELECT o.id,o.order_number,o.business_id,b.name business_name,o.total,o.paid_amount,o.outstanding_amount,o.payment_method,o.payment_status,o.order_status,o.currency_code,o.created_at FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.customer_account_id=$1 AND o.payment_method='online' AND o.outstanding_amount>0 AND o.order_status<>'cancelled' ORDER BY o.created_at DESC LIMIT 100",[me.account.id]);
  res.json(q.rows);
}catch(e){next(e)}});

app.post('/api/payments/intents/order/:id',body,async(req,res,next)=>{try{
  const me=await identity(req);
  const idempotency=clean(req.headers['idempotency-key']||req.body?.idempotency_key,220);
  const provider=clean(req.body?.provider_code||process.env.PAYMENT_PROVIDER_DEFAULT,80);
  const intent=await createOrderPaymentIntent(pool,{orderId:Number(req.params.id),payerAccountId:Number(me.account.id),idempotencyKey:idempotency,logicalMethod:req.body?.logical_method||'online_other',providerCode:provider,clientReference:req.body?.client_reference||''});
  res.status(201).json({...intent,provider_ready:intent.status!=='requires_provider',next_action:intent.status==='requires_provider'?'CONNECT_REAL_PAYMENT_PROVIDER':'PROVIDER_ADAPTER_REQUIRED'});
}catch(e){next(e)}});

app.get('/api/payments/intents/:id',async(req,res,next)=>{try{
  const me=await identity(req),intent=await paymentIntentDetail(pool,req.params.id);
  if(!intent)return res.status(404).json({error:'Payment intent not found'});
  if(!await canSeeIntent(me,intent))return res.status(403).json({error:'Payment intent is outside your authorized scope'});
  res.json(intent);
}catch(e){next(e)}});

app.get('/api/payments/mine',async(req,res,next)=>{try{
  const me=await identity(req);
  const q=await pool.query("SELECT id,public_id,source_type,source_id,provider_code,logical_method,currency_code,amount,status,provider_status,created_at,updated_at FROM payment_intents WHERE payer_account_id=$1 ORDER BY created_at DESC LIMIT 150",[me.account.id]);
  res.json(q.rows);
}catch(e){next(e)}});

app.post('/api/payments/webhooks/:provider',body,async(req,res)=>res.status(501).json({
  error:'No verified payment-provider adapter is installed for this provider',
  code:'PAYMENT_PROVIDER_ADAPTER_REQUIRED',
  provider:clean(req.params.provider,80),
  note:'Client success pages are never payment authority. A signed provider webhook adapter must be implemented first.'
}));

app.get('/api/payments/admin/overview',async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'payment.view');
  res.json(await paymentFinanceOverview(pool));
}catch(e){next(e)}});

app.get('/api/payments/admin/unit-economics',async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.query?.territory_id);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',territoryId);
  const data=await financeKpiOverview(pool,{
    from:req.query?.from,to:req.query?.to,territoryId,
    evidenceClasses:financeEvidence(req)
  });
  res.json(data);
}catch(e){next(e)}});

app.get('/api/payments/admin/subscriptions/readiness',async(req,res,next)=>{try{
  const me=await identity(req);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',null);
  const [readiness,policies]=await Promise.all([
    subscriptionBillingReadiness(pool),
    listSubscriptionPolicies(pool)
  ]);
  res.json({
    ...readiness,
    policies,
    service_scopes:SUBSCRIPTION_SERVICE_SCOPES,
    scope_labels:SUBSCRIPTION_SCOPE_LABELS
  });
}catch(e){next(e)}});

app.post('/api/payments/admin/subscriptions/policies/drafts',body,async(req,res,next)=>{try{
  const me=await identity(req);
  const assignment=await requireAdminPermission(pool,me.account.id,'fee_policy.manage_limited',null);
  const policy=await createSubscriptionPolicyDraft(pool,{
    serviceScope:req.body?.service_scope,
    policyCode:req.body?.policy_code,
    monthlyAmount:req.body?.monthly_amount,
    description:req.body?.description,
    createdByAccountId:me.account.id
  });
  await appendAdminAudit(pool,{
    actorAccountId:me.account.id,assignmentId:assignment.id,permission:'fee_policy.manage_limited',
    targetType:'subscription_policy',targetId:String(policy.id),
    eventCode:'subscription_policy_draft_created',
    after:{
      public_id:policy.public_id,policy_code:policy.policy_code,version:policy.version,
      service_scope:policy.service_scope,monthly_amount:policy.monthly_amount,status:policy.status
    },
    reason:req.body?.reason||'Subscription policy draft',correlationId:correlation(req)
  });
  res.status(201).json(policy);
}catch(e){next(e)}});

app.get('/api/payments/admin/digital-payment-incentive/benchmarks',async(req,res,next)=>{try{
  const me=await identity(req);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',null);
  res.json({
    benchmark_as_of:PAYMONGO_PH_BENCHMARK_AS_OF,
    pricing_exclusive_of_vat:true,
    rails:PAYMONGO_PH_PAYMENT_BENCHMARKS,
    source:'https://www.paymongo.com/en/pricing',
    qrph_source:'https://docs.paymongo.com/docs/payment-acceptance-qr-ph',
    activation:'NOT_PERFORMED'
  });
}catch(e){next(e)}});

app.post('/api/payments/admin/digital-payment-incentive/scenario',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',territoryId);
  const input={
    commercialAmount:req.body?.commercial_amount,
    railCode:req.body?.rail_code,
    cashHandlingCostPct:req.body?.cash_handling_cost_pct,
    cashHandlingFixedCost:req.body?.cash_handling_fixed_cost,
    providerFeeTaxPct:req.body?.provider_fee_tax_pct,
    returnSavingsPct:req.body?.return_savings_pct,
    creditCap:req.body?.credit_cap,
    growthBudgetRemaining:req.body?.growth_budget_remaining
  };
  const selected=digitalPaymentIncentiveScenario(input);
  const comparison=compareDigitalPaymentRails(input);
  await appendAdminAudit(pool,{
    actorAccountId:me.account.id,permission:'finance.summary.view',territoryId,
    targetType:'digital_payment_incentive_scenario',targetId:'simulation',
    eventCode:'digital_payment_incentive_scenario_run',
    after:{
      rail_code:selected.provider_cost.rail_code,
      commercial_amount:selected.provider_cost.commercial_amount,
      modeled_cash_total_cost:selected.cash_cost_model.modeled_cash_total_cost,
      modeled_total_processor_cost:selected.provider_cost.modeled_total_processor_cost,
      supported_credit:selected.incentive.supported_credit,
      state:selected.state
    },
    reason:'Read-only digital payment incentive simulation',correlationId:correlation(req)
  });
  res.json({selected,comparison,territory_id:territoryId});
}catch(e){next(e)}});

app.get('/api/payments/admin/monetization-v2/model',async(req,res,next)=>{try{
  const me=await identity(req);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',null);
  res.json({
    profile_models:PROFILE_MONETIZATION_MODEL,
    digital_payment_incentive:DIGITAL_PAYMENT_INCENTIVE_DEFAULT,
    shared_cost_policy:{
      equal_weight_pct:50,
      activity_weight_pct:50,
      zero_activity_fallback:'EQUAL_SPLIT_ACTIVITY_HALF',
      supported_driver_examples:['verified_traffic_units','active_members','completed_economic_events','gross_eligible_service_value']
    },
    draft_examples:{
      customer:monetizationPolicyDraft('customer'),
      merchant:monetizationPolicyDraft('merchant'),
      supplier:monetizationPolicyDraft('supplier'),
      local_services:monetizationPolicyDraft('local_services'),
      courier:monetizationPolicyDraft('courier')
    }
  });
}catch(e){next(e)}});

app.post('/api/payments/admin/shared-cost-allocation-scenario',body,async(req,res,next)=>{try{
  const me=await identity(req);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',null);
  const result=allocateSharedCompanyCost50x50(req.body?.total_amount,req.body?.scopes||[],{
    driverCode:clean(req.body?.driver_code||'verified_traffic_units',80),
    equalWeightPct:50,
    driverWeightPct:50
  });
  await appendAdminAudit(pool,{
    actorAccountId:me.account.id,permission:'finance.summary.view',
    targetType:'shared_cost_scenario',targetId:'simulation',eventCode:'shared_cost_50_50_scenario_run',
    after:{total_amount:result.total_amount,driver_code:result.driver_code,scope_count:result.rows.length,zero_activity_fallback:result.zero_activity_fallback},
    reason:'Read-only shared company cost allocation simulation',correlationId:correlation(req)
  });
  res.json({...result,simulation_only:true,applies_live_allocation:false});
}catch(e){next(e)}});

app.post('/api/payments/admin/commission-planner',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',territoryId);
  const scenario=commissionSustainabilityScenario({
    completedEventsPerMonth:req.body?.completed_events_per_month,
    averageFeeBaseValue:req.body?.average_fee_base_value,
    feeEligibleSharePct:req.body?.fee_eligible_share_pct,
    onlinePaymentSharePct:req.body?.online_payment_share_pct,
    processorRatePct:req.body?.processor_rate_pct,
    processorFixedPerOnlineEvent:req.body?.processor_fixed_per_online_event,
    riskAllowancePct:req.body?.risk_allowance_pct,
    safetyReservePct:req.body?.safety_reserve_pct,
    growthSurplusPct:req.body?.growth_surplus_pct,
    paidProfiles:req.body?.paid_profiles||{},
    subscriptionAmounts:req.body?.subscription_amounts||{},
    deliveryEligiblePrice:req.body?.delivery_eligible_price??req.body?.delivery_eligible_earnings,
    deliveryProductionRatePct:req.body?.delivery_production_rate_pct,
    platformAbsorbsProcessorFees:req.body?.platform_absorbs_processor_fees!==false,
    platformAbsorbsRiskAllowance:req.body?.platform_absorbs_risk_allowance!==false,
    staffing:req.body?.staffing||{},
    monthlyCosts:req.body?.monthly_costs||{}
  });
  await appendAdminAudit(pool,{
    actorAccountId:me.account.id,permission:'finance.summary.view',territoryId,
    targetType:'commission_scenario',targetId:'simulation',eventCode:'commission_sustainability_scenario_run',
    after:{
      completed_events_per_month:scenario.assumptions.completed_events_per_month,
      fee_eligible_share_pct:scenario.assumptions.fee_eligible_share_pct,
      mature_sustainable_pct:scenario.rates.mature_100pct_fee_eligible.sustainable_pct,
      current_sustainable_pct:scenario.rates.current_rollout.sustainable_pct
    },
    reason:'Read-only commission sustainability simulation',correlationId:correlation(req)
  });
  res.json({...scenario,territory_id:territoryId});
}catch(e){next(e)}});

app.post('/api/payments/admin/pricing-scenario',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',territoryId);
  const scenario=await pricingScenario(pool,{
    from:req.body?.from,to:req.body?.to,territoryId,
    evidenceClasses:Array.isArray(req.body?.evidence_classes)?req.body.evidence_classes:undefined,
    rates:req.body?.rates||{}
  });
  res.json(scenario);
}catch(e){next(e)}});

app.get('/api/payments/admin/costs',async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.query?.territory_id);
  await requireAdminPermission(pool,me.account.id,'finance.summary.view',territoryId);
  res.json(await listPlatformCostEntries(pool,{
    from:req.query?.from,to:req.query?.to,territoryId,
    serviceScope:clean(req.query?.service_scope,80)||undefined,
    evidenceClasses:financeEvidence(req)
  }));
}catch(e){next(e)}});

app.post('/api/payments/admin/costs',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  const assignment=await requireAdminPermission(pool,me.account.id,'finance.cost.manage',territoryId);
  const row=await createPlatformCostEntry(pool,{
    sourceKey:req.headers['idempotency-key']||req.body?.source_key,
    costCode:req.body?.cost_code,costCategory:req.body?.cost_category,
    costNature:req.body?.cost_nature,evidenceClass:req.body?.evidence_class,
    serviceScope:req.body?.service_scope||'shared',territoryId,
    businessId:req.body?.business_id?Number(req.body.business_id):null,
    paymentIntentId:req.body?.payment_intent_id?Number(req.body.payment_intent_id):null,
    providerCode:req.body?.provider_code,currencyCode:req.body?.currency_code||'PHP',
    amount:req.body?.amount,incurredAt:req.body?.incurred_at,
    periodStart:req.body?.period_start,periodEnd:req.body?.period_end,
    evidenceReference:req.body?.evidence_reference,description:req.body?.description,
    metadata:req.body?.metadata,createdBy:me.account.id
  });
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'finance.cost.manage',territoryId:row.territory_id,targetType:'platform_cost_entry',targetId:String(row.id),eventCode:'platform_cost_recorded',after:{public_id:row.public_id,cost_code:row.cost_code,cost_category:row.cost_category,cost_nature:row.cost_nature,evidence_class:row.evidence_class,service_scope:row.service_scope,amount:row.amount,currency_code:row.currency_code},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/payments/admin/costs/:id/allocations',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  const assignment=await requireAdminPermission(pool,me.account.id,'finance.cost.manage',territoryId);
  const row=await allocatePlatformCost(pool,Number(req.params.id),{
    allocationKey:req.headers['idempotency-key']||req.body?.allocation_key,
    serviceScope:req.body?.service_scope||'shared',territoryId,
    businessId:req.body?.business_id?Number(req.body.business_id):null,
    paymentIntentId:req.body?.payment_intent_id?Number(req.body.payment_intent_id):null,
    allocationMethod:req.body?.allocation_method||'direct',driverCode:req.body?.driver_code,
    amount:req.body?.amount,policyVersionId:req.body?.policy_version_id?Number(req.body.policy_version_id):null,
    createdBy:me.account.id
  });
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'finance.cost.manage',territoryId:row.territory_id,targetType:'platform_cost_allocation',targetId:String(row.id),eventCode:'platform_cost_allocated',after:{cost_entry_id:row.cost_entry_id,service_scope:row.service_scope,allocation_method:row.allocation_method,amount:row.amount},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/payments/admin/costs/:id/void',body,async(req,res,next)=>{try{
  const me=await identity(req),territoryId=financeTerritory(req.body?.territory_id);
  const assignment=await requireAdminPermission(pool,me.account.id,'finance.cost.manage',territoryId);
  const row=await voidPlatformCostEntry(pool,Number(req.params.id),{voidedBy:me.account.id,reason:req.body?.reason||''});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'finance.cost.manage',territoryId:row.territory_id,targetType:'platform_cost_entry',targetId:String(row.id),eventCode:'platform_cost_voided',before:{status:'active'},after:{status:'void'},reason:row.void_reason,correlationId:correlation(req)});
  res.json(row);
}catch(e){next(e)}});

app.get('/api/payments/admin/fee-policies',async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'payment.view');
  res.json(await feePolicyOverview(pool));
}catch(e){next(e)}});

app.post('/api/payments/admin/providers',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
  const code=clean(req.body?.provider_code,80),name=clean(req.body?.display_name,160);
  if(!code||!name)return res.status(400).json({error:'Provider code and display name are required'});
  const methods=Array.isArray(req.body?.supported_methods)?req.body.supported_methods.map(x=>clean(x,50)).filter(Boolean).slice(0,20):[];
  const account=['gcash','bank','other'].includes(req.body?.ledger_account)?req.body.ledger_account:'other';
  const q=await pool.query("INSERT INTO payment_provider_configs(provider_code,display_name,adapter_version,status,country_code,supported_methods,ledger_account,config_metadata) VALUES($1,$2,'adapter_required','disabled','PH',$3::jsonb,$4,$5::jsonb) ON CONFLICT(provider_code) DO UPDATE SET display_name=EXCLUDED.display_name,supported_methods=EXCLUDED.supported_methods,ledger_account=EXCLUDED.ledger_account,updated_at=NOW() RETURNING id,provider_code,display_name,adapter_version,status,supported_methods,ledger_account",[
    code,name,JSON.stringify(methods),account,JSON.stringify({note:'Credentials must live in Railway/provider secret storage, never this table'})
  ]);
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',targetType:'payment_provider_config',targetId:String(q.rows[0].id),eventCode:'payment_provider_metadata_registered',after:q.rows[0],reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(q.rows[0]);
}catch(e){next(e)}});

app.post('/api/payments/admin/fee-policies',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'fee_policy.manage_limited');
  const policy=await createFeePolicy(pool,{policyCode:req.body?.policy_code,version:req.body?.version,serviceScope:req.body?.service_scope||'marketplace',territoryId:req.body?.territory_id?Number(req.body.territory_id):null,businessId:req.body?.business_id?Number(req.body.business_id):null,description:req.body?.description||'',createdBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'fee_policy.manage_limited',territoryId:policy.territory_id,targetType:'fee_policy',targetId:String(policy.id),eventCode:'fee_policy_draft_created',after:{policy_code:policy.policy_code,version:policy.version,status:policy.status},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(policy);
}catch(e){next(e)}});

app.post('/api/payments/admin/fee-policies/:id/rules',body,async(req,res,next)=>{try{
  const me=await identity(req);await requireAdminPermission(pool,me.account.id,'fee_policy.manage_limited');
  const p=await pool.query("SELECT * FROM fee_policy_versions WHERE id=$1",[Number(req.params.id)]);
  if(!p.rowCount)return res.status(404).json({error:'Fee policy not found'});
  if(p.rows[0].status!=='draft')return res.status(409).json({error:'Only draft fee policies can be edited'});
  const rule=await addFeeRule(pool,Number(req.params.id),req.body||{});res.status(201).json(rule);
}catch(e){next(e)}});

app.post('/api/payments/admin/refunds',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.manage');
  const row=await createRefundRequest(pool,{intentId:req.body?.payment_intent_id||req.body?.payment_intent,amount:req.body?.amount,reason:req.body?.reason||'',requestedBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.manage',targetType:'refund',targetId:String(row.id),eventCode:'refund_requested_provider_action_required',after:{amount:row.amount,status:row.status},reason:row.reason,correlationId:correlation(req)});
  res.status(201).json({...row,next_action:'PROVIDER_REFUND_ADAPTER_REQUIRED'});
}catch(e){next(e)}});

app.post('/api/payments/admin/reconciliation',body,async(req,res,next)=>{try{
  const me=await identity(req),assignment=await requireAdminPermission(pool,me.account.id,'payment.reconcile');
  const row=await createReconciliationRun(pool,{providerCode:req.body?.provider_code,periodStart:req.body?.period_start,periodEnd:req.body?.period_end,statement:req.body?.statement_text||'',startedBy:me.account.id});
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'payment.reconcile',targetType:'reconciliation_run',targetId:String(row.id),eventCode:'reconciliation_run_created',after:{provider_code:row.provider_code,status:row.status,internal_payment_total:row.internal_payment_total},reason:req.body?.reason||'',correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/orders/merchant/:id/payment',body,(req,res)=>forwardJson(req,res,async()=>{
  const q=await pool.query("SELECT id FROM order_payments WHERE order_id=$1 AND status='confirmed' ORDER BY id DESC LIMIT 1",[Number(req.params.id)]);
  if(q.rowCount)await mirrorConfirmedOrderPayment(pool,Number(q.rows[0].id));
}));

function proxy(req,res){
  const rawPayload=Buffer.isBuffer(req.rawBody)&&req.rawBody.length?req.rawBody:null;
  const parsedJsonBody=!rawPayload&&req.body!==undefined&&!['GET','HEAD'].includes(req.method)&&Boolean(req.is('application/json'));
  const payload=rawPayload||(parsedJsonBody?Buffer.from(JSON.stringify(req.body??{})):null);
  const headers={...req.headers,host:'127.0.0.1:'+upstreamPort};
  if(payload){
    headers['content-length']=String(payload.length);
    delete headers['transfer-encoding'];
  }
  const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{
    res.statusCode=ur.statusCode||502;
    for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);
    ur.pipe(res);
  });
  up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Payment upstream unavailable'})});
  if(payload)up.end(payload);else req.pipe(up);
}
app.use(proxy);
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected payment-core error'})});

function start(){child=spawn(process.execPath,['server-legal.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error('Legal child exited '+code);process.exit(code||1)}})}
async function wait(){for(let i=0;i<startupWaitAttempts(380);i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Legal child failed health check')}

let embeddedStartPromise=null;
export async function startEmbeddedPaymentCore(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      start();
      await wait();
      await initDb();
      console.log('Business & Life payment core mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopCore(){
  if(shuttingDown)return;
  shuttingDown=true;
  if(child&&!child.killed)child.kill('SIGTERM');
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedPaymentCore(){await stopCore()}

async function shutdown(sig){console.log('Received '+sig);await stopCore();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log('Business & Life payment core gateway listening on '+port))).catch(e=>{console.error(e);process.exit(1)});
}
