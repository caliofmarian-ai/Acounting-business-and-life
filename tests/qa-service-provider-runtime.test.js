import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const qa=read('qa-acceptance.js');
const service=read('qa-service-provider-acceptance.js');

test('Service Provider runtime wave is isolated and wired through canonical QA acceptance',()=>{
  assert.match(qa,/runServiceProviderExperienceAcceptance/);
  assert.match(qa,/SERVICE_PROVIDER_EXPERIENCE_WAVE='service_provider_experience_v1'/);
  assert.match(qa,/SERVICE_PROVIDER_ALIAS='dropi\.deliveries\+testservice@gmail\.com'/);
  assert.match(qa,/TERRITORY_ADMIN_ALIAS='dropi\.deliveries\+testterritoryadmin@gmail\.com'/);
  assert.match(qa,/config\.wave===SERVICE_PROVIDER_EXPERIENCE_WAVE/);
  assert.match(qa,/validateRuntimeSafety/);
  assert.match(qa,/isolated accounting-preview QA database/);
});

test('Service Provider QA uses self-application and non-credential-gated handyman category',()=>{
  assert.match(service,/\/api\/governance\/service-provider\/start/);
  assert.match(service,/invitation_id/);
  assert.match(service,/self-application unexpectedly requires an invitation/);
  assert.match(service,/code='handyman'/);
  assert.match(service,/credential_gate===true/);
  assert.match(service,/requested_category_ids:\[Number\(categoryId\)\]/);
  assert.doesNotMatch(service,/prc_license|tesda_nc_coc/);
});

test('Local Services runtime proves request through customer-confirmed completion',()=>{
  for(const route of [
    '/api/services/jobs',
    '/api/service-provider/jobs/',
    '/quote',
    '/accept-quote',
    '/status',
    '/confirm-completion'
  ]) assert.match(service,new RegExp(route.replaceAll('/','\\/')));
  assert.match(service,/status:'scheduled'/);
  assert.match(service,/status:'in_progress'/);
  assert.match(service,/status:'completed',final_price:SERVICE_FINAL_PRICE/);
  assert.match(service,/customer_confirmed_at/);
});

test('verified review boundary is denied before Customer confirmation and allowed after',()=>{
  const start=service.indexOf('export async function runServiceProviderExperienceAcceptance');
  assert.ok(start>=0);
  const run=service.slice(start);
  const blocked=run.indexOf("Premature Local Services review denial");
  const confirm=run.indexOf("Customer Local Services completion confirmation");
  const allowed=run.indexOf("const reviewId=await ensureServiceReview");
  assert.ok(blocked>=0&&confirm>blocked&&allowed>confirm);
  assert.match(run,/expectStatus\(prematureReview,409/);
});

test('credential authority proves ordinary denial, territory denial, in-scope allow and audit evidence',()=>{
  assert.match(service,/Ordinary Customer credential-review denial/);
  assert.match(service,/Out-of-scope credential-review denial/);
  assert.match(service,/In-scope credential verification/);
  assert.match(service,/permissions:\['credential\.verify'\]/);
  assert.match(service,/event_code='service_credential\.reviewed'/);
  assert.match(service,/permission_code!=='credential\.verify'/);
  assert.match(service,/territory_id\)!==Number\(territoryId\)/);
  assert.match(service,/verified_by_account_id/);
  assert.match(service,/verified_at/);
});

test('Service Provider QA keeps Money commercial truth separate from settlement evidence',()=>{
  assert.match(service,/\/api\/profile-money\/service_provider/);
  assert.match(service,/confirmed_job_value/);
  assert.match(service,/component_code='service_provider_net'/);
  assert.match(service,/HOLD_NO_SERVICE_PROVIDER_NET/);
  assert.match(service,/provider_payout_settlement:'HOLD_FOR_PROVIDER_EVIDENCE'/);
  assert.doesNotMatch(service,/delivery_fee.*service_provider_net/i);
});

test('Local Services 90-day promotion and notifications/support/settings/session are covered',()=>{
  assert.match(service,/service_scope='local_services'/);
  assert.match(service,/promo_duration_days\)!==90/);
  assert.match(service,/service\.request_created/);
  assert.match(service,/service\.quote_created/);
  assert.match(service,/service\.quote_accepted/);
  assert.match(service,/service\.status_changed/);
  assert.match(service,/\/api\/settings\/finance/);
  assert.match(service,/\/api\/support\/tickets/);
  assert.match(service,/Service Provider Experience final re-login/);
});
