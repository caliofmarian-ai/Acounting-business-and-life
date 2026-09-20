import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const settings=read('public/profile-settings-ui.js');
const money=read('public/profile-money-ui.js');
const accounting=read('public/business-accounting-ui.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  assert.ok(a>=0,'missing '+start);
  assert.ok(b>a,'missing '+end);
  return source.slice(a,b);
}

test('role shell is fail-closed and never defaults unresolved identity to Merchant UI',()=>{
  assert.match(shell,/let activeRole = null/);
  assert.match(shell,/function boot\(\) \{[\s\S]*hideMerchantWorkspace\(\)/);
  assert.match(shell,/if \(!activeRole\)\{hideMerchantWorkspace\(\)/);
  assert.match(shell,/Choose your first profile/);
  assert.match(shell,/if\(activeRole!=='merchant'\)return hideMerchantWorkspace\(\)/);
});

test('Customer hub contains shopper features and no Merchant accounting/menu creation destination',()=>{
  const hubs=between(shell,'const HUBS = {','function renderRoleHub');
  const customer=between(hubs,'customer: [','supplier: [');
  assert.match(customer,/Food/);
  assert.match(customer,/Non-food/);
  assert.match(customer,/My Orders/);
  assert.match(customer,/My Money/);
  assert.doesNotMatch(customer,/Finance & Accounting/);
  assert.doesNotMatch(customer,/Food menu/);
  assert.doesNotMatch(customer,/Create menu/);
  assert.doesNotMatch(customer,/Stock/);
});

test('Customer Settings stays profile-scoped and links to shared account banking',()=>{
  const render=between(settings,'function renderSettings(){','function bindSettings(){');
  assert.match(render,/openAccountMoneyFromProfile/);
  assert.doesNotMatch(render,/accountMoneySettingsCard\(\)/);
  assert.match(settings,/Pay, buy and get refunds without accounting clutter/);
  assert.match(settings,/You do not need to add banking details just to shop/);
  assert.match(settings,/Advanced personal money tools/);
  assert.doesNotMatch(render,/profileTabs\(\)/);
  assert.doesNotMatch(render,/<h2>Profile budget<\/h2>/);
  assert.doesNotMatch(render,/<h2>Withdraw<\/h2>/);
  assert.doesNotMatch(render,/budgetForms\(accounts,budgets\)/);
});

test('Customer Money is purchase/payment focused and accounting tools are optional',()=>{
  const customer=between(money,'function renderCustomer(){','function customerOrders()');
  assert.match(customer,/Paid/);
  assert.match(customer,/Still due/);
  assert.match(customer,/Refunded/);
  assert.match(customer,/Purchases/);
  assert.match(customer,/customerSimpleBanking\(\)/);
  assert.match(customer,/customerOptionalTracking\(\)/);
  assert.doesNotMatch(customer,/budgetSummary\(\)/);
  assert.doesNotMatch(customer,/financialDestinations\(\)/);
  assert.doesNotMatch(customer,/profileLedgerSection\(\)/);
  assert.match(money,/Optional personal money tracking/);
});

test('Merchant finance gives four human-readable primary numbers before advanced details',()=>{
  const merchant=between(accounting,'function merchantFinanceHtml(o){','function supplierFinanceHtml(o){');
  assert.match(merchant,/Money received/);
  assert.match(merchant,/Sales/);
  assert.match(merchant,/Awaiting payment/);
  assert.match(merchant,/Expenses/);
  assert.match(merchant,/Financial details/);
  assert.match(merchant,/Owed to suppliers/);
  assert.match(merchant,/Products in stock/);
  assert.match(merchant,/Money taken by owner/);
});

test('Supplier finance uses the same simple hierarchy without Merchant food language',()=>{
  const supplier=between(accounting,'function supplierFinanceHtml(o){','function financeWarnings(o)');
  assert.match(supplier,/Money received/);
  assert.match(supplier,/Fulfilled orders/);
  assert.match(supplier,/Still to collect/);
  assert.match(supplier,/Expenses/);
  assert.match(supplier,/More Supplier details/);
  assert.doesNotMatch(supplier,/recipe/i);
  assert.doesNotMatch(supplier,/Food menu/);
});

test('banking copy explains one external setup without pretending it is a provider cash balance',()=>{
  assert.match(settings,/One external banking setup is shared across your profiles/);
  assert.match(settings,/This does not mix their accounting/);
  assert.match(settings,/Provider balance/);
  assert.match(settings,/Shown only when provider evidence exists/);
  assert.match(accounting,/Payment and banking settings/);
  assert.match(accounting,/Personal bank details stay securely under Account · Money & Banking/);
  assert.doesNotMatch(accounting,/provider balance UNKNOWN/);
});
