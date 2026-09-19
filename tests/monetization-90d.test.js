import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PROMOTIONAL_DAYS,DELIVERY_PROMOTIONAL_DAYS,MONETIZATION_PROMO_DAYS_BY_SCOPE,promoDaysForScope,MONETIZATION_SERVICE_SCOPES,MONETIZATION_SUBJECT_TYPES,monetizationInternals
} from '../monetization-core.js';

const core=readFileSync(new URL('../monetization-core.js',import.meta.url),'utf8');
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const delivery=readFileSync(new URL('../server-delivery.js',import.meta.url),'utf8');
const supplier=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');
const services=readFileSync(new URL('../server-services.js',import.meta.url),'utf8');
const payments=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const finance=readFileSync(new URL('../finance-core.js',import.meta.url),'utf8');

test('Owner promotional policy is service-specific: Merchant 90 days and Delivery 30 days',()=>{
  assert.equal(PROMOTIONAL_DAYS,90);
  assert.equal(DELIVERY_PROMOTIONAL_DAYS,30);
  assert.deepEqual(MONETIZATION_PROMO_DAYS_BY_SCOPE,{marketplace:90,delivery:30,supplier:90,local_services:90});
  assert.equal(promoDaysForScope('marketplace'),90);
  assert.equal(promoDaysForScope('delivery'),30);
  assert.equal(promoDaysForScope('supplier'),90);
  assert.equal(promoDaysForScope('local_services'),90);
  assert.deepEqual(MONETIZATION_SERVICE_SCOPES,['marketplace','delivery','supplier','local_services']);
  assert.deepEqual(MONETIZATION_SUBJECT_TYPES,['business','account']);
  assert.match(core,/service_scope='delivery' AND promo_duration_days=30/);
  assert.match(core,/service_scope<>'delivery' AND promo_duration_days=90/);
});

test('one promotional entitlement exists per economic subject and service scope',()=>{
  assert.match(core,/UNIQUE\(country_code,service_scope,subject_type,subject_id\)/);
  assert.match(core,/subject_type TEXT NOT NULL/);
  assert.match(core,/subject_id BIGINT NOT NULL/);
  assert.doesNotMatch(core,/login_session|session_id|email TEXT/);
});

test('trial starts from earliest completed economic event and cannot restart on retry',()=>{
  assert.match(core,/promo_started_at=LEAST/);
  assert.match(core,/promo_duration_days=\$5/);
  assert.match(core,/promo_ends_at=LEAST\([^\n]+promo_started_at[^\n]+\)\+\(\$5::text\|\|' days'\)::interval/);
  assert.match(core,/event_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/ON CONFLICT\(event_key\)/);
  assert.doesNotMatch(core,/DELETE FROM service_monetization_entitlements/);
  assert.doesNotMatch(core,/DELETE FROM service_monetization_events/);
});


test('schema migration recalibrates existing Delivery entitlements to 30 days without restarting them',()=>{
  assert.match(core,/DO \$promo\$/);
  assert.match(core,/END \$promo\$;/);
  assert.match(core,/UPDATE service_monetization_entitlements[\s\S]*service_scope='delivery' THEN 30 ELSE 90/);
  assert.match(core,/promo_ends_at=promo_started_at\+\(CASE WHEN service_scope='delivery' THEN INTERVAL '30 days' ELSE INTERVAL '90 days' END\)/);
  assert.match(core,/UPDATE service_monetization_events e[\s\S]*phase_snapshot=CASE WHEN e\.completed_at<x\.promo_ends_at THEN 'promotional' ELSE 'post_promo' END/);
  assert.match(core,/first_post_promo_completed_at=\([\s\S]*phase_snapshot='post_promo'/);
  assert.doesNotMatch(core,/promo_started_at=NOW\(\)/);
});

test('historical backfill can correct phase snapshots if an earlier completion is discovered',()=>{
  assert.match(core,/UPDATE service_monetization_events SET phase_snapshot=/);
  assert.match(core,/ORDER BY completed_at,id LIMIT 1/);
  assert.match(core,/first_post_promo_completed_at/);
});

test('monetization schema is safe for early child-service startup before territories exists',()=>{
  assert.doesNotMatch(core,/territory_id BIGINT REFERENCES territories/);
  assert.match(core,/territory_id BIGINT/);
  for(const src of [orders,delivery,supplier,services])assert.match(src,/ensureMonetizationSchema\(pool\)/);
});

test('Marketplace trial starts only from completed Merchant order activity',()=>{
  assert.match(orders,/api\/orders\/merchant\/:id\/complete/);
  assert.match(orders,/recordMonetizableCompletion\(client,\{serviceScope:'marketplace',subjectType:'business'/);
  assert.match(orders,/completedAt:done\.rows\[0\]\?\.completed_at/);
});

test('Delivery completion starts both Merchant marketplace and Courier delivery cohorts',()=>{
  assert.match(delivery,/status='delivered'/);
  assert.match(delivery,/serviceScope:'marketplace',subjectType:'business'/);
  assert.match(delivery,/serviceScope:'delivery',subjectType:'account'/);
  assert.match(delivery,/sourceType:'delivery'/);
});

test('Supplier promotional start waits for a fully received PO',()=>{
  assert.match(supplier,/if\(status==='received'\)/);
  assert.match(supplier,/serviceScope:'supplier',subjectType:'account'/);
  assert.match(supplier,/sourceType:'purchase_order'/);
  assert.doesNotMatch(supplier,/if\(status==='partially_received'\)[^]*recordMonetizableCompletion/);
});

test('Local Services promotional start requires Customer-confirmed completion',()=>{
  assert.match(services,/api\/services\/jobs\/:id\/confirm-completion/);
  assert.match(services,/customer_confirmed_at=COALESCE\(customer_confirmed_at,NOW\(\)\)/);
  assert.match(services,/serviceScope:'local_services',subjectType:'account'/);
  assert.match(services,/sourceType:'service_job'/);
});

test('Payment/Finance layer backfills existing canonical history and reports real cohort KPIs',()=>{
  assert.match(payments,/ensureMonetizationSchema\(pool\)/);
  assert.match(payments,/backfillMonetizationHistory\(pool\)/);
  assert.match(finance,/promotionKpi\(pool,\{\.\.\.p,territoryId\}\)/);
  assert.match(finance,/promotion_economics:\{\.\.\.promotion,direct_cost:promotionDirectCost\}/);
  assert.match(core,/paid_conversion_status:'NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY'/);
});

test('phase boundary is promotional before the service end instant and post-promo at the exact end instant',()=>{
  assert.equal(monetizationInternals.phaseAt('2026-01-30T23:59:59Z','2026-01-31T00:00:00Z'),'promotional');
  assert.equal(monetizationInternals.phaseAt('2026-01-31T00:00:00Z','2026-01-31T00:00:00Z'),'post_promo');
  assert.equal(monetizationInternals.promoDaysForScope('delivery'),30);
  assert.equal(monetizationInternals.promoDaysForScope('marketplace'),90);
  assert.equal(monetizationInternals.eventKey({serviceScope:'marketplace',subjectType:'business',subjectId:7,sourceType:'order',sourceId:12}),'marketplace:business:7:order:12');
});
