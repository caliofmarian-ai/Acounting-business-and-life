import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {profileMoneyEntryCapabilities} from '../profile-finance-core.js';
import {financialStatementForScope,synchronizeFinancialDocumentsForScope} from '../financial-document-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const finance=read('profile-finance-core.js');
const docs=read('financial-document-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-money-ui.js');

test('Customer personal entries retain role-specific categories and reversal audit',()=>{
  const cap=profileMoneyEntryCapabilities('customer');
  assert.deepEqual(cap.entry_types,['money_in','expense','adjustment']);
  assert.deepEqual(cap.source_types,['manual']);
  for(const category of ['income','remittance','household','groceries','housing','transport','health','education','family','personal','other','adjustment'])assert.ok(cap.categories.includes(category),category);
  assert.match(finance,/profile_money_entry_reversed/);
  assert.doesNotMatch(finance,/DELETE FROM profile_money_entries/);
});

test('Customer spending classifies services and keeps provider allocation context neutral',()=>{
  assert.match(docs,/i\.source_type==='service_job'\?'service_value':'purchase_value'/);
  assert.match(docs,/source_snapshot->>'source_type'='service_job'/);
  assert.match(docs,/lineCode:'refund',lineKind:'refund',impactClass:'refund_in'/);
  assert.doesNotMatch(docs,/INSERT INTO (?:transactions|profile_money_entries)/);
});

for(const profileRole of ['customer','merchant'])test(profileRole+' statement passes date values as SQL bind parameters in all three aggregate queries',async()=>{
  const queries=[];
  const pool={query:async(sql,args=[])=>{
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/,'empty-source statement must only read');
    if(sql.includes('FROM financial_documents d')){
      queries.push({sql,args});
      assert.match(sql,/>= \$3::date/);
      assert.match(sql,/< \$4::date/);
      assert.doesNotMatch(sql,/(?:>=|<) [34]::date/);
      assert.deepEqual(args,[profileRole,profileRole==='customer'?91:17,'2026-09-01','2026-10-01']);
      if(sql.includes('WITH classified'))return{rows:[{line_kind:'service_value',impact_class:'purchase',amount:'120.00',line_count:1}]};
      if(sql.includes('SELECT COUNT(*)::int count'))return{rows:[{count:1}]};
      return{rows:[{impact_class:'purchase',amount:'120.00',line_count:1}]};
    }
    return{rows:[]};
  }};
  const result=await financialStatementForScope(pool,{accountId:91,profileRole,businessId:profileRole==='merchant'?17:null,period:'month',anchor:'2026-09-26'});
  assert.equal(queries.length,3);
  assert.equal(result.line_kinds[0].amount,120);
  assert.equal(result.totals.purchase.amount,120);
  assert.equal(result.scope.profile_role,profileRole);
  assert.equal(result.authority.source_ledgers_remain_authoritative,true);
});

function renderStatement(lineKinds){
  const start=ui.indexOf('function customerStatementAmount');
  const end=ui.indexOf('async function loadCustomerStatement',start);
  assert.ok(start>=0&&end>start);
  const metrics={};
  const context={statement:{line_kinds:lineKinds,period:{}},pmh:v=>String(v??''),metric:(label,value)=>{metrics[label]=value;return ''}};
  runInNewContext(ui.slice(start,end)+'\ncustomerStatementMarkup(statement);',context);
  return metrics;
}
const row=(line_kind,impact_class,amount)=>({line_kind,impact_class,amount});

test('refund is counted once, not again from neutral Payment Core allocation context',()=>{
  const m=renderStatement([row('purchase_value','purchase',100),row('refund','neutral',20),row('refund','refund_in',20)]);
  assert.equal(m['Refunds / credits'],20);
  assert.equal(m['Recorded cash-flow context'],-80);
});

test('expense reversal restores cash-flow context and does not invent a new payment',()=>{
  const m=renderStatement([row('profile_expense','expense',50),row('reversal','cash_in',50)]);
  assert.equal(m['Personal money in'],0);
  assert.equal(m['Manual personal expenses'],50);
  assert.equal(m['Adjustments / reversals'],50);
  assert.equal(m['Recorded cash-flow context'],0);
});

