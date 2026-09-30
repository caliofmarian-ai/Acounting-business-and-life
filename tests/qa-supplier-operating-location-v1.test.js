import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAcceptanceConfig,SUPPLIER_OPERATING_LOCATION_V1_WAVE} from '../qa-acceptance.js';

const qa=readFileSync(new URL('../qa-supplier-operating-location-v1.js',import.meta.url),'utf8');

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

test('Supplier operating-location Preview acceptance wave is registered',()=>{
  const cfg=qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:SUPPLIER_OPERATING_LOCATION_V1_WAVE});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,'supplier_operating_location_v1');
});

test('Supplier operating-location acceptance verifies privacy opt-in and business isolation',()=>{
  assert.match(qa,/visibility:'private'/);
  assert.match(qa,/operating_location_address/);
  assert.match(qa,/visibility:'relationships'/);
  assert.match(qa,/business_isolation_verified:true/);
  assert.match(qa,/reset_to_personal_default:true/);
});
