import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=read('server-auth.js');
const delivery=read('server-delivery.js');
const settings=read('public/profile-settings-ui.js');
const shell=read('public/shell.js');
const qa=read('qa-courier-acceptance.js');

test('Courier operating area is a profile work preference separate from home address and live GPS',()=>{
  for(const field of ['operating_psgc_code','operating_area_name','operating_area_path','operating_area_source_version']){
    assert.match(auth,new RegExp(field));
    assert.match(delivery,new RegExp(field));
  }
  const route=delivery.slice(delivery.indexOf("app.put('/api/courier/operating-area'"),delivery.indexOf("app.post('/api/courier/documents'",delivery.indexOf("app.put('/api/courier/operating-area'")));
  assert.match(route,/geographyAvailabilityForCode/);
  assert.match(route,/Preferred operating area does not grant Courier authority/);
  assert.doesNotMatch(route,/address\s*=/i);
  assert.doesNotMatch(route,/last_lat|last_lng|current_location/i);
});

test('Delivery Settings uses official PSGC search and explains the privacy boundary',()=>{
  assert.match(settings,/data-profile-settings-view="operatingArea"/);
  assert.match(settings,/\/api\/auth\/geography\/search/);
  assert.match(settings,/\/api\/courier\/operating-area/);
  assert.match(settings,/not your home address or live GPS/);
  assert.match(settings,/does not approve you to work there/);
});

test('Courier Home exposes the selected start area without changing Admin authorization',()=>{
  assert.match(delivery,/operating_area_name:profile\.operating_area_name/);
  assert.match(shell,/Start area not set/);
  assert.match(delivery,/profile_authorizations/);
  assert.match(delivery,/role='courier'/);
});

test('Courier runtime acceptance persists and reloads the operating barangay',()=>{
  assert.match(qa,/account_geography_assignments/);
  assert.match(qa,/\/api\/courier\/operating-area/);
  assert.match(qa,/operating area did not survive profile reload/);
});
