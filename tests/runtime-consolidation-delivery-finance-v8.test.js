import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const finance=read('server-delivery-finance.js');
const incidents=read('server-incidents.js');
const delivery=read('server-delivery.js');
const suppliers=read('server-suppliers.js');
const services=read('server-services.js');
const marketplace=read('server-marketplace.js');
const orders=read('server-orders.js');
const auth=read('server-auth.js');
const accounting=read('server-business-accounting.js');
const notifications=read('server-notifications.js');
const payments=read('server-payments.js');

test('Delivery Finance is embedded beneath Incidents and localhost 3807 is retired',()=>{
  assert.match(finance,/export async function startEmbeddedDeliveryFinance\(\)/);
  assert.match(finance,/export async function stopEmbeddedDeliveryFinance\(\)/);
  assert.match(finance,/Business & Life delivery finance mounted in-process/);
  assert.match(finance,/directExecution/);
  assert.match(finance,/Business & Life delivery finance gateway listening on/);
  assert.match(incidents,/startEmbeddedDeliveryFinance/);
  assert.match(incidents,/stopEmbeddedDeliveryFinance/);
  assert.match(incidents,/deliveryFinanceApp=await startEmbeddedDeliveryFinance\(\)/);
  assert.match(incidents,/return deliveryFinanceApp\(req,res,next\)/);
  assert.doesNotMatch(incidents,/INTERNAL_FINANCE_PORT/);
  assert.doesNotMatch(incidents,/\|\|\s*3807/);
  assert.doesNotMatch(incidents,/127\.0\.0\.1:3807/);
  assert.doesNotMatch(incidents,/spawn\(process\.execPath,\['server-delivery-finance\.js'\]/);
});

test('Delivery Finance remains standalone rollback-capable while Delivery is embedded beneath it',()=>{
  assert.match(finance,/startEmbeddedDelivery/);
  assert.match(finance,/stopEmbeddedDelivery/);
  assert.match(finance,/deliveryApp=await startEmbeddedDelivery\(\)/);
  assert.match(finance,/return deliveryApp\(req,res,next\)/);
  assert.doesNotMatch(finance,/INTERNAL_DELIVERY_PORT/);
  assert.doesNotMatch(finance,/\|\|\s*3707/);
  assert.doesNotMatch(finance,/spawn\(process\.execPath,\['server-delivery\.js'\]/);
  assert.match(delivery,/startEmbeddedSuppliers/);
  assert.match(delivery,/stopEmbeddedSuppliers/);
  assert.match(delivery,/suppliersApp=await startEmbeddedSuppliers\(\)/);
  assert.doesNotMatch(delivery,/INTERNAL_SUPPLIERS_PORT/);
  assert.doesNotMatch(delivery,/\|\|\s*3607/);
  assert.match(suppliers,/startEmbeddedServices/);
  assert.match(suppliers,/servicesApp=await startEmbeddedServices\(\)/);
  assert.doesNotMatch(suppliers,/INTERNAL_SERVICES_PORT/);
  assert.doesNotMatch(suppliers,/\|\|\s*3507/);
});

test('Delivery Finance fetch facade refuses to bypass its owned mutation routes',()=>{
  assert.match(finance,/export function isDeliveryFinanceOwnedPath/);
  assert.match(finance,/pathname==='\/api\/courier\/delivery-profile'/);
  assert.match(finance,/\/api\\\/orders\\\/merchant/);
  assert.match(finance,/DELIVERY_FINANCE_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(finance,/return downstreamFetch\(path,options\)/);
});

test('Courier profile ownership remains explicit for V8 without semantic migration',()=>{
  assert.match(delivery,/app\.get\('\/api\/courier\/delivery-profile'/);
  assert.match(finance,/app\.put\('\/api\/courier\/delivery-profile'/);
  assert.match(finance,/UPDATE courier_profiles SET vehicle_type/);
});

test('composed Merchant payment authority remains above rollback-compatible Delivery Finance',()=>{
  assert.match(payments,/app\.post\('\/api\/orders\/merchant\/:id\/payment'/);
  assert.match(payments,/mirrorConfirmedOrderPayment/);
  assert.match(notifications,/app\.post\('\/api\/orders\/merchant\/:id\/payment'/);
  assert.match(notifications,/order\.payment_confirmed/);
  assert.match(accounting,/app\.post\('\/api\/orders\/merchant\/:id\/payment'/);
  assert.match(accounting,/INSERT INTO order_payments/);
  assert.match(accounting,/delivery_financial_events/);
  assert.match(finance,/Standalone rollback compatibility only/);
  assert.match(finance,/app\.post\('\/api\/orders\/merchant\/:id\/payment'/);
});

test('parsed JSON reconstruction now lives at the final Account/Auth to Accounting boundary',()=>{
  assert.match(finance,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(delivery,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.match(auth,/const parsedJsonBody=!rawPayload&&req\.body!==undefined/);
  assert.match(auth,/const payload=rawPayload\|\|/);
  assert.match(auth,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(auth,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(auth,/delete headers\['transfer-encoding'\]/);
  assert.match(auth,/if\(payload\)upstream\.end\(payload\);else req\.pipe\(upstream\)/);
});

test('V8 leaves Incident and raw-body webhook boundaries unchanged',()=>{
  assert.match(incidents,/INCIDENT_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
  assert.match(notifications,/verifyResendWebhook/);
});
