import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync(new URL('../payment-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/payments-ui.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin-authorization.js',import.meta.url),'utf8');

test('payment core separates intents, provider events, allocations, refunds, settlements and reconciliation',()=>{
  for(const table of ['payment_provider_configs','payment_intents','payment_attempts','provider_events','payment_allocations','refunds','settlements','settlement_lines','reconciliation_runs','reconciliation_items','payment_audit_events']){
    assert.ok(core.includes('CREATE TABLE IF NOT EXISTS '+table),table+' must exist');
  }
});

test('client-side intent creation cannot claim payment success without a real provider',()=>{
  assert.match(core,/requires_provider/);
  assert.match(server,/CONNECT_REAL_PAYMENT_PROVIDER/);
  assert.match(server,/No verified payment-provider adapter is installed/);
  assert.match(server,/Client success pages are never payment authority/);
  assert.doesNotMatch(server,/api\/payments\/intents\/order\/:id[\s\S]{0,1500}status='succeeded'/);
});

test('payment intents and legacy mirrors are idempotent and do not double-post accounting revenue',()=>{
  assert.match(core,/idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/order_payments_payment_intent_unique/);
  assert.match(core,/legacy-order-payment:/);
  assert.match(server,/mirrorConfirmedOrderPayment/);
  assert.doesNotMatch(core,/INSERT INTO transactions/);
});

test('provider evidence storage redacts sensitive payment and identity fields',()=>{
  assert.match(core,/secret\|password\|token\|authorization\|card\|pan\|cvv\|cvc\|expiry/i);
  assert.match(core,/\[redacted\]/);
  assert.match(core,/payload_sha256/);
  assert.match(core,/signature_verified BOOLEAN/);
});

test('platform and operator fee policy exists only as versioned draft-capable configuration',()=>{
  assert.match(core,/fee_policy_versions/);
  assert.match(core,/fee_policy_rules/);
  assert.match(core,/protected_platform_policy/);
  assert.match(core,/status TEXT NOT NULL DEFAULT 'draft'/);
  assert.doesNotMatch(server,/fee-policies\/:id\/activate/);
  assert.match(ui,/No platform\/operator fee is invented/);
});

test('refunds and reconciliation stay non-authoritative until provider adapters are installed',()=>{
  assert.match(core,/status TEXT NOT NULL DEFAULT 'requested'/);
  assert.match(server,/PROVIDER_REFUND_ADAPTER_REQUIRED/);
  assert.match(core,/statement_adapter_pending/);
  assert.match(core,/manual_review/);
});

test('manual Merchant-confirmed order payments are mirrored after canonical success, not re-executed',()=>{
  assert.match(server,/app\.post\('\/api\/orders\/merchant\/:id\/payment'/);
  assert.match(server,/Promise\.resolve\(\)\.then/);
  assert.match(server,/Payment mirror hook/);
  assert.match(core,/UPDATE order_payments SET payment_intent_id/);
});

test('payment administration uses explicit scoped permissions',()=>{
  for(const p of ["'payment.view'","'payment.manage'","'payment.reconcile'","'settlement.manage'","'fee_policy.manage_limited'"])assert.ok(admin.includes(p),p+' permission missing');
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'payment\.view'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'payment\.reconcile'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'fee_policy\.manage_limited'/);
});

test('Payment Center clearly exposes provider readiness instead of fake checkout',()=>{
  assert.match(ui,/Online provider not connected/);
  assert.match(ui,/Provider-authoritative payments/);
  assert.match(ui,/Creating an intent never marks the order paid/);
  assert.match(ui,/Finance Admin/);
});