test('personal income reversal and signed adjustments affect the monthly result',()=>{
  const m=renderStatement([row('profile_money_in','cash_in',200),row('reversal','cash_out',200),row('profile_adjustment','cash_in',30),row('profile_adjustment','cash_out',10)]);
  assert.equal(m['Adjustments / reversals'],-180);
  assert.equal(m['Recorded cash-flow context'],20);
});

test('commerce and internal transfers are shown separately without double counting',()=>{
  const m=renderStatement([row('profile_money_in','cash_in',1000),row('purchase_value','purchase',100),row('service_value','purchase',200),row('delivery_value','purchase',30),row('profile_expense','expense',50),row('profile_transfer_in','transfer_in',100),row('profile_transfer_out','transfer_out',70),row('courier_net','neutral',30)]);
  assert.equal(m['Marketplace spending'],100);
  assert.equal(m['Local Services spending'],200);
  assert.equal(m['Delivery spending'],30);
  assert.equal(m['Recorded cash-flow context'],650);
});

test('negative refund allocation remains neutral context without violating document nonnegative amounts',async()=>{
  const lines=[];
  let id=0;
  const client={release(){},async query(sql,args=[]){
    if(sql.includes('INSERT INTO financial_documents'))return{rows:[{id:++id}]};
    if(sql.includes('INSERT INTO financial_document_lines')){assert.ok(args[5]>=0);lines.push({kind:args[2],impact:args[3],amount:args[5],metadata:JSON.parse(args[8])});}
    return{rows:[]};
  }};
  const pool={connect:async()=>client,async query(sql){
    if(sql.includes('FROM payment_intents i')&&!sql.includes('JOIN payment_intents'))return{rows:[{id:1,public_id:'pi_test',payer_account_id:91,source_type:'service_job',source_id:7,status:'partially_refunded',amount:100,currency_code:'PHP',succeeded_at:'2026-09-01T01:00:00Z'}]};
    if(sql.includes('SELECT * FROM payment_allocations'))return{rows:[{id:3,component_code:'refund',amount:-20,settlement_status:'paid',economic_party_type:'customer_refund'}]};
    if(sql.includes('FROM refunds r'))return{rows:[{id:2,public_id:'ref_test',payment_intent_id:1,amount:20,status:'succeeded',currency_code:'PHP',processed_at:'2026-09-02T01:00:00Z'}]};
    return{rows:[]};
  }};
  await synchronizeFinancialDocumentsForScope(pool,{accountId:91,profileRole:'customer'});
  assert.equal(lines.filter(x=>x.kind==='refund'&&x.impact==='refund_in').reduce((s,x)=>s+x.amount,0),20);
  const context=lines.find(x=>x.kind==='refund'&&x.impact==='neutral');
  assert.equal(context.amount,20);
  assert.equal(context.metadata.signed_amount,-20);
});

test('Customer statement loads only on request and uses Manila calendar context',()=>{
  assert.match(ui,/Monthly personal cash-flow statement/);
  assert.match(ui,/api\/financial-statements\/month\?profile_role=customer/);
  assert.match(ui,/Statement loads only when you ask for it/);
  assert.match(ui,/timeZone:'Asia\/Manila'/);
  const block=ui.slice(ui.indexOf('async function openPm'),ui.indexOf('function decorateMoney'));
  assert.doesNotMatch(block,/financial-statements\/month/);
  assert.match(server,/financialDocumentScope/);
});

test('personal statement never presents business profit or provider balance',()=>{
  const block=ui.slice(ui.indexOf('function customerStatementSection'),ui.indexOf('function renderCustomer'));
  assert.match(block,/Not a bank or provider balance/);
  for(const text of ['COGS','supplier payables','owner drawings','business profit'])assert.equal(block.toLowerCase().includes(text.toLowerCase()),false,text);
});
