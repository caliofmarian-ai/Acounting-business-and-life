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
  assert.match(core,/componentCode,'courier_net'/);
  assert.match(core,/delivery_fee_rule:'A delivery fee is the customer\/order delivery charge\. It is not automatically Courier earnings\.'/);
  assert.match(core,/Courier compensation allocation is not configured yet/);
  assert.match(ui,/Customer charges — not earnings/);
  assert.match(ui,/No courier_net allocation yet/);
  assert.doesNotMatch(core,/earnings:money\(d\.delivered_fee_context\)/);
});

test('Local Services commercial job value stays separate from received income',()=>{
  assert.match(core,/COALESCE\(final_price,quote_amount,0\)/);
  assert.match(core,/componentCode,'service_provider_net'/);
  assert.match(core,/Completed job value is a commercial amount, not proof that money was received/);
  assert.match(ui,/Completed job value is shown separately from provider-confirmed income/);
  assert.match(ui,/No service-provider settlement yet/);
});

test('only Customer Courier and Local Services use this personal/profile Money endpoint',()=>{
  assert.match(server,/\['customer','courier','service_provider'\]\.includes\(role\)/);
  assert.match(server,/This profile uses business accounting or does not have a personal Money workspace/);
  assert.match(server,/Enable this profile before opening its Money workspace/);
  assert.doesNotMatch(server,/\['customer','courier','service_provider','merchant'/);
  assert.doesNotMatch(server,/\['customer','courier','service_provider','supplier'/);
});

test('shell exposes role-specific Money destinations without changing Merchant or Supplier accounting model',()=>{
  assert.match(shell,/\['💳','My Money'[^\n]*'Money'\]/);
  assert.match(shell,/\['💰','Earnings & Money'[^\n]*'Money'\]/);
  assert.match(shell,/\['💰','Money'[^\n]*'Money'\]/);
  const supplierStart=shell.indexOf('supplier: [');
  const courierStart=shell.indexOf('courier: [',supplierStart);
  const supplier=shell.slice(supplierStart,courierStart);
  assert.doesNotMatch(supplier,/['"]Money['"]/);
});

test('Money workspace uses financial destinations from Settings and can open the same profile Settings',()=>{
  assert.match(server,/listProfileFinancialAccounts/);
  assert.match(server,/listMoneyPreferences/);
  assert.match(ui,/financialDestinations/);
  assert.match(ui,/BusinessLifeProfileSettings\?\.open\?\.\(pmRole\)/);
});

test('Money workspace does not invent untracked settlement as zero earnings',()=>{
  assert.match(ui,/Recorded earnings<\/span><strong>Not tracked/);
  assert.match(ui,/Money received<\/span><strong>Not tracked/);
  assert.match(ui,/Settlement amount is not configured yet/);
});
