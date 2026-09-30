import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-suppliers.js');
const ui=read('public/suppliers-ui.js');
const guided=read('public/guided-onboarding.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Supplier operating location is scoped to the economic workspace rather than account-wide supplier_profiles',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS supplier_operating_locations/);
  assert.match(server,/business_id BIGINT PRIMARY KEY REFERENCES businesses/);
  assert.match(server,/account_id BIGINT NOT NULL REFERENCES accounts/);
  assert.match(server,/supplierBusinessContext\(me\.account\.id/);
  assert.match(server,/resolveSupplierBusinessForPo\(accountId,requestedBusinessId/);
  assert.doesNotMatch(server,/ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS operating_address/);
});

test('Supplier work location defaults to personal context without storing or exposing a copied home address',()=>{
  assert.match(server,/location_mode TEXT NOT NULL DEFAULT 'personal_default'/);
  assert.match(server,/visibility TEXT NOT NULL DEFAULT 'private'/);
  assert.match(server,/location_mode:'personal_default'/);
  assert.match(server,/exact_address:''/);
  assert.match(server,/if\(mode==='personal_default'\)\{type='warehouse_dispatch_pickup';label='';address='';visibility='private'\}/);
  assert.match(ui,/Business & Life keeps the personal account address private and does not publish it as a Supplier location/);
  assert.match(ui,/No GPS is captured/);
  assert.doesNotMatch(ui,/navigator\.geolocation|currentPosition\(/);
});

test('Exact Supplier location is released only to accepted Merchant relationships after explicit relationship visibility',()=>{
  assert.match(server,/r\.state='accepted' AND sol\.location_mode='separate' AND sol\.visibility='relationships'/);
  assert.match(server,/operating_location_address/);
  assert.match(server,/LEFT JOIN supplier_operating_locations sol ON sol\.business_id=r\.supplier_business_id/);
  assert.match(ui,/Accepted Merchant relationships/);
  assert.match(ui,/Work location shared/);
});

test('Supplier location UI keeps service area, exact work address and finance identity visibly separate',()=>{
  assert.match(ui,/Service area/);
  assert.match(ui,/Warehouse \/ dispatch \/ pickup location/);
  assert.match(ui,/Your personal address, payout details and legal identity stay separate/);
  assert.match(ui,/id="spLocationAddress"/);
  assert.match(ui,/id="spLocationVisibility"/);
  assert.match(ui,/id="supplierOperatingLocationForm"/);
  assert.match(ui,/\/api\/supplier\/operating-location/);
});

test('Supplier guided onboarding now targets the real work-location control and states the privacy boundary in both locales',()=>{
  assert.match(guided,/#supplierOperatingLocationForm/);
  assert.match(en['supplier_tour.catalog_body'],/optional warehouse, dispatch or pickup override/i);
  assert.match(en['supplier_tour.catalog_body'],/private unless you explicitly share/i);
  assert.match(en['supplier_tour.catalog_body'],/personal address is never published/i);
  assert.match(fil['supplier_tour.catalog_body'],/warehouse, dispatch o pickup override/i);
  assert.match(fil['supplier_tour.catalog_body'],/personal address/i);
});
