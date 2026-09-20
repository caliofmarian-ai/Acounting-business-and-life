import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qaAcceptanceConfig, MERCHANT_CATALOG_WAVE } from '../qa-acceptance.js';

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true',
  OWNER_MIGRATION_ENABLED:'false',
  QA_AUTOMATION_SECRET:'x'.repeat(48),
  QA_ACCEPTANCE_WAVE:MERCHANT_CATALOG_WAVE
};

test('Merchant catalog seed wave is accepted only in isolated QA',()=>{
  const cfg=qaAcceptanceConfig(safe);
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,MERCHANT_CATALOG_WAVE);
  assert.throws(()=>qaAcceptanceConfig({...safe,DATABASE_URL:'postgresql://user:secret@example.test/accounting'}),/isolated|QA/i);
});

test('Merchant seed exercises normal onboarding before creating catalog fixtures',()=>{
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  assert.match(source,/\/api\/governance\/profiles\/merchant\/start/);
  assert.match(source,/\/api\/governance\/applications\/\$\{Number\(application\.id\)\}\/submit/);
  assert.match(source,/\/api\/governance\/admin\/applications\/\$\{Number\(application\.id\)\}\/review/);
  assert.match(source,/decision:'approve'/);
  assert.match(source,/\/api\/me\/active-role/);
});

test('Merchant seed builds all catalog behavior fixtures and AI reference media',()=>{
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  for(const item of ['Water','Fish','Carrot','Parsley','Bottled Juice','Dish Soap'])assert.match(source,new RegExp(item));
  assert.match(source,/QA Fish Soup/);
  assert.match(source,/yield_quantity:1/);
  assert.match(source,/selling_quantity:250/);
  assert.match(source,/fresh_direct/);
  assert.match(source,/packaged_resale/);
  assert.match(source,/non_food_resale/);
  assert.match(source,/\/images\/generate/);
  assert.match(source,/\/approve/);
  assert.match(source,/image_source_type!=='ai_generated'/);
});

test('Merchant seed keeps financial fixture stock from pretending to be real paid purchases',()=>{
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  assert.match(source,/record_expense:false/);
  assert.match(source,/Controlled QA catalog fixture — no real purchase/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:password|verifyToken|previewUrl|secret)/i);
});
