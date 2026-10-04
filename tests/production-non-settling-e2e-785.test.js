import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-non-settling-e2e-785.js',import.meta.url),'utf8');

test('Production non-settling E2E is Production-only, company-test scoped and rollback-only',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/RAILWAY_SERVICE_NAME!=='accounting-business-life'/);
  assert.match(script,/account_mode!=='company_test'/);
  assert.match(script,/visibility!=='private'/);
  assert.match(script,/psgc_code!=='0402103028'/);
  assert.match(script,/client\.query\('BEGIN'\)/);
  assert.match(script,/client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(script,/client\.query\('COMMIT'\)/);
  assert.doesNotMatch(script,/\bfetch\s*\(/);
});

test('Production non-settling E2E traverses supply order courier payment and held settlement',()=>{
  for(const marker of [
    'purchase_orders','purchase_receipts','orders','order_status_events','deliveries',
    'delivery_dispatch_events','payment_intents','payment_allocations','settlements','settlement_lines',
    "'received'","'completed'","'delivered'","'succeeded'","'held'","'paid'"
  ])assert.ok(script.includes(marker),'missing E2E lifecycle marker: '+marker);
  assert.match(script,/company_test_non_settling/);
  assert.match(script,/paid_settlements:0/);
  assert.match(script,/provider_call:false/);
  assert.match(script,/real_money:false/);
});

test('Production non-settling E2E includes cancellation and failed-payment no-settlement path',()=>{
  assert.match(script,/Controlled cancellation path/);
  assert.match(script,/'cancelled'/);
  assert.match(script,/synthetic_failure/);
  assert.match(script,/CONTROLLED_FAILURE/);
  assert.match(script,/failed_path_allocations:0/);
  assert.match(script,/failed_path_allocations:0/);
});

test('Production non-settling E2E proves zero residue after rollback',()=>{
  assert.match(script,/Rollback left synthetic Production lifecycle residue/);
  assert.match(script,/residue:false/);
  assert.match(script,/PRODUCTION_NON_SETTLING_E2E_785_RESULT/);
});
