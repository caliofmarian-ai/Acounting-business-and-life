import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAcceptanceConfig,SERVICE_PROVIDER_BASE_LOCATION_V1_WAVE} from '../qa-acceptance.js';

const source=readFileSync(new URL('../qa-service-provider-base-location-v1.js',import.meta.url),'utf8');

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

test('Local Services base-location Preview wave is registered only for isolated QA',()=>{
  const cfg=qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:SERVICE_PROVIDER_BASE_LOCATION_V1_WAVE});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,'service_provider_base_location_v1');
});

test('Local Services base-location acceptance verifies private default, public opt-in and job-address isolation',()=>{
  assert.match(source,/visibility:'private'/);
  assert.match(source,/visibility:'public'/);
  assert.match(source,/service_radius_km/);
  assert.match(source,/service_location!==null/);
  assert.match(source,/exact_location_available!==false/);
  assert.match(source,/private_base_protected:true/);
  assert.match(source,/public_opt_in_verified:true/);
  assert.match(source,/customer_job_location_still_scoped:true/);
  assert.match(source,/reset_to_personal_default:true/);
});
