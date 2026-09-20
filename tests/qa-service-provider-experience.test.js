import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dispatcher=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const service=readFileSync(new URL('../qa-service-provider-acceptance.js',import.meta.url),'utf8');

test('Service Provider experience wave is registered on the isolated QA runner',()=>{
  assert.match(dispatcher,/SERVICE_PROVIDER_ALIAS='dropi\.deliveries\+testservice@gmail\.com'/);
  assert.match(dispatcher,/SERVICE_PROVIDER_EXPERIENCE_WAVE='service_provider_experience_v1'/);
  assert.match(dispatcher,/runServiceProviderExperienceAcceptance/);
  assert.match(dispatcher,/config\.wave===SERVICE_PROVIDER_EXPERIENCE_WAVE/);
});

test('Local Services acceptance uses self-application without inventing an invitation',()=>{
  assert.match(service,/\/api\/governance\/service-provider\/start/);
  assert.match(service,/invitation_id/);
  assert.match(service,/unexpectedly requires an invitation/);
  assert.match(service,/requested_category_ids:\[Number\(categoryId\)\]/);
  assert.match(service,/approved_category_ids:\[Number\(categoryId\)\]/);
  assert.match(service,/code='handyman'/);
  assert.match(service,/credential_gate===true/);
});

test('Local Services acceptance covers request quote execution confirmation and verified review',()=>{
  for(const marker of [
    '/api/services/providers',
    '/api/services/jobs',
    '/api/service-provider/jobs/',
    '/quote',
    '/accept-quote',
    'scheduled',
    'in_progress',
    'completed',
    '/confirm-completion',
    '/review'
  ]) assert.ok(service.includes(marker),'missing Local Services marker: '+marker);
  assert.match(service,/customer_confirmed_completion:true/);
  assert.match(service,/verified_review_id:reviewId/);
});

test('Service Provider Finance preserves commercial-value versus settlement boundary',()=>{
  assert.match(service,/\/api\/profile-money\/service_provider/);
  assert.match(service,/component_code='service_provider_net'/);
  assert.match(service,/HOLD_NO_SERVICE_PROVIDER_NET/);
  assert.match(service,/online_service_payment:'HOLD_UNSUPPORTED_RUNTIME_FLOW'/);
  assert.match(service,/provider_payout_settlement:'HOLD_FOR_PROVIDER_EVIDENCE'/);
  assert.doesNotMatch(service,/UPDATE payment_intents SET status='succeeded'/);
  assert.doesNotMatch(service,/UPDATE service_jobs SET .*paid/);
});

test('Local Services acceptance preserves 90-day scope-specific promo plus notifications settings and Support',()=>{
  assert.match(service,/service_scope='local_services'/);
  assert.match(service,/promo_duration_days\)!==90/);
  assert.match(service,/promotional_days:90/);
  assert.match(service,/service\.request_created/);
  assert.match(service,/service\.quote_created/);
  assert.match(service,/service\.quote_accepted/);
  assert.match(service,/service\.status_changed/);
  assert.match(service,/\/api\/settings\/finance/);
  assert.match(service,/\/api\/support\/tickets/);
});
