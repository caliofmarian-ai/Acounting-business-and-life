import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../business-finance-view-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/business-accounting-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/business-accounting.css',import.meta.url),'utf8');
const pkg=readFileSync(new URL('../package.json',import.meta.url),'utf8');

test('business Finance V2 is a read model over the existing shared ledger, not a second ledger engine',()=>{
  assert.match(server,/businessFinanceOverview/);
  assert.match(server,/api\/accounting\/finance-overview/);
  assert.doesNotMatch(core,/CREATE TABLE/);
  assert.doesNotMatch(core,/INSERT INTO transactions/);
  assert.doesNotMatch(core,/UPDATE transactions/);
});

test('Merchant Finance excludes delivery charge from merchandise sales and tracks actual payment separately',()=>{
  assert.match(core,/completed_merchandise_value/);
  assert.match(core,/orders\.subtotal/);
  assert.match(core,/delivery_fee is excluded/);
  assert.match(core,/confirmed_merchandise_received/);
  assert.match(core,/order_payments/);
  assert.match(core,/merchandise_amount/);
  assert.match(core,/completed_customer_receivables/);
  assert.match(core,/subtotal-merchandise_received/);
  assert.match(core,/ledger_reconciliation/);
  assert.match(core,/SEPARATE_EVIDENCE/);
  assert.match(core,/Manual entries, remittances, adjustments, expenses, drawings or profile transfers/);
});

test('Merchant presentation reuses canonical food non-food mixed storefront domain',()=>{
  assert.match(core,/merchant_storefronts/);
  assert.match(core,/merchant_domain/);
  assert.match(core,/food_modules_enabled/);
  assert.match(core,/non_food_modules_enabled/);
  assert.match(core,/legacy_recipe_ui_allowed/);
  assert.match(ui,/domain==='non_food'/);
  assert.match(ui,/legacy_recipe_ui_allowed/);
});

test('non-food Merchant profitability never infers COGS from recipe tables',()=>{
  assert.match(core,/NON_FOOD_COST_BASIS_NOT_CONFIGURED/);
  assert.match(core,/Non-food COGS is not inferred from recipe tables/);
  assert.match(core,/order_items/);
  assert.match(core,/estimated_cogs/);
});

test('Supplier Finance keeps commercial PO value separate from actual money received',()=>{
  assert.match(core,/fulfilled_po_value/);
  assert.match(core,/money_received_recorded/);
  assert.match(core,/merchant_receivables/);
  assert.match(core,/business_ledger_recorded_receipts/);
  assert.match(core,/source='supplier_receipt'/);
  assert.match(core,/PO paid_amount \/ supplier_receipt is recorded payment evidence; it is not bank payout evidence/);
});

test('Supplier multi-business PO attribution is not invented',()=>{
  assert.match(core,/MULTI_BUSINESS_SUPPLIER_PO_ATTRIBUTION_PENDING/);
  assert.match(core,/ACCOUNT_LEVEL_UNATTRIBUTED/);
  assert.match(core,/fulfilled_po_value:attribution==='SINGLE_SUPPLIER_BUSINESS_BINDING'\?money\(p\.fulfilled_value\):null/);
  assert.match(core,/POs are linked to Supplier account, not supplier_business_id/);
});

test('Merchant and Supplier payouts remain evidence-gated',()=>{
  assert.match(core,/componentCode:'merchant_net'/);
  assert.match(core,/componentCode:'supplier_net'/);
  assert.match(core,/Merchandise payment allocation is not automatically a Merchant payout\/bank settlement/);
  assert.match(core,/PO paid_amount is not treated as provider payout\/settlement/);
  assert.match(core,/status:count>0\?'TRACKED':'NOT_CONFIGURED'/);
});

test('business Finance V2 consumes canonical profile financial accounts and planned budgets',()=>{
  assert.match(core,/profile_financial_accounts/);
  assert.match(core,/profile_budget_envelopes/);
  assert.match(core,/profile_budget_entries/);
  assert.match(core,/balance_type:'planned_allocation'/);
  assert.match(core,/provider_cash_balance:null/);
  assert.match(core,/NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE/);
});

test('owner drawings remain separate from operating expense',()=>{
  assert.match(core,/type='business_expense'/);
  assert.match(core,/type='personal_withdrawal'/);
  assert.match(core,/Owner drawing \/ withdrawal is separate from business operating expense/);
  assert.match(ui,/Owner drawing \/ withdrawal/);
});

test('Supplier and non-food Merchant do not receive food-first legacy navigation',()=>{
  assert.match(ui,/for\(const name of \['Sell','Menu'\]\)/);
  assert.match(ui,/foodAllowed/);
  assert.match(ui,/role==='supplier'/);
  assert.match(ui,/roleFinanceHidden/);
  assert.match(ui,/Inventory \/ raw materials/);
  assert.match(css,/\.roleFinanceHidden\{display:none!important\}/);
});

test('Finance UI is materially role-specific',()=>{
  assert.match(ui,/Business finances/);
  assert.match(ui,/Supplier finances/);
  assert.match(ui,/Completed merchandise sales/);
  assert.match(ui,/Owed to suppliers/);
  assert.match(ui,/Fulfilled PO value/);
  assert.match(ui,/Recorded money received/);
  assert.match(ui,/Upstream payables/);
  assert.match(ui,/Planned Supplier budget/);
  assert.match(ui,/Manual records total/);
  assert.match(ui,/Manual records are not confirmed payments/);
});

test('Merchant Finance translates internal states into plain user language',()=>{
  assert.match(ui,/Choose where you want to receive payments/);
  assert.match(ui,/Products in stock/);
  assert.match(ui,/Estimated cost value · not available cash/);
  assert.match(ui,/Unverified entries · not bank balance or available cash/);
  assert.match(ui,/financeWarningCopy/);
  assert.doesNotMatch(ui,/replaceAll\('_',' '\)/);
});

test('Merchant Today replaces the legacy finance-heavy dashboard while Money preserves evidence boundaries',()=>{
  const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const legacyUi=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
  assert.match(index,/id="viewDashboard" class="view merchantTodayView"/);
  assert.match(index,/Confirmed business snapshot/);
  assert.match(index,/Confirmed customer payments/);
  assert.doesNotMatch(index,/legacyFinanceSnapshot/);
  assert.match(ui,/mountEconomicSummary\('viewMoney'\)/);
  assert.match(ui,/classList\.add\('roleFinanceHidden'\)/);
  assert.match(css,/\.ledgerReconciliation\.separate/);
  assert.match(legacyUi,/Manual ledger entry/);
  assert.match(legacyUi,/not confirmed payment evidence/);
  assert.match(legacyUi,/Void test entry/);
  assert.match(legacyUi,/amount:0/);
  assert.match(legacyUi,/original value preserved in audit history/);
});

test('Money Settings remains the single financial-account and budget configuration surface',()=>{
  assert.match(ui,/Money Settings/);
  assert.match(ui,/BusinessLifeProfileSettings/);
  assert.doesNotMatch(core,/provider_destination_ref TEXT/);
});

test('new finance read model is syntax checked by the project contract',()=>{
  assert.match(pkg,/node --check business-finance-view-core\.js/);
});
