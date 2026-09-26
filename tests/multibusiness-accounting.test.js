import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server-business-accounting.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/business-accounting-ui.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/shell.js', import.meta.url), 'utf8');

test('legacy accounting domains are migrated to a business_id boundary', () => {
  for (const table of ['transactions','inventory','daily_openings','daily_closings','remittances','budgets','audit_events','products','product_sales']) {
    assert.match(server, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS business_id`));
  }
});

test('financial reads and writes use business-scoped predicates', () => {
  assert.match(server, /FROM transactions WHERE business_id=\$1/);
  assert.match(server, /FROM inventory WHERE business_id=\$1/);
  assert.match(server, /FROM products WHERE business_id=\$1/);
  assert.match(server, /INSERT INTO transactions\(business_id/);
  assert.match(server, /INSERT INTO inventory\(business_id/);
  assert.match(server, /INSERT INTO products\(business_id/);
});

test('Merchant and Supplier profiles bind explicitly to economic workspaces', () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS profile_business_bindings/);
  assert.match(server, /CHECK\(role IN \('merchant','supplier'\)\)/);
  assert.match(server, /account_business_preferences/);
  assert.match(server, /ensureProfileBusinessBinding/);
});

test('Supplier accounting records commercial receivables separately from actual money', () => {
  assert.match(server, /supplier_fulfilled_revenue/);
  assert.match(server, /supplier_receivables/);
  assert.match(server, /'supplier_receipt'/);
  assert.match(server, /actual_received_total-paid_amount/);
});

test('order and procurement money posts to the owning business instead of business 1', () => {
  assert.doesNotMatch(server, /Number\(order\.business_id\)===1/);
  assert.doesNotMatch(server, /Number\(b\.id\)===1/);
  assert.match(server, /order\.business_id,`Order/);
  assert.match(server, /ctx\.business\.id,amount,account/);
});

test('inventory linkage and Marketplace menu import are business scoped', () => {
  assert.match(server, /inventory WHERE id=\$1 AND business_id=\$2/);
  assert.match(server, /FROM products p WHERE p\.business_id=\$1/);
  assert.match(server, /reorder-suggestions/);
});

test('workspace UI exposes Supplier finances and an explicit workspace selector', () => {
  assert.match(ui, /Supplier finances/);
  assert.match(ui, /businessWorkspaceSelect/);
  assert.match(ui, /\/api\/accounting\/active-workspace/);
  assert.match(shell, /Finance & Accounting/);
  assert.match(shell, /data-business-accounting-tile="true"/);
  assert.match(ui, /wireSupplierAccountingTile/);
  assert.doesNotMatch(ui, /grid\.prepend\(tile\)/);
});
