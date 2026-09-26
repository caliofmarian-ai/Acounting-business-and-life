import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('profile-money-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-money-ui.js');
const shell=read('public/shell.js');

test('Customer Money uses payment/refund/order evidence and never business profit language',()=>{
  assert.match(core,/payment_intents WHERE payer_account_id=\$1/);
  assert.match(core,/refunds r[\s\S]*pi\.payer_account_id=\$1/);
  assert.match(core,/orders WHERE customer_account_id=\$1/);
  assert.match(ui,/Confirmed payments/);
  assert.match(ui,/Outstanding purchases/);
  assert.match(ui,/Personal purchase activity only/);
  assert.doesNotMatch(ui,/Customer[^\n]{0,120}business profit/i);
});

test('Courier delivery fee is explicitly not treated as Courier earnings',()=>{
  assert.match(core,/netAllocations\(pool,'courier_net',accountId\)/);
  assert.match(core,/delivery_fee_rule:'A delivery fee is the customer\/order delivery charge\. It is not automatically Courier earnings\.'/);
  assert.match(core,/Courier compensation allocation is not configured yet/);
  assert.match(ui,/Customer charges — not earnings/);
  assert.match(ui,/No courier_net allocation yet/);
  assert.doesNotMatch(core,/earnings:money\(d\.delivered_fee_context\)/);
});

test('Local Services separates commercial value Customer payment receivable expenses and settlement',()=>{
  assert.match(core,/COALESCE\(final_price,quote_amount,0\)/);
  assert.match(core,/serviceProviderPaymentEvidence\(pool,accountId\)/);
  assert.match(core,/pi\.source_type='service_job'/);
  assert.match(core,/pi\.status IN \('succeeded','partially_refunded','refunded'\)/);
  assert.match(core,/r\.status='succeeded'/);
  assert.match(core,/outstanding_receivables/);
  assert.match(core,/netAllocations\(pool,'service_provider_net',accountId\)/);
  assert.match(core,/Completed job value is a commercial amount, not proof that money was received/);
  assert.match(core,/Customer payment success and Service Provider payout\/settlement are separate facts/);
  assert.match(ui,/Customer payment evidence comes from verified Payment Intents/);
  assert.match(ui,/Customer paid/);
  assert.match(ui,/Still to collect/);
  assert.match(ui,/Work expenses/);
});

