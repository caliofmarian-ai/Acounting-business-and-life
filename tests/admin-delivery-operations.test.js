import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ADMIN_PERMISSIONS} from '../admin-authorization.js';
import {ADMIN_FUNCTION_BUNDLES} from '../admin-functions.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const delivery=read('server-delivery.js');
const gateway=read('server-admin-operations.js');
const adminUi=read('public/admin-console.js');
const merchantUi=read('public/delivery-ui.js');

test('Delivery Admin authority is explicit and delegable by function',()=>{
  assert.ok(ADMIN_PERMISSIONS.includes('delivery.dispatch.manage'));
  assert.ok(ADMIN_PERMISSIONS.includes('delivery.pricing.manage'));
  assert.deepEqual(ADMIN_FUNCTION_BUNDLES.delivery_operations.permissions,['admin.console','courier.verify','delivery.dispatch.manage']);
  assert.deepEqual(ADMIN_FUNCTION_BUNDLES.delivery_pricing.assignable_to,['country_admin']);
});

test('Delivery service accepts only signed scoped Admin assertions',()=>{
  assert.match(delivery,/verifyAdminAssertion/);
  assert.match(delivery,/assertion\.permission!==permission/);
  assert.doesNotMatch(delivery,/Number\(me\.account\.id\)!==1/);
  assert.match(delivery,/Delivery pricing is country-scoped/);
  assert.match(delivery,/outside your delegated territory/);
});

test('Admin gateway signs and audits Delivery operations with delegated scope',()=>{
  assert.match(gateway,/scopedTerritoryId=territoryId\?\?assignment\.territory_id\?\?null/);
  assert.match(gateway,/forwardAdmin\(req,res,'delivery\.pricing\.manage'/);
  assert.match(gateway,/forwardAdmin\(req,res,'delivery\.dispatch\.manage'/);
  assert.match(gateway,/forwardAdmin\(req,res,'courier\.verify'/);
});

test('Admin Delivery is a separate permission-driven module',()=>{
  assert.match(adminUi,/id:'delivery',label:'Delivery'/);
  assert.match(adminUi,/Privileged Delivery controls are isolated/);
  assert.match(adminUi,/adminDeliveryPricingForm/);
  assert.match(adminUi,/data-courier-decision/);
  assert.match(adminUi,/data-delivery-assign/);
  assert.doesNotMatch(merchantUi,/\/api\/admin\//);
});
