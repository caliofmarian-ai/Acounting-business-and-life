import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SERVICE_LOCATION_ACTIVE_STATUSES,
  coarseServiceAreaFromGeography,
  ensureServiceLocationPrivacySchema,
  providerExactLocationAvailable,
  redactProviderServiceJob,
  requireProviderExactLocation
} from '../service-location-privacy-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('server-services.js');
const ui=read('public/services-ui.js');
const qa=read('qa-service-provider-acceptance.js');

test('provider payloads fail closed and never contain the exact service location',()=>{
  const exact='21 Private Street, Customer Home';
  for(const status of ['requested','provider_reviewing','quoted','completed','cancelled','disputed']){
    const view=redactProviderServiceJob({id:9,status,service_location:exact});
    assert.equal(view.service_location,null);
    assert.equal(view.exact_location_available,false);
    assert.doesNotMatch(JSON.stringify(view),/21 Private Street/);
  }
  for(const status of SERVICE_LOCATION_ACTIVE_STATUSES){
    const view=redactProviderServiceJob({id:9,status,service_location:exact});
    assert.equal(view.service_location,null);
    assert.equal(view.exact_location_available,true);
    assert.doesNotMatch(JSON.stringify(view),/21 Private Street/);
  }
  assert.equal(providerExactLocationAvailable({status:'accepted',service_location:''}),false);
});

test('exact location requires assigned Provider ownership and an active accepted job',()=>{
  const job={id:7,provider_account_id:42,status:'accepted',service_location:'Exact QA address'};
  assert.equal(requireProviderExactLocation(job,42),'Exact QA address');
  assert.throws(()=>requireProviderExactLocation(job,41),error=>error.status===404&&error.code==='SERVICE_JOB_NOT_FOUND');
  for(const status of ['requested','provider_reviewing','quoted','completed','cancelled','disputed']){
    assert.throws(
      ()=>requireProviderExactLocation({...job,status},42),
      error=>error.status===409&&error.code==='SERVICE_LOCATION_PURPOSE_EXPIRED'
    );
  }
  assert.throws(
    ()=>requireProviderExactLocation({...job,service_location:''},42),
    error=>error.status===409&&error.code==='SERVICE_LOCATION_UNAVAILABLE'
  );
});

test('coarse area is authoritative official geography and never parsed from a street address',()=>{
  const geography={assigned:true,name:'Alima',path_text:'CALABARZON › Cavite › City of Bacoor › Alima'};
  assert.equal(coarseServiceAreaFromGeography(geography),geography.path_text);
  assert.equal(coarseServiceAreaFromGeography({}, {companyTest:true}),'Controlled test area');
  assert.throws(()=>coarseServiceAreaFromGeography({}),error=>error.code==='SERVICE_COARSE_LOCATION_REQUIRED');
});

test('privacy schema backfills a neutral area and records privacy-minimised sensitive access',async()=>{
  const calls=[];
  await ensureServiceLocationPrivacySchema({query:async sql=>{calls.push(sql);return{rows:[]}}});
  const schema=calls.join('\n');
  assert.match(schema,/ADD COLUMN IF NOT EXISTS coarse_location/);
  assert.match(schema,/Area not recorded for this historical request/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS service_job_sensitive_access_events/);
  assert.match(schema,/exact_service_location_viewed/);
  assert.match(schema,/active_job_fulfilment/);
  assert.doesNotMatch(schema,/service_location TEXT|exact_address|street_address/);
});

test('Local Services API derives coarse geography, redacts Provider flows and audits exact access atomically',()=>{
  assert.match(server,/accountGeographySnapshot/);
  assert.match(server,/coarseServiceAreaFromGeography/);
  assert.match(server,/redactProviderServiceJob/);
  assert.match(server,/service_job_sensitive_access_events/);
  assert.match(server,/WHERE id=\$1 AND provider_account_id=\$2 FOR SHARE/);
  assert.match(server,/exact_service_location_viewed/);
  assert.match(server,/active_job_fulfilment/);
  assert.match(server,/app\.get\('\/api\/service-provider\/jobs\/:id\/exact-location'/);
  assert.doesNotMatch(server,/provider_reviewing':\['scheduled'/);
});

test('mobile UI separates public area from private address and only fetches exact location intentionally',()=>{
  assert.match(ui,/Area shown before quote acceptance/);
  assert.match(ui,/Exact service address/);
  assert.match(ui,/svcMe\?\.geography\?\.path_text/);
  assert.match(ui,/exact_location_available/);
  assert.match(ui,/View exact service address/);
  assert.match(ui,/\/exact-location/);
  assert.match(ui,/Access is logged and expires when this job is no longer active/);
});

test('Preview runtime QA proves denial then release then expiry and independent audit',()=>{
  const denied=qa.indexOf('Exact location before quote acceptance denial');
  const released=qa.indexOf('Exact location after quote acceptance');
  const expired=qa.indexOf('Exact location after completion denial');
  assert.ok(denied>=0&&released>denied&&expired>released);
  assert.match(qa,/service_job_sensitive_access_events/);
  assert.match(qa,/exact_service_location_viewed/);
  assert.match(qa,/active_job_fulfilment/);
  assert.match(qa,/service_location_privacy:true/);
});
