import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileMoneyEntryCapabilities} from '../profile-finance-core.js';

const core=readFileSync(new URL('../profile-finance-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/profile-money-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/profile-money.css',import.meta.url),'utf8');

test('one shared personal money ledger serves Customer Courier and Service Provider only',()=>{
  const start=core.indexOf('CREATE TABLE IF NOT EXISTS profile_money_entries');
  const end=core.indexOf('CREATE INDEX IF NOT EXISTS profile_money_entries_scope_idx',start);
  const schema=core.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(schema,/CHECK\(profile_role IN \('customer','courier','service_provider'\)\)/);
  assert.doesNotMatch(schema,/merchant/);
  assert.doesNotMatch(schema,/supplier/);
});

test('role capabilities prevent manual Courier and Service Provider income',()=>{
  assert.deepEqual(profileMoneyEntryCapabilities('customer').entry_types,['money_in','expense','adjustment']);
  assert.deepEqual(profileMoneyEntryCapabilities('courier').entry_types,['expense','adjustment']);
  assert.deepEqual(profileMoneyEntryCapabilities('service_provider').entry_types,['expense','adjustment']);
  assert.match(core,/Courier and Service Provider income cannot be entered manually/);
  assert.match(core,/Courier earnings require courier_net allocation evidence/);
  assert.match(core,/Service Provider income requires payment\/settlement evidence/);
});

test('manual ledger categories are role specific',()=>{
  assert.ok(profileMoneyEntryCapabilities('customer').categories.includes('groceries'));
  assert.ok(profileMoneyEntryCapabilities('courier').categories.includes('fuel'));
  assert.ok(profileMoneyEntryCapabilities('courier').categories.includes('maintenance'));
  assert.ok(profileMoneyEntryCapabilities('service_provider').categories.includes('materials'));
  assert.ok(profileMoneyEntryCapabilities('service_provider').categories.includes('travel'));
  assert.ok(!profileMoneyEntryCapabilities('customer').categories.includes('fuel'));
});

test('platform commerce and earnings are not copied into the manual ledger',()=>{
  assert.match(core,/Platform purchases\/refunds remain sourced from Orders and Payment Core/);
  assert.match(core,/source_types:r==='courier'\?\['manual','delivery'\]/);
  assert.match(core,/r==='service_provider'\?\['manual','service_job'\]/);
  assert.doesNotMatch(core,/source_types:[^\n]*order/);
  assert.doesNotMatch(core,/source_types:[^\n]*payment_intent/);
});

test('Courier delivery and Service Provider job sources must belong to the same profile',()=>{
  assert.match(core,/FROM deliveries WHERE id=\$1 AND courier_account_id=\$2/);
  assert.match(core,/Delivery is outside this Courier profile/);
  assert.match(core,/FROM service_jobs WHERE id=\$1 AND provider_account_id=\$2/);
  assert.match(core,/Service job is outside this Service Provider profile/);
});

test('linked financial account must stay in the same profile scope and currency',()=>{
  assert.match(core,/profile_role=\$3 AND COALESCE\(business_id,0\)=COALESCE\(\$4::bigint,0\)/);
  assert.match(core,/Budget and financial account currencies must match/);
  assert.match(core,/financial_account_id BIGINT REFERENCES profile_financial_accounts/);
});

test('profile cash flow remains distinct from provider balance',()=>{
  assert.match(core,/balance_type:'profile_recorded_cash_flow'/);
  assert.match(core,/provider_cash_balance:null/);
  assert.match(core,/provider_balance_status:'NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE'/);
  assert.match(ui,/Recorded cash flow ≠ provider balance/);
  assert.match(ui,/do not change a bank, e-wallet or PayMongo Wallet balance/);
});

test('money entries are idempotent and auditable',()=>{
  assert.match(core,/entry_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/profile_money_entry_created/);
  assert.match(core,/provider_balance_effect:false/);
  assert.doesNotMatch(core,/DELETE FROM profile_money_entries/);
});

test('corrections use reversal entries rather than destructive edits',()=>{
  assert.match(core,/entry_type IN \('money_in','expense','adjustment','reversal'\)/);
  assert.match(core,/reversal_of_id BIGINT REFERENCES profile_money_entries/);
  assert.match(core,/A reversal entry cannot be reversed again/);
  assert.match(core,/Money entry is already reversed/);
  assert.match(core,/profile_money_entry_reversed/);
  assert.match(core,/UPDATE profile_money_entries SET status='reversed'/);
  assert.doesNotMatch(core,/UPDATE profile_money_entries SET amount=/);
});

test('profile Money GET includes canonical commerce plus scoped manual ledger and budgets',()=>{
  assert.match(server,/profileMoneySnapshot\(pool,role,me\.account\.id\)/);
  assert.match(server,/listProfileBudgetEnvelopes\(pool,me\.account\.id\)/);
  assert.match(server,/listProfileMoneyEntries\(pool,\{accountId:me\.account\.id,profileRole:role\}\)/);
  assert.match(server,/profile_ledger:profileLedger/);
});

test('profile Money entry and reversal endpoints are profile gated',()=>{
  assert.match(server,/app\.post\('\/api\/profile-money\/:role\/entries'/);
  assert.match(server,/app\.post\('\/api\/profile-money\/:role\/entries\/:id\/reverse'/);
  assert.match(server,/enabledProfile\(me,role\)/);
  assert.match(server,/createProfileMoneyEntry\(pool/);
  assert.match(server,/reverseProfileMoneyEntry\(pool/);
  assert.match(server,/provider_balance_effect:false/);
});

test('Money UI exposes role-specific entry source and category controls',()=>{
  assert.match(ui,/Personal cash flow/);
  assert.match(ui,/Courier work expenses/);
  assert.match(ui,/Service work expenses/);
  assert.match(ui,/Related delivery/);
  assert.match(ui,/Related job/);
  assert.match(ui,/ledgerCategoryOptions/);
  assert.match(ui,/ledgerTypeOptions/);
});

test('Money UI keeps canonical earnings boundary visible',()=>{
  assert.match(ui,/Courier earnings cannot be typed here; earnings require courier_net evidence/);
  assert.match(ui,/Service income cannot be typed here; income requires payment\/settlement evidence/);
  assert.match(ui,/Marketplace purchases\/refunds stay sourced from platform payments and are not duplicated here/);
});

test('Money UI reloads canonical snapshot after write and supports reversal',()=>{
  assert.match(ui,/reloadProfileMoney/);
  assert.match(ui,/Idempotency-Key/);
  assert.match(ui,/data-money-reverse/);
  assert.match(ui,/reverseProfileMoneyEntry/);
});

test('mobile Money form is responsive',()=>{
  assert.match(css,/\.moneyEntryForm/);
  assert.match(css,/\.moneyFormGrid/);
  assert.match(css,/@media\(max-width:560px\)[\s\S]*\.moneyFormGrid\{grid-template-columns:1fr\}/);
});
