import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qaAcceptanceConfig, CUSTOMER_WAVE } from '../qa-acceptance.js';

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true',
  OWNER_MIGRATION_ENABLED:'false',
  QA_AUTOMATION_SECRET:'x'.repeat(48),
  QA_ACCEPTANCE_WAVE:CUSTOMER_WAVE
};

test('QA acceptance is disabled unless a wave is explicitly requested',()=>{
  assert.equal(qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:''}).enabled,false);
});

test('QA acceptance is isolated from production and requires its own secret',()=>{
  assert.equal(qaAcceptanceConfig(safe).enabled,true);
  assert.throws(()=>qaAcceptanceConfig({...safe,RAILWAY_SERVICE_NAME:'accounting-business-life',APP_ENV:'production',DATABASE_URL:'postgresql://user:secret@example.test/accounting'}),/isolated|production/i);
  assert.throws(()=>qaAcceptanceConfig({...safe,QA_AUTOMATION_SECRET:''}),/automation secret/i);
  assert.throws(()=>qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:'unknown'}),/Unknown QA acceptance wave/i);
});

test('customer acceptance uses normal auth and profile endpoints without logging secrets',()=>{
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  assert.match(source,/\/api\/auth\/login/);
  assert.match(source,/\/api\/auth\/email-verification\/request/);
  assert.match(source,/\/api\/auth\/email-verification\/verify/);
  assert.match(source,/\/api\/profiles\/customer\/activate/);
  assert.match(source,/\/api\/context\/customer/);
  assert.match(source,/\/api\/profiles\/merchant/);
  assert.match(source,/\/api\/auth\/logout/);
  assert.match(source,/QA_ACCEPTANCE_RESULT/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:password|verifyToken|previewUrl|secret)/i);
});
