import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('profile-finance-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-settings-ui.js');
const shell=read('public/shell.js');

test('financial destinations separate personal/profile scope from business accounting scope',()=>{
  assert.match(core,/BUSINESS_FINANCE_ROLES=Object\.freeze\(\['merchant','supplier'\]\)/);
  assert.match(core,/owner_scope IN \('account','business'\)/);
  assert.match(core,/owner_scope='business' AND business_id IS NOT NULL/);
  assert.match(server,/if\(isBusinessFinanceRole\(role\)\)/);
  assert.match(server,/return\{owner_scope:'account',business_id:null\}/);
});

test('financial settings never accept raw banking or card credentials',()=>{
  assert.match(server,/account_number\|routing\|iban\|card_number\|pan\|cvv\|cvc\|password\|pin\|secret/);
  assert.match(server,/Use a provider destination reference and last four characters only/);
  assert.match(core,/reference_last4/);
  assert.doesNotMatch(ui,/account_number/i);
  assert.doesNotMatch(ui,/card number/i);
  assert.doesNotMatch(ui,/cvv/i);
});

test('provider destination reference is private and public response is masked',()=>{
  const start=core.indexOf('export function publicFinancialAccount');
  const end=core.indexOf('function normalizeRole',start);
  const block=core.slice(start,end);
  assert.match(block,/reference_last4/);
  assert.match(block,/provider_destination_configured/);
  assert.doesNotMatch(block,/provider_destination_ref:/);
});

test('Settings is inserted into the avatar drawer and works across all five public profiles',()=>{
  assert.match(ui,/abl:drawer-rendered/);
  assert.match(ui,/profileSettingsButton/);
  for(const role of ['customer','merchant','supplier','courier','service_provider'])assert.match(ui,new RegExp(role));
  assert.match(ui,/Account & profile settings/);
  assert.match(shell,/profileDrawerPanel/);
});

test('real withdrawal execution remains disabled until a verified adapter exists',()=>{
  assert.match(server,/payout_execution_ready:false/);
  assert.match(server,/PROVIDER_DISBURSEMENT_ADAPTER_NOT_CONNECTED/);
  assert.match(ui,/Real transfer is not active yet/);
  assert.match(ui,/will not mark money as withdrawn or transferred until a provider\/bank\/e-wallet confirms/);
  assert.doesNotMatch(server,/status='paid'.*settings\/financial/s);
});

test('money preferences only select financial accounts owned by the same profile scope',()=>{
  assert.match(server,/Selected financial account is outside this profile\/business scope/);
  assert.match(server,/Selected account is not enabled to receive money/);
  assert.match(server,/Selected account is not enabled for payments/);
  assert.match(server,/Selected account is not enabled as a payout destination/);
});

test('profile finance schema records auditable settings changes',()=>{
  assert.match(core,/profile_finance_audit_events/);
  assert.match(core,/financial_account_created/);
  assert.match(core,/financial_account_updated/);
  assert.match(core,/money_preferences_updated/);
});
