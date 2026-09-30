import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-services.js');
const ui=read('public/services-ui.js');
const guided=read('public/guided-onboarding.js');
const locationCore=read('service-location-privacy-core.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Local Services base is profile-scoped and defaults to no copied exact personal address',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS service_provider_operating_locations/);
  assert.match(server,/account_id BIGINT PRIMARY KEY REFERENCES accounts/);
  assert.match(server,/location_mode TEXT NOT NULL DEFAULT 'personal_default'/);
  assert.match(server,/visibility TEXT NOT NULL DEFAULT 'private'/);
  assert.match(server,/exact_address:''/);
  assert.match(server,/if\(mode==='personal_default'\)\{label='';address='';visibility='private'\}/);
});

test('Local Services keeps public service area/radius distinct from exact service base',()=>{
  assert.match(ui,/Public service area/);
  assert.match(ui,/Service radius km \(optional\)/);
  assert.match(ui,/Exact service-base address/);
  assert.match(ui,/Private — only me/);
  assert.match(ui,/Public on my Local Services profile/);
  assert.match(ui,/serviceBaseLocationForm/);
  assert.match(server,/service_radius_km NUMERIC\(8,2\)/);
  assert.match(server,/service_radius_km>=0 AND service_radius_km<=500/);
});

test('Exact service base is exposed publicly only after explicit separate plus public opt-in',()=>{
  assert.match(server,/loc\.location_mode='separate' AND loc\.visibility='public'.*loc\.location_label/s);
  assert.match(server,/loc\.location_mode='separate' AND loc\.visibility='public'.*loc\.exact_address/s);
  assert.match(server,/service_base_address/);
  assert.match(ui,/Publishing an exact base can reveal a home or private workplace/);
  assert.match(ui,/Choose Public only if you intentionally want Customers to see this address/);
});

test('Provider directory can show radius without leaking exact base address',()=>{
  const start=server.indexOf("app.get('/api/services/providers'");
  const end=server.indexOf("app.get('/api/services/providers/:accountId'",start);
  const block=server.slice(start,end);
  assert.match(block,/loc\.service_radius_km/);
  assert.doesNotMatch(block,/service_base_address|loc\.exact_address/);
});

test('Local Services base editor never captures GPS and keeps Customer job address separate',()=>{
  const start=ui.indexOf('function serviceBaseEditor');
  const end=ui.indexOf('function profileEditor',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/navigator\.geolocation|currentPosition|watchPosition/);
  assert.match(block,/Customer job addresses remain separate, job-scoped and audited/);
  assert.match(locationCore,/service_location:null/);
  assert.match(locationCore,/exact_location_available/);
});

test('Guided onboarding targets the real base control and explains all three location concepts',()=>{
  assert.match(guided,/#serviceBaseLocationForm/);
  assert.match(en['service_tour.visibility_body'],/public service area and optional radius/i);
  assert.match(en['service_tour.visibility_body'],/exact service base is a separate override/i);
  assert.match(en['service_tour.visibility_body'],/personal\/home address stays private/i);
  assert.match(en['service_tour.visibility_body'],/Customer job address is a third, separate location/i);
  assert.match(fil['service_tour.visibility_body'],/service area/i);
  assert.match(fil['service_tour.visibility_body'],/Customer job address/i);
});
