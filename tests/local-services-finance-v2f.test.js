import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const money=read('profile-money-core.js');
const finance=read('profile-finance-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-money-ui.js');
const shell=read('public/shell.js');

test('Local Services Finance derives Customer paid and receivable from canonical Payment Core evidence',()=>{
  assert.match(money,/async function serviceProviderPaymentEvidence/);
  assert.match(money,/pi\.source_type='service_job'/);
  assert.match(money,/pi\.status IN \('succeeded','partially_refunded','refunded'\)/);
  assert.match(money,/JOIN refunds r|FROM refunds r/);
  assert.match(money,/r\.status='succeeded'/);
  assert.match(money,/confirmed_customer_payments/);
  assert.match(money,/refunded_customer_payments/);
  assert.match(money,/outstanding_receivables/);
  assert.match(money,/GREATEST\(payable-effective_paid,0\)/);
});

test('payment evidence and payout settlement stay distinct',()=>{
  assert.match(money,/payments,/);
  assert.match(money,/income:allocations/);
  assert.match(money,/payment_tracking:'payment_intents \+ succeeded refunds'/);
  assert.match(money,/settlement_tracking:allocations\.tracked\?'payment_allocations\.service_provider_net':'not_configured'/);
  assert.match(money,/Customer payment success and Service Provider payout\/settlement are separate facts/);
  assert.match(money,/netAllocations\(pool,'service_provider_net',accountId\)/);
});

test('recent Service Jobs expose paid pending refunded and outstanding without a parallel cash table',()=>{
  assert.match(money,/payment_received/);
  assert.match(money,/payment_pending/);
  assert.match(money,/payment_refunded/);
  assert.match(money,/outstanding_receivable/);
  assert.doesNotMatch(money,/service_job_payments|service_provider_cash_received/);
});

test('Service Provider work expense primitive is job scoped auditable and reversible',()=>{
  assert.match(finance,/profile_money_entries/);
  assert.match(finance,/source_type IN \('manual','delivery','service_job'\)/);
  assert.match(finance,/r==='service_provider'\?\['manual','service_job'\]/);
  assert.match(finance,/FROM service_jobs WHERE id=\$1 AND provider_account_id=\$2/);
  for(const category of ['materials','travel','tools_equipment','subcontractor','permit_fee','mobile_data','other_work']){
    assert.ok(finance.includes("'"+category+"'"),'missing Service Provider expense category '+category);
  }
  assert.match(finance,/financial_account_id BIGINT REFERENCES profile_financial_accounts/);
  assert.match(finance,/evidence_reference TEXT NOT NULL DEFAULT ''/);
  assert.match(finance,/occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(finance,/reversal_of_id BIGINT REFERENCES profile_money_entries/);
  assert.match(finance,/profile_money_entry_reversed/);
});

test('Service Provider income cannot be entered manually and profile Money remains the only expense ledger',()=>{
  assert.match(finance,/Courier and Service Provider income cannot be entered manually/);
  assert.match(server,/createProfileMoneyEntry\(pool/);
  assert.match(server,/profileMoneySnapshot\(pool,role,me\.account\.id\)/);
  assert.match(ui,/Service income cannot be typed here; income requires payment\/settlement evidence/);
  assert.doesNotMatch(money,/CREATE TABLE[^\n]*service_provider_expense/i);
});

test('Local Services UI presents completed value Customer paid receivable expenses and settlement separately',()=>{
  assert.match(ui,/Completed job value/);
  assert.match(ui,/Customer paid/);
  assert.match(ui,/Still to collect/);
  assert.match(ui,/Work expenses/);
  assert.match(ui,/Service Provider settlement/);
  assert.match(ui,/Recent jobs and receivables/);
  assert.match(shell,/Customer paid/);
  assert.match(shell,/Still to collect/);
  assert.match(shell,/Separate service_provider_net allocation evidence/);
});