test('only Customer Courier and Local Services use this personal/profile Money endpoint',()=>{
  assert.match(server,/\['customer','courier','service_provider'\]\.includes\(role\)/);
  assert.match(server,/This profile uses business accounting or does not have a personal Money workspace/);
  assert.match(server,/Enable this profile before opening its Money workspace/);
  assert.doesNotMatch(server,/\['customer','courier','service_provider','merchant'/);
  assert.doesNotMatch(server,/\['customer','courier','service_provider','supplier'/);
});

test('shell exposes role-specific Money destinations without changing Merchant or Supplier accounting model',()=>{
  assert.match(shell,/data-hub-feature="Money"><span>💳<\/span><strong>My money<\/strong>/);
  assert.match(shell,/data-customer-nav="money"/);
  assert.match(shell,/data-courier-home-open="Money"/);
  assert.match(shell,/openProfileMoney\('courier'\)/);
  assert.match(shell,/data-courier-nav="money"/);
  assert.match(shell,/\['💰','Money'[^\n]*'Money'\]/);
  const supplierStart=shell.indexOf('supplier: [');
  const hubsEnd=shell.indexOf('};',supplierStart);
  const supplier=shell.slice(supplierStart,hubsEnd);
  assert.match(supplier,/\['💰','Money','Receivables and recorded payments','Money'\]/);
  assert.match(shell,/data-service-provider-nav="money"/);
  assert.match(shell,/openProfileMoney\('service_provider'\)/);
  assert.match(read('public/suppliers-ui.js'),/supplierMoneyPanel/);
  assert.match(read('public/suppliers-ui.js'),/Receivables use invoice evidence when present, otherwise received value/);
  assert.match(read('public/suppliers-ui.js'),/An unreceived PO is not money due/);
});

test('Money workspace uses shared account-level Money & Banking while preserving legacy profile references',()=>{
  assert.match(server,/accountMoneySettings\(pool,\{accountId:me\.account\.id/);
  assert.match(server,/account_money:accountMoney/);
  assert.match(server,/legacy_profile_financial_accounts:profileAccounts/);
  assert.match(ui,/External banking and saved payment methods belong to your Avatar\/Account and are shared across your profiles/);
  assert.match(ui,/Open Money & Banking/);
  assert.match(ui,/BusinessLifeShell/);
  assert.match(ui,/openProfileSettings/);
  assert.match(ui,/openPmSettings/);
});

test('Money workspace does not invent untracked settlement as zero earnings',()=>{
  assert.match(ui,/Recorded earnings<\/span><strong>Not tracked/);
  assert.match(ui,/Settlement amount is not configured yet/);
  assert.match(ui,/Service Provider payout remains a separate settlement state/);
  assert.doesNotMatch(ui,/Customer paid<\/span><strong>Not tracked/);
});


test('Money workspaces expose only budgets belonging to the active personal profile',()=>{
  assert.match(server,/listProfileBudgetEnvelopes/);
  assert.match(server,/const profileBudgets=budgets\.filter\(b=>b\.profile_role===role&&b\.business_id==null\)/);
  assert.match(server,/budgets:profileBudgets/);
  assert.match(ui,/Profile budget/);
  assert.match(ui,/planned allocations for this profile only/);
  assert.match(ui,/They are not bank\/e-wallet balances/);
  assert.match(ui,/allocated budget/);
});

test('personal Money UI keeps profile budget distinct from financial destinations',()=>{
  assert.match(ui,/budgetSummary\(\)\+financialDestinations\(\)/);
  assert.match(ui,/Planning only/);
  assert.match(ui,/Create one in Settings/);
});

test('Profile Money reversal uses an explicit app dialog and Cancel cannot mutate money',()=>{
  assert.doesNotMatch(ui,/window\.prompt|\bprompt\s*\(/);
  assert.match(ui,/function openPmReversalDialog\(id\)/);
  assert.match(ui,/function closePmReversalDialog\(\)/);
  assert.match(ui,/moneyReversalCancel'\)\.onclick=closePmReversalDialog/);
  assert.match(ui,/moneyReversalClose'\)\.onclick=closePmReversalDialog/);
  assert.match(ui,/moneyReversalForm'\)\.onsubmit=submitProfileMoneyReversal/);
  const closeStart=ui.indexOf('function closePmReversalDialog');
  const closeEnd=ui.indexOf('function openPmReversalDialog',closeStart);
  const closeBlock=ui.slice(closeStart,closeEnd);
  assert.doesNotMatch(closeBlock,/\/api\/profile-money|pmapi\(/);
  const submitStart=ui.indexOf('async function submitProfileMoneyReversal');
  const submitEnd=ui.indexOf('function ensurePm',submitStart);
  const submitBlock=ui.slice(submitStart,submitEnd);
  assert.match(submitBlock,/entries\/'\+id\+'\/reverse/);
  assert.match(submitBlock,/if\(!reason\)/);
  assert.match(submitBlock,/submit\.disabled=true/);
  assert.match(submitBlock,/Idempotency-Key/);
});

test('Profile Money reversal dialog is Android-safe and uses 44px actions',()=>{
  const css=read('public/profile-money.css');
  assert.match(css,/\.moneyReversalDialog\{[^}]*max-height:92vh;max-height:92dvh/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.moneyReversalDialog header button\{width:44px;height:44px/);
  assert.match(css,/\.moneyReversalActions button\{[^}]*min-height:44px/);
  assert.match(css,/\.moneyReverse\{min-height:44px/);
});
