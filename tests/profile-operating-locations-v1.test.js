import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PROFILE_OPERATING_LOCATION_ROLES,
  operatingLocationScopeKey,
  normalizeProfileOperatingLocationInput
} from '../profile-operating-location-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('profile-operating-location-core.js');
const payments=read('server-payments.js');
const settings=read('public/profile-settings-ui.js');
const marketplace=read('server-marketplace.js');
const delivery=read('server-delivery.js');

test('Profile operating location V1 supports only the two missing work-location profiles',()=>{
  assert.deepEqual(PROFILE_OPERATING_LOCATION_ROLES,['supplier','service_provider']);
  assert.equal(operatingLocationScopeKey('supplier',42),'business:42');
  assert.equal(operatingLocationScopeKey('service_provider'),'profile');
  assert.throws(()=>operatingLocationScopeKey('merchant',42),/not supported/i);
  assert.throws(()=>operatingLocationScopeKey('courier'),/not supported/i);
});

test('Personal mode references the private Account address instead of duplicating it',()=>{
  const supplier=normalizeProfileOperatingLocationInput({
    location_mode:'personal',
    exact_address:'must be discarded',
    psgc_code:'0402103028'
  },'supplier');
  assert.equal(supplier.location_mode,'personal');
  assert.equal(supplier.exact_address,'');
  assert.equal(supplier.psgc_code,'');
  assert.match(core,/location_mode TEXT NOT NULL DEFAULT 'personal'/);
  assert.match(core,/public_exact_location_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(core,/mode==='override'\?clean\(exactAddress,400\):''/);
  const route=payments.slice(
    payments.indexOf("app.put('/api/settings/operating-location/:role'"),
    payments.indexOf("app.get('/api/settings/finance'",payments.indexOf("app.put('/api/settings/operating-location/:role'"))
  );
  assert.match(route,/me\.account\?\.address/);
  assert.doesNotMatch(route,/saveProfileOperatingLocation\([\s\S]*exactAddress:me\.account/i);
});

test('Override mode requires exact work address plus canonical PSGC barangay',()=>{
  assert.throws(
    ()=>normalizeProfileOperatingLocationInput({location_mode:'override',psgc_code:'0402103028'},'supplier'),
    /work address/i
  );
  assert.throws(
    ()=>normalizeProfileOperatingLocationInput({location_mode:'override',exact_address:'Warehouse 1'},'supplier'),
    /official barangay/i
  );
  const valid=normalizeProfileOperatingLocationInput({
    location_mode:'override',
    exact_address:'Private Warehouse, Bacoor',
    psgc_code:'0402103028'
  },'supplier');
  assert.equal(valid.exact_address,'Private Warehouse, Bacoor');
  assert.equal(valid.psgc_code,'0402103028');
  assert.match(payments,/geographyAvailabilityForCode\(pool,normalized\.psgc_code\)/);
});

test('Supplier work location is isolated by active Supplier business binding',()=>{
  const scope=payments.slice(
    payments.indexOf('async function operatingLocationScope'),
    payments.indexOf('function operatingLocationResponse')
  );
  assert.match(scope,/profile_business_bindings/);
  assert.match(scope,/business_memberships/);
  assert.match(scope,/pb\.role='supplier'/);
  assert.match(scope,/pb\.business_id=\$2/);
  assert.match(scope,/pb\.status='active'/);
  assert.match(payments,/business_bindings:businessBindings\.rows/);
  assert.match(settings,/businessesForSettingsRole/);
  assert.match(settings,/b\.role===role&&b\.status==='active'/);
});

test('Local Services base supports a bounded radius while exact location stays private',()=>{
  const valid=normalizeProfileOperatingLocationInput({
    location_mode:'override',
    exact_address:'Private service base',
    psgc_code:'0402103028',
    service_radius_km:25.5
  },'service_provider');
  assert.equal(valid.service_radius_km,25.5);
  assert.throws(
    ()=>normalizeProfileOperatingLocationInput({location_mode:'override',exact_address:'x',psgc_code:'0402103028',service_radius_km:501},'service_provider'),
    /between 0 and 500/i
  );
  assert.match(settings,/Service base &amp; area/);
  assert.match(settings,/does not publish the exact address/);
  assert.match(settings,/never turns on GPS/);
  assert.match(payments,/public_exact_location_enabled:false/);
});

test('Merchant and Courier retain their existing canonical location systems',()=>{
  assert.match(marketplace,/merchant_storefronts/);
  assert.match(marketplace,/pickup_address/);
  assert.match(marketplace,/public_location_enabled/);
  assert.match(delivery,/\/api\/courier\/operating-area/);
  assert.match(settings,/data-profile-settings-view="operatingArea"/);
  assert.doesNotMatch(core,/merchant/);
  assert.doesNotMatch(core,/courier/);
});

test('Profile Settings searches official PSGC data and never captures browser GPS for Supplier or Local Services',()=>{
  assert.match(settings,/\/api\/auth\/geography\/search\?q=/);
  assert.match(settings,/\/api\/settings\/operating-location\//);
  assert.match(settings,/Use my private personal address/);
  assert.match(settings,/Use a different work address/);
  const workLocationBlock=settings.slice(
    settings.indexOf('function profileOperatingLocationSettings'),
    settings.indexOf('function profileStatusSettings')
  );
  assert.doesNotMatch(workLocationBlock,/geolocation|getCurrentPosition|watchPosition|latitude|longitude/i);
});
