import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../account-money-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/profile-settings-ui.js',import.meta.url),'utf8');
const moneyUi=readFileSync(new URL('../public/profile-money-ui.js',import.meta.url),'utf8');

test('external financial identity belongs to account not individual profiles',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS account_money_identities/);
  assert.match(core,/account_id BIGINT PRIMARY KEY REFERENCES accounts\(id\)/);
  const start=core.indexOf('CREATE TABLE IF NOT EXISTS account_financial_destinations');
  const end=core.indexOf('CREATE INDEX IF NOT EXISTS account_financial_destinations_owner_idx',start);
  const schema=core.slice(start,end);
  assert.match(schema,/account_id BIGINT NOT NULL REFERENCES accounts\(id\)/);
  assert.doesNotMatch(schema,/profile_role/);
  assert.doesNotMatch(schema,/business_id/);
});

test('account payout destinations expose only masked display data to clients',()=>{
  const start=core.indexOf('function publicDestination');
  const end=core.indexOf('function publicSavedMethod',start);
  const block=core.slice(start,end);
  assert.match(block,/reference_last4/);
  assert.match(block,/provider_destination_configured/);
  assert.doesNotMatch(block,/provider_destination_ref:/);
  assert.doesNotMatch(block,/account_number/);
});

test('saved card/payment methods expose provider-safe metadata only',()=>{
  const start=core.indexOf('function publicSavedMethod');
  const end=core.indexOf('export async function ensureAccountMoneySchema',start);
  const block=core.slice(start,end);
  assert.match(block,/brand/);
  assert.match(block,/last4/);
  assert.match(block,/provider_method_configured/);
  assert.doesNotMatch(block,/provider_payment_method_ref:/);
  assert.doesNotMatch(block,/card_number|cvv|cvc|pan/i);
});

test('saved payment methods can only be attached from a provider token reference',()=>{
  assert.match(core,/Provider-tokenized payment method reference is required/);
  assert.match(core,/provider_payment_method_ref TEXT NOT NULL DEFAULT ''/);
  assert.match(core,/provider_payment_method_attached/);
  assert.match(core,/raw_card_storage:false/);
  assert.doesNotMatch(server,/app\.post\('\/api\/settings\/account-money\/saved-payment-methods'/);
});

test('normal Money Banking UI never asks for a full bank account or card credential',()=>{
  assert.match(ui,/Last 4 only/);
  assert.match(ui,/Do not enter a full account or card number/);
  assert.match(ui,/Raw card details are never stored here/);
  assert.doesNotMatch(ui,/(?:id|name)=["'][^"']*(?:account_number|card_number|cvv|cvc|pan|pin)[^"']*["']/i);
  assert.doesNotMatch(ui,/type=["']password["']/i);
});

test('account Money Banking is shared across profiles in Settings and Money workspaces',()=>{
  assert.match(server,/account_money:accountMoney/);
  assert.match(ui,/One external financial identity for this account/);
  assert.match(ui,/Shared across profiles/);
  assert.match(moneyUi,/shared across your profiles/);
  assert.match(moneyUi,/This profile keeps only its own internal Balance and activity/);
});

test('legacy profile financial destinations are preserved but demoted from the normal flow',()=>{
  assert.match(core,/legacy_profile_destination_count/);
  assert.match(server,/legacy_profile_financial_accounts/);
  assert.match(ui,/legacy profile financial destination/);
  const render=ui.slice(ui.indexOf('function renderSettings'),ui.indexOf('function bindSettings'));
  assert.doesNotMatch(render,/accountForm\(existing\)/);
  assert.doesNotMatch(render,/preferencesForm\(accounts\)/);
});

test('direct payment does not require a positive internal Balance',()=>{
  assert.match(ui,/Direct payment remains available even with Balance = 0/);
  assert.match(moneyUi,/External banking and saved payment methods belong to your Avatar\/Account/);
  assert.doesNotMatch(core,/minimum_balance_required/);
});

test('account payout remains provider-evidence gated',()=>{
  assert.match(server,/payout_execution_ready:false/);
  assert.match(server,/PROVIDER_DISBURSEMENT_ADAPTER_NOT_CONNECTED/);
  assert.match(core,/provider_balance_authority:'provider_adapter_only'/);
  assert.match(core,/raw_bank_account_storage:false/);
});

test('registered business identity is a verification declaration not automatic approval',()=>{
  assert.match(core,/registered_business/);
  assert.match(core,/verification_status=CASE WHEN identity_kind<>\$1 OR legal_name<>\$2 THEN 'unverified'/);
  assert.doesNotMatch(core,/identity_kind='registered_business'[^\n]*verification_status='verified'/);
});
