import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('profile-finance-core.js');
const server=read('server-payments.js');
const ui=read('public/profile-settings-ui.js');
const shell=read('public/shell.js');
const loader=read('public/mobile-feature-loader.js');

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
  assert.doesNotMatch(ui,/(?:id|name)=["'][^"']*(?:account_number|accountNumber|card_number|cardNumber|cvv|cvc|pin|password)[^"']*["']/i);
  assert.doesNotMatch(ui,/type=["']password["']/i);
});

test('provider destination reference is private and public response is masked',()=>{
  const start=core.indexOf('export function publicFinancialAccount');
  const end=core.indexOf('function normalizeRole',start);
  const block=core.slice(start,end);
  assert.match(block,/reference_last4/);
  assert.match(block,/provider_destination_configured/);
  assert.doesNotMatch(block,/provider_destination_ref:/);
});

test('profile Settings is opened from the active profile and stays out of the avatar drawer',()=>{
  assert.doesNotMatch(shell,/activeProfileSettingsButton/);
  assert.match(shell,/profileSettingsTile/);
  assert.match(shell,/BusinessLifeProfileSettings\?\.open/);
  assert.match(shell,/data-merchant-mobile-action="profileSettings"/);
  assert.match(shell,/if\(destination==='profileSettings'\)/);
  assert.match(shell,/return open\('merchant'\)/);
  assert.doesNotMatch(loader,/MERCHANT_MOBILE_ACTIONS|openMerchantMobileAction/);
  assert.doesNotMatch(ui,/document\.addEventListener\('abl:drawer-rendered',injectSettingsEntry/);
  for(const role of ['customer','merchant','supplier','courier','service_provider'])assert.match(ui,new RegExp(role));
  assert.match(ui,/Account & profile settings/);
  assert.match(ui,/profileSettingsWorkspace/);
});

test('real withdrawal execution remains disabled until a verified adapter exists',()=>{
  assert.match(server,/payout_execution_ready:false/);
  assert.match(server,/PROVIDER_DISBURSEMENT_ADAPTER_NOT_CONNECTED/);
  assert.match(ui,/Withdraw is not active yet/);
  assert.match(ui,/Withdraw will use the default payout destination configured above in Avatar → Money & Banking/);
  assert.match(ui,/will not reduce the external\/provider balance or mark a withdrawal succeeded until the provider confirms/);
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


test('profile budgets are scoped independently from provider balances',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_budget_envelopes/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_budget_entries/);
  assert.match(core,/profile_role IN \('customer','merchant','supplier','courier','service_provider'\)/);
  assert.match(core,/balance_type:'planned_allocation'/);
  assert.match(core,/provider_cash_balance:null/);
  assert.match(core,/NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE/);
  assert.match(ui,/Allocated budget/);
  assert.match(ui,/planning allocation, not a provider-confirmed cash balance/);
});

test('one human account can keep different budgets for different profile and business scopes',()=>{
  assert.match(core,/account_id BIGINT NOT NULL REFERENCES accounts\(id\)/);
  assert.match(core,/profile_role TEXT NOT NULL/);
  assert.match(core,/business_id BIGINT REFERENCES businesses\(id\)/);
  assert.match(core,/profile_budget_envelopes_scope_idx/);
  assert.match(server,/financeScope\(me,role,req\.body\?\.business_id\)/);
  assert.match(ui,/Budget envelopes keep planned money for this profile\/business separate from your other profiles/);
});

test('internal budget reallocation is atomic and never claims provider money moved',()=>{
  assert.match(core,/profile_budget_transfers/);
  assert.match(core,/FOR UPDATE/);
  assert.match(core,/Budget reallocation exceeds the source allocated budget/);
  assert.match(core,/reallocation_out/);
  assert.match(core,/reallocation_in/);
  assert.match(core,/execution_type:'INTERNAL_BUDGET_REALLOCATION'/);
  assert.match(core,/provider_money_moved:false/);
  assert.match(ui,/internal budget reallocation\. No bank\/e-wallet\/provider transfer occurs/);
});

test('real money movement requests stay HOLD without provider execution evidence',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS profile_money_movements/);
  assert.match(core,/status TEXT NOT NULL DEFAULT 'pending_provider'/);
  assert.match(core,/PROVIDER_MONEY_MOVEMENT_ADAPTER_NOT_CONNECTED/);
  assert.match(server,/execution_status:'HOLD'/);
  assert.match(server,/CONNECT_VERIFIED_MONEY_MOVEMENT_ADAPTER/);
  assert.match(ui,/Create HOLD request/);
  assert.match(ui,/stays on HOLD until a verified adapter confirms real execution/);
  assert.doesNotMatch(server,/money-movements[^]*status:'succeeded'/);
});

test('real movement requests are account-scoped and capability-gated',()=>{
  assert.match(core,/source account is not enabled to transfer money/i);
  assert.match(core,/Destination account is not enabled to receive money/);
  assert.match(core,/Destination account is not enabled as a payout\/withdrawal destination/);
  assert.match(core,/Financial account is outside this account or inactive/);
});

test('Settings finance payload exposes budgets and movement history without raw provider balance invention',()=>{
  assert.match(server,/listProfileBudgetEnvelopes/);
  assert.match(server,/listProfileMoneyMovements/);
  assert.match(server,/financial_accounts:accounts,legacy_profile_financial_accounts:accounts,preferences,budgets,money_movements:movements/);
  assert.match(server,/budget_purposes:BUDGET_PURPOSES/);
  assert.match(server,/movement_types:MONEY_MOVEMENT_TYPES/);
});


test('account-level Money & Banking is the normal external-finance setup while profile destinations remain legacy',()=>{
  assert.match(server,/accountMoneySettings\(pool,\{accountId:me\.account\.id/);
  assert.match(server,/account_money:accountMoney/);
  assert.match(server,/legacy_profile_financial_accounts:accounts/);
  const render=ui.slice(ui.indexOf('function renderSettings'),ui.indexOf('function bindSettings'));
  const accountRender=ui.slice(ui.indexOf('function renderAccountMoneySettings'),ui.indexOf('async function refreshSettings'));
  assert.doesNotMatch(render,/accountMoneySettingsCard\(\)/);
  assert.match(render,/openAccountMoneyFromProfile/);
  assert.match(accountRender,/accountMoneySettingsCard\(\)/);
  assert.doesNotMatch(render,/Financial accounts & payout destinations/);
  assert.match(ui,/One external financial identity for this account/);
  assert.match(ui,/Shared across profiles/);
});
