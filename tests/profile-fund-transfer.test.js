import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../profile-finance-core.js',import.meta.url),'utf8');
const payments=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const financeView=readFileSync(new URL('../business-finance-view-core.js',import.meta.url),'utf8');
const settings=readFileSync(new URL('../public/profile-settings-ui.js',import.meta.url),'utf8');

test('same-user profile funds transfer has its own atomic primitive',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_fund_transfers/);
  assert.match(core,/transfer_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/account_id BIGINT NOT NULL REFERENCES accounts\(id\)/);
  assert.match(core,/SELECT pg_advisory_xact_lock\(\$1\)/);
  assert.match(core,/Transfer exceeds the source profile recorded balance/);
  assert.match(core,/Choose two different profiles\/workspaces/);
});

test('profile transfer supports personal and business scopes owned by the same account',()=>{
  assert.match(core,/assertOwnedActiveFundScope/);
  assert.match(core,/FROM profiles WHERE account_id=\$1 AND role=\$2/);
  assert.match(core,/profile_business_bindings pb/);
  assert.match(core,/business_memberships bm/);
  assert.match(core,/pb\.account_id=\$1 AND pb\.role=\$2 AND pb\.business_id=\$3/);
  assert.doesNotMatch(core,/destination_account_id BIGINT/);
});

test('internal profile transfer is not provider money movement and has zero platform fee at API boundary',()=>{
  assert.match(core,/provider_money_moved:false/);
  assert.match(core,/transfer_type:'INTERNAL_PROFILE_FUNDS'/);
  assert.match(payments,/platform_fee:0/);
  assert.match(payments,/provider_money_moved:false/);
  assert.match(settings,/No platform fee and no external bank\/e-wallet transfer/);
});

test('business transfer entries are profit neutral but affect recorded available balance',()=>{
  assert.match(core,/profile_transfer_in/);
  assert.match(core,/profile_transfer_out/);
  assert.match(accounting,/profile_transfer_in/);
  assert.match(accounting,/profile_transfer_out/);
  assert.match(accounting,/profit:Number\(t\.sales\)-Number\(t\.business_expenses\)/);
  assert.match(accounting,/available=Number\(t\.sales\)\+Number\(t\.money_received\)\+Number\(t\.adjustments\)\+Number\(t\.profile_transfer_in\)-Number\(t\.business_expenses\)-Number\(t\.personal_withdrawals\)-Number\(t\.profile_transfer_out\)/);
  assert.match(financeView,/Profile transfers change recorded balance but never business revenue, expense or profit/);
});

test('personal profile transfer entries are system generated and cannot be manually or one-sided reversed',()=>{
  assert.match(core,/source_type IN \('manual','delivery','service_job','profile_transfer'\)/);
  assert.match(core,/entry_type IN \('money_in','expense','adjustment','reversal','profile_transfer_in','profile_transfer_out'\)/);
  assert.match(core,/Internal profile transfer entries must be corrected as one atomic transfer/);
  assert.match(core,/VALUES\([^\n]*'profile_transfer'/);
  assert.doesNotMatch(core,/source_types:[^\n]*profile_transfer/);
});

test('profile transfer API is account scoped and idempotent',()=>{
  assert.match(payments,/app\.post\('\/api\/settings\/profile-fund-transfers'/);
  assert.match(payments,/accountId:me\.account\.id/);
  assert.match(payments,/Idempotency|idempotency-key/i);
  assert.match(core,/Idempotency key belongs to another account/);
});

test('normal settings flow shows fund transfer instead of budget reallocation',()=>{
  assert.match(settings,/Transfer funds between my profiles/);
  assert.match(settings,/profileFundTransferForm/);
  assert.match(settings,/profile_fund_scopes/);
  assert.match(settings,/profile_fund_transfers/);
  const render=settings.slice(settings.indexOf('function renderSettings'),settings.indexOf('function bindSettings'));
  assert.doesNotMatch(render,/budgetTransferForm\(\)/);
  assert.match(render,/profileFundTransferForm\(\)/);
});

test('source balance uses recorded funds and never planned budget amount',()=>{
  assert.match(core,/recordedFundBalance/);
  assert.match(core,/balance_type:'recorded_internal_balance'/);
  assert.match(core,/provider_cash_balance:null/);
  const transferFn=core.slice(core.indexOf('export async function transferFundsBetweenProfiles'));
  assert.doesNotMatch(transferFn,/profile_budget_envelopes/);
  assert.doesNotMatch(transferFn,/allocated_budget/);
});
