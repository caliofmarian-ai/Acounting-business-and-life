import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAcceptanceConfig,QA_ACCEPTANCE_CONSTANTS} from '../qa-acceptance.js';

const qa=readFileSync(new URL('../qa-supplier-operating-location-v1.js',import.meta.url),'utf8');

test('Supplier operating-location Preview acceptance wave is registered',()=>{
  assert.equal(QA_ACCEPTANCE_CONSTANTS.SUPPLIER_OPERATING_LOCATION_V1_WAVE,'supplier_operating_location_v1');
  const cfg=qaAcceptanceConfig({
    QA_ACCEPTANCE_WAVE:'supplier_operating_location_v1',
    QA_AUTOMATION_SECRET:'x'.repeat(40),
    APP_ENV:'qa',
    RAILWAY_SERVICE_NAME:'accounting-preview',
    PGDATABASE:'accounting_qa_test',
    DATABASE_URL:'postgres://user:pass@localhost/accounting_qa_test'
  });
  assert.equal(cfg.wave,'supplier_operating_location_v1');
});

test('Supplier operating-location acceptance verifies privacy opt-in and business isolation',()=>{
  assert.match(qa,/visibility:'private'/);
  assert.match(qa,/operating_location_address/);
  assert.match(qa,/visibility:'relationships'/);
  assert.match(qa,/business_isolation_verified:true/);
  assert.match(qa,/reset_to_personal_default:true/);
});
