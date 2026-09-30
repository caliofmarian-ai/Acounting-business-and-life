import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS,
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const services=read('public/services-ui.js');
const shell=read('public/shell.js');
const settings=read('public/profile-settings-ui.js');
const server=read('server-services.js');
const money=read('profile-money-core.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Local Services has its own complete versioned V2 journey',()=>{
  for(const role of ['customer','merchant','supplier','courier','service_provider']){
    assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS[role].version,2,role);
  }
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.service_provider.steps,GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS);
  assert.match(core,/journey_version DESC LIMIT 1/);
  assert.match(core,/normalizeProfileCompleted\(previousRow\.completed_steps,role\)/);
});

test('Local Services privacy evidence money and safety education precede Profile Settings',()=>{
  assert.deepEqual(GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS,[
    'profile_welcome',
    'service_readiness_credentials',
    'service_visibility_area',
    'service_offers_pricing',
    'service_quotes_changes',
    'service_jobs_privacy',
    'service_work_evidence_consent',
    'service_money_payments',
    'service_safety_compliance',
    'profile_settings'
  ]);
  const settings=GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS.indexOf('profile_settings');
  for(const step of ['service_jobs_privacy','service_work_evidence_consent','service_money_payments','service_safety_compliance']){
    assert.ok(GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS.indexOf(step)<settings,step);
  }
});

test('Local Services coachmarks use real profile service quote job money and settings controls',()=>{
  for(const marker of [
    'PROVIDER_SECTION_META','id="serviceReadinessForm"','id="serviceOperatingContext"',
    'id="providerProfileForm"','id="providerArea"','id="providerVisibility"',
    'id="providerServicesForm"','data-service-category','data-job-action',
    'id="providerJobs"','id="addCredential"'
  ])assert.ok(services.includes(marker),marker);
  assert.match(shell,/data-service-provider-nav="money"/);
  assert.match(shell,/data-service-provider-home-money/);
  assert.match(settings,/data-profile-settings-view="finance"/);
  assert.match(settings,/id="openAccountMoneyFromProfile"/);
  assert.match(ui,/serviceProviderJourneyTarget\('#providerProfileForm'/);
  assert.match(ui,/serviceProviderJourneyTarget\('\[data-service-provider-section="Quotes"\]'/);
  assert.match(ui,/serviceProviderJourneyTarget\('\[data-service-provider-section="Jobs"\]'/);
});

test('Local Services tour mirrors quote version, exact-address and publication-consent boundaries already enforced by runtime',()=>{
  assert.match(services,/Guide prices are not a final bill/);
  assert.match(services,/exact, itemised quote must be accepted before work starts/i);
  assert.match(services,/Exact address available for active fulfilment/);
  assert.match(services,/Exact address private/);
  assert.match(server,/customer_publication_consent BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(server,/linked_job_id IS NULL OR p\.customer_publication_consent=TRUE/);
});

test('Local Services money copy follows canonical payment and settlement authority',()=>{
  assert.match(money,/Completed job value is a commercial amount, not proof that money was received/);
  assert.match(money,/Customer payment success and Service Provider payout\/settlement are separate facts/);
  assert.match(money,/netAllocations\(pool,'service_provider_net',accountId\)/);
  assert.match(en['service_tour.money_body'],/commercial value, not proof that money was received/i);
  assert.match(en['service_tour.money_body'],/service_provider_net/);
});

test('Local Services tutorial does not invent licence requirements and points to versioned Compliance & Training guidance',()=>{
  assert.match(en['service_tour.readiness_body'],/not a government or professional licence/i);
  assert.match(en['service_tour.readiness_body'],/must not invent a licence requirement/i);
  assert.match(en['service_tour.readiness_body'],/Compliance & Training guidance/i);
  assert.match(en['service_tour.safety_body'],/versioned Compliance & Training guidance/i);
});

test('Local Services location and media copy preserves private-base, job-address and consent boundaries',()=>{
  assert.match(en['service_tour.visibility_body'],/private home or workshop address/i);
  assert.match(en['service_tour.visibility_body'],/exact address private by default/i);
  assert.match(en['service_tour.visibility_body'],/Customer job address is separate/i);
  assert.match(en['service_tour.jobs_body'],/exact Customer service address is released only for active fulfilment/i);
  assert.match(en['service_tour.jobs_body'],/each access is logged/i);
  assert.match(en['service_tour.evidence_body'],/Before\/after photos/i);
  assert.match(en['service_tour.evidence_body'],/Customer publication consent/i);
  assert.match(en['service_tour.evidence_body'],/job completion as media or promotion consent/i);
});

test('Local Services journey is explanatory only and never changes profile quote job money or consent state automatically',()=>{
  const start=ui.indexOf('function serviceProviderProfileJourneyDefinition');
  const end=ui.indexOf('function profileJourneyDefinition',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/\.click\(|fetch\(|sapi\(|profileApi\(|active-role|applyActiveRole|toggleProfile/);
  assert.doesNotMatch(block,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|JSON\.stringify\s*\(/i);
});

test('Every Local Services onboarding key has Filipino copy without internal territory mechanics',()=>{
  const keys=Object.keys(en).filter(k=>k.startsWith('service_tour.'));
  assert.ok(keys.length>=24);
  for(const key of keys){
    assert.ok(fil[key],'missing Filipino key '+key);
    assert.doesNotMatch(en[key],/PSGC|territory demand|expansion signal|re-detection/i);
    assert.doesNotMatch(fil[key],/PSGC|territory demand|expansion signal|re-detection/i);
  }
});

test('Local Services dispatcher uses the profile-specific journey before generic fallback',()=>{
  const start=ui.indexOf('function profileJourneyDefinition');
  const end=ui.indexOf('function renderProfileJourney',start);
  const block=ui.slice(start,end);
  assert.match(block,/if\(role==='service_provider'\)/);
  assert.match(block,/serviceProviderProfileJourneyDefinition\(journey,label\)/);
});
