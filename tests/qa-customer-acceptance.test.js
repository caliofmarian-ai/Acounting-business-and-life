import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qaAcceptanceConfig, CUSTOMER_WAVE, CUSTOMER_MARKETPLACE_WAVE, CUSTOMER_EXPERIENCE_WAVE } from '../qa-acceptance.js';

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


test('Customer Marketplace E2E wave is isolated and exercises the complete controlled commerce loop',()=>{
  const cfg=qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:CUSTOMER_MARKETPLACE_WAVE});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,CUSTOMER_MARKETPLACE_WAVE);
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  for(const marker of [
    '/api/marketplace/storefronts/',
    '/api/marketplace/checkout',
    '/check-in',
    '/confirm-presence',
    '/start',
    '/ready',
    '/payment',
    '/complete',
    '/api/orders/mine',
    '/api/orders/track/',
    'order_stock_consumptions',
    "fulfilment_method:'pickup'",
    "payment_method:'cash'",
    "['Water',200]",
    "['Fish',62.5]",
    "['Carrot',525]",
    "['Parsley',2.5]",
    "['Bottled Juice',1]",
    "['Dish Soap',1]"
  ])assert.ok(source.includes(marker),`missing Customer Marketplace QA marker: ${marker}`);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:password|verifyToken|previewUrl|secret)/i);
});


test('Customer Experience QA wave covers recovery Money notifications Support privacy and delivery fail-closed',()=>{
  const cfg=qaAcceptanceConfig({...safe,QA_ACCEPTANCE_WAVE:CUSTOMER_EXPERIENCE_WAVE});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,CUSTOMER_EXPERIENCE_WAVE);
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  for(const marker of [
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    "template_code='password_reset'",
    '/api/profile-money/customer',
    '/api/notifications?limit=100',
    '/api/notifications/',
    '/api/support/tickets',
    '/api/support/tickets/mine',
    "category:'privacy_access'",
    "requested_destination:'territory_admin'",
    "related_type:'privacy_rights'",
    'Cross-account privacy ticket denial',
    "fulfilment_method:'delivery'",
    'Delivery-disabled checkout guard',
    "full_delivery_e2e:'HOLD_FOR_COURIER_WAVE'"
  ])assert.ok(source.includes(marker),`missing Customer Experience QA marker: ${marker}`);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:password|resetToken|previewUrl|recoveryPassword|secret)/i);
});
