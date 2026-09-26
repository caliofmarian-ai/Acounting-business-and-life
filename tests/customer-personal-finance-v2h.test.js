import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileMoneyEntryCapabilities} from '../profile-finance-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const finance=read('profile-finance-core.js');
const docs=read('financial-document-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-money-ui.js');

test('Customer optional personal ledger supports money in expenses categories and corrections without becoming business accounting',()=>{
  const cap=profileMoneyEntryCapabilities('customer');
  assert.deepEqual(cap.entry_types,['money_in','expense','adjustment']);
  for(const category of ['income','remittance','household','groceries','housing','transport','health','education','family','personal','other','adjustment']){
    assert.ok(cap.categories.includes(category),category);
  }
  assert.deepEqual(cap.source_types,['manual']);
  assert.match(finance,/profile_role IN \('customer','courier','service_provider'\)/);
  assert.match(finance,/reversal_of_id BIGINT REFERENCES profile_money_entries/);
  assert.match(finance,/profile_money_entry_reversed/);
  assert.doesNotMatch(finance,/DELETE FROM profile_money_entries/);
});

test('Customer platform commerce remains canonical and is classified instead of copied into the manual ledger',()=>{
  assert.match(finance,/source_types:r==='courier'\?\['manual','delivery'\]:r==='service_provider'\?\['manual','service_job'\]:\['manual'\]/);
  assert.match(docs,/a\.component_code==='delivery'\?'delivery_value':'purchase_value'/);
  assert.match(docs,/i\.source_type==='service_job'\?'service_value':'purchase_value'/);
  assert.match(docs,/lineCode:'refund',lineKind:'refund',impactClass:'refund_in'/);
  assert.match(docs,/profileRole:'customer',documentType:'payment_receipt'/);
  assert.match(docs,/profileRole:'customer',documentType:'refund_credit'/);
});

test('periodic statement exposes line-kind breakdown needed for Customer personal cash-flow classification',()=>{
  assert.match(docs,/SELECT l\.line_kind,l\.impact_class,COUNT\(\*\)::int line_count/);
  assert.match(docs,/GROUP BY l\.line_kind,l\.impact_class/);
  assert.match(docs,/line_kinds:lineKindTotals/);
  assert.match(docs,/line_kind:row\.line_kind/);
  assert.match(docs,/impact_class:row\.impact_class/);
});

test('Customer monthly personal statement is on-demand rather than loaded on normal Money open',()=>{
  assert.match(ui,/Monthly personal cash-flow statement/);
  assert.match(ui,/id="customerLoadStatement"/);
  assert.match(ui,/api\/financial-statements\/month\?profile_role=customer/);
  assert.match(ui,/Statement loads only when you ask for it/);
  const openStart=ui.indexOf('async function openPm');
  const openEnd=ui.indexOf('function decorateMoney',openStart);
  const openBlock=ui.slice(openStart,openEnd);
  assert.doesNotMatch(openBlock,/financial-statements\/month/);
});

test('Customer statement separates Marketplace Local Services Delivery refunds and profile transfers',()=>{
  const start=ui.indexOf('function customerStatementMarkup');
  const end=ui.indexOf('async function loadCustomerStatement',start);
  const block=ui.slice(start,end);
  for(const kind of ['purchase_value','service_value','delivery_value','profile_money_in','profile_expense','profile_transfer_in','profile_transfer_out','refund']) assert.ok(block.includes(kind),kind);
  for(const label of ['Marketplace spending','Local Services spending','Delivery spending','Refunds / credits','Transfers in','Transfers out','Manual personal expenses','Personal money in']) assert.ok(block.includes(label),label);
});

test('Customer cash-flow statement remains personal and never becomes a business ledger',()=>{
  const start=ui.indexOf('function customerStatementSection');
  const end=ui.indexOf('function renderCustomer',start);
  const block=ui.slice(start,end);
  assert.match(block,/Recorded cash-flow context/);
  assert.match(block,/Not a bank or provider balance/);
  assert.match(block,/Source Orders, Payment Core and your personal entries remain authoritative/);
  for(const forbidden of ['COGS','supplier payables','owner drawings','business profit']) assert.equal(block.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
});

test('Customer statement endpoint is profile-gated and uses the derived financial document engine',()=>{
  assert.match(server,/app\.get\('\/api\/financial-statements\/:period'/);
  assert.match(server,/financialDocumentScope\(me,req\.query\?\.profile_role,req\.query\?\.business_id\)/);
  assert.match(server,/financialStatementForScope\(pool/);
  assert.match(server,/if\(!enabledProfile\(me,role\)\)/);
  assert.match(docs,/source_ledgers_remain_authoritative:true/);
  assert.match(docs,/statements_are_derived:true/);
});
