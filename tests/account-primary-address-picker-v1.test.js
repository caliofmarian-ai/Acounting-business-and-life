import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const cascade=read('public/ph-geography-cascade.js');
const server=read('server-auth.js');
const geography=read('account-geography.js');
const onboarding=read('public/guided-onboarding.js');

test('Philippines account location is selected only through official hierarchy controls',()=>{
  assert.match(shell,/phGeographyCascadeMarkup\('shell'/);
  assert.match(cascade,/Region/);
  assert.match(cascade,/Province/);
  assert.match(cascade,/City \/ Municipality/);
  assert.match(cascade,/Barangay/);
  assert.match(cascade,/\/api\/auth\/geography\/options/);
  assert.doesNotMatch(shell,/id="shellAddress"/);
  assert.doesNotMatch(shell,/id="accountAddressSearch"/);
  assert.doesNotMatch(shell,/id="accountAddressGps"/);
});

test('cascade loads children only from the selected PSGC parent and supports regions without provinces',()=>{
  assert.match(geography,/export async function listOfficialGeographyChildren/);
  assert.match(geography,/g\.parent_psgc_code=\$2/);
  assert.match(server,/app\.get\('\/api\/auth\/geography\/options'/);
  assert.match(cascade,/Not applicable in this region/);
  assert.match(cascade,/LOCALITY_LEVELS/);
  assert.match(cascade,/No province — independent city/);
  assert.match(cascade,/DIRECT_REGION_LOCALITY/);
  assert.match(cascade,/directLocalities/);
});

test('selected barangay PSGC is authoritative for account save and free text cannot decide territory availability',()=>{
  const save=shell.slice(shell.indexOf('async function saveIdentity'),shell.indexOf('function imageToAvatarDataUrl'));
  assert.match(save,/home_psgc_code: document\.getElementById\('shellHomePsgcCode'\)/);
  assert.doesNotMatch(save,/shellAddress/);
  const patch=server.slice(server.indexOf("app.patch('/api/me'"),server.indexOf("app.put('/api/me/geography'"));
  assert.match(patch,/geographyAvailabilityForCode\(pool,homePsgcCode\)/);
  assert.match(patch,/source:'account_settings_selected_psgc'/);
  assert.doesNotMatch(patch,/deriveRegistrationGeography\(address\)/);
  assert.doesNotMatch(patch,/could not confidently detect your barangay from this address/);
});

test('registration requires the official selected barangay before normal account creation',()=>{
  const registration=server.slice(server.indexOf("app.post('/api/auth/register'"),server.indexOf("app.post('/api/auth/login'"));
  assert.match(registration,/Choose your official home area: Region, Province, City \/ Municipality and Barangay/);
  assert.match(registration,/geographyAvailabilityForCode\(pool,homePsgcCode\)/);
  assert.doesNotMatch(registration,/deriveRegistrationGeography\(address\)/);
});

test('guided onboarding points to the official selector rather than a typed address field',()=>{
  assert.match(onboarding,/select your official home area/);
  assert.match(onboarding,/\[data-ph-geo-cascade="shell"\]/);
  assert.doesNotMatch(onboarding,/firstVisible\('#shellAddress'/);
});
