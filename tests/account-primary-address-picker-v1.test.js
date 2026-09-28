import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrivateAddressGeocoder} from '../private-address-geocoder.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const server=read('server-auth.js');
const onboarding=read('public/guided-onboarding.js');

test('Home address has simple search and GPS selection without exposing internal territory mechanics',()=>{
  assert.match(shell,/id="shellAddress"[^>]*autocomplete="street-address"/);
  assert.match(shell,/Home address <span>Private<\/span>/);
  assert.match(shell,/id="accountAddressSearch"[^>]*>Search address<\/button>/);
  assert.match(shell,/id="accountAddressGps"[^>]*>Use my location<\/button>/);
  assert.match(shell,/Enter your home address\. We will check whether Business & Life is available in your area/);
  assert.match(shell,/Your home address is private/);
  assert.doesNotMatch(shell,/aggregate territory-demand signal/);
  assert.doesNotMatch(shell,/PSGC .*·/);
  assert.match(shell,/navigator\.geolocation\.getCurrentPosition/);
  assert.match(shell,/\/api\/me\/address\/search\?q=/);
  assert.match(shell,/\/api\/me\/address\/reverse/);
  const save=shell.slice(shell.indexOf('async function saveIdentity'),shell.indexOf('function imageToAvatarDataUrl'));
  assert.match(save,/address: document\.getElementById\('shellAddress'\)\?\.value \|\| ''/);
  assert.doesNotMatch(save,/latitude|longitude|address_lat|address_lng/);
});

