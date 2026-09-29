import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAcceptanceConfig,SUPPLIER_BUSINESS_ATTRIBUTION_V2E_WAVE} from '../qa-acceptance.js';

const source=readFileSync(new URL('../qa-supplier-business-attribution-v2e.js',import.meta.url),'utf8');

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  TOKEN_SECRET:'x'.repeat(48),
  QA_AUTOMATION_SECRET:'q'.repeat(48),
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true',
  OWNER_MIGRATION_ENABLED:'false'
};

test('Supplier business attribution V2E wave is registered only for isolated QA',()=>{
  const cfg=qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:SUPPLIER_BUSINESS_ATTRIBUTION_V2E_WAVE});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,'supplier_business_attribution_v2e');
});

test('Supplier V2E Preview acceptance proves two-business isolation and restores the baseline',()=>{
  assert.match(source,/Business & Life QA Supply B V2E/);
  assert.match(source,/profile_business_bindings/);
  assert.match(source,/account_business_preferences/);
  assert.match(source,/api\/procurement\/relationships\/invite/);
  assert.match(source,/api\/procurement\/orders\?business_id=/);
  assert.match(source,/api\/accounting\/finance-overview\?business_id=/);
  assert.match(source,/api\/supplier\/v5\/today\?business_id=/);
  assert.match(source,/Supplier business B could read business A PO detail/);
  assert.match(source,/Supplier payment receipt business mismatch: actual/);
  assert.match(source,/RAILWAY_GIT_COMMIT_SHA/);
  assert.match(source,/relationship_restored_to_business_a:true/);
  assert.match(source,/qa_revision:qaRevision/);
});

test('Supplier V2E acceptance never claims provider payout evidence',()=>{
  assert.doesNotMatch(source,/provider payout succeeded|bank settled/i);
});