test('address lookup happens only after explicit search or GPS action; typing hides stale availability',()=>{
  const bind=shell.slice(shell.indexOf('function bindPrimaryAddressPicker'),shell.indexOf('async function saveIdentity'));
  assert.match(bind,/accountAddressSearch/);
  assert.match(bind,/accountAddressGps/);
  assert.match(bind,/addEventListener\('input'/);
  assert.doesNotMatch(bind,/profileApi\(/);
  assert.match(bind,/accountAddressArea hidden/);
  assert.doesNotMatch(shell,/Coordinates are used once to suggest the address/);
});

test('private account address routes are authenticated and never cache the response',()=>{
  assert.match(server,/app\.get\('\/api\/me\/address\/search',auth/);
  assert.match(server,/app\.post\('\/api\/me\/address\/reverse',body,auth/);
  assert.match(server,/Cache-Control','private, no-store, max-age=0/);
  assert.match(server,/identity_country_code/);
});

test('private geocoder search is country-aware, bounded and does not retain a query cache',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    return{ok:true,json:async()=>[
      {display_name:'123 Test Street, Queens Row West, Bacoor, Cavite, Philippines',address:{suburb:'Queens Row West',city:'Bacoor',state:'Cavite',country_code:'ph'}}
    ]};
  };
  const geocoder=createPrivateAddressGeocoder({fetchImpl,minimumGapMs:0,baseUrl:'https://example.test'});
  const one=await geocoder.search('123 Test Street','PH');
  const two=await geocoder.search('123 Test Street','PH');
  assert.deepEqual(one,[{label:'123 Test Street, Queens Row West, Bacoor, Cavite, Philippines',parts:{suburb:'Queens Row West',city:'Bacoor',state:'Cavite',country_code:'ph'}}]);
  assert.deepEqual(two,one);
  assert.equal(calls.length,2,'private address searches must not be retained in a long-lived query cache');
  const url=new URL(calls[0]);
  assert.equal(url.pathname,'/search');
  assert.equal(url.searchParams.get('limit'),'5');
  assert.equal(url.searchParams.get('addressdetails'),'1');
  assert.equal(url.searchParams.get('countrycodes'),'ph');
  assert.equal(url.searchParams.get('q'),'123 Test Street');
});

test('GPS reverse geocoding returns a safe address label plus sanitized area components and validates coordinates',async()=>{
  const calls=[];
  const geocoder=createPrivateAddressGeocoder({
    minimumGapMs:0,baseUrl:'https://example.test',
    fetchImpl:async url=>{
      calls.push(String(url));
      return{ok:true,json:async()=>({display_name:'Private selected address',address:{suburb:'Queens Row West',city:'Bacoor',state:'Cavite',country_code:'ph',osm_secret:'drop-me'}})};
    }
  });
  const result=await geocoder.reverse(14.4,120.9);
  assert.deepEqual(result,{label:'Private selected address',parts:{suburb:'Queens Row West',city:'Bacoor',state:'Cavite',country_code:'ph'}});
  assert.deepEqual(Object.keys(result),['label','parts']);
  const url=new URL(calls[0]);
  assert.equal(url.pathname,'/reverse');
  assert.equal(url.searchParams.get('lat'),'14.4');
  assert.equal(url.searchParams.get('lon'),'120.9');
  assert.equal(url.searchParams.get('addressdetails'),'1');
  await assert.rejects(()=>geocoder.reverse(200,120),/Valid GPS coordinates/);
});

test('selected address keeps internal PSGC assignment but exposes only availability to the customer',()=>{
  assert.match(shell,/id="shellAddressPsgcCode"/);
  assert.match(shell,/function setAddressArea/);
  assert.match(shell,/Business & Life is available in your area/);
  assert.match(shell,/Business & Life is not available in your area yet/);
  assert.doesNotMatch(shell,/This area contributes to the aggregate territory-demand signal/);
  const save=shell.slice(shell.indexOf('async function saveIdentity'),shell.indexOf('function imageToAvatarDataUrl'));
  assert.match(save,/home_psgc_code: document\.getElementById\('shellAddressPsgcCode'\)/);
  assert.match(server,/resolveAddressBarangayCandidate/);
  assert.match(server,/saveAccountGeography\(client,req\.accountId,homePsgcCode,\{source:'address_derived_psgc'\}\)/);
  assert.match(server,/deriveRegistrationGeography\(address\)/);
  assert.match(server,/could not confidently detect your barangay from this address/);
});

test('guided onboarding asks for the home address and explains only customer-visible availability',()=>{
  assert.match(onboarding,/add your home address/);
  assert.match(onboarding,/We will check whether Business & Life is available in your area/);
  assert.doesNotMatch(onboarding,/territory-demand signals/);
  assert.doesNotMatch(onboarding,/derives the PSGC barangay/);
  assert.match(onboarding,/firstVisible\('#shellAddress','#accountAddressArea','#accountGeographyForm'/);
});

test('Save account can derive the area from typed address without forcing a second location field',()=>{
  const patch=server.slice(server.indexOf("app.patch('/api/me'"),server.indexOf("app.put('/api/me/geography'"));
  assert.match(patch,/addressChanged\|\|!existingGeo\?\.assigned/);
  assert.match(patch,/deriveRegistrationGeography\(address\)/);
  assert.match(patch,/homePsgcCode=derived\.psgc_code/);
  assert.match(patch,/saveAccountGeography\(client,req\.accountId,homePsgcCode,\{source:'address_derived_psgc'\}\)/);
});

test('manual area picker appears only as a simple fallback when availability cannot be verified',()=>{
  assert.match(shell,/We could not verify your area/);
  assert.match(shell,/choose the correct local area here/);
  assert.match(shell,/Choose local area/);
  assert.match(shell,/Save area/);
  assert.doesNotMatch(shell,/Correct or confirm detected area/);
  assert.doesNotMatch(shell,/territory availability and demand signals/);
});

test('mobile address controls remain touch-safe',()=>{
  assert.match(css,/\.accountAddressActions button\{[^}]*min-height:44px/);
  assert.match(css,/@media\(max-width:420px\)\{\.accountAddressActions\{grid-template-columns:1fr\}/);
  assert.match(css,/\.accountAddressResults\{[^}]*max-height:220px/);
});
