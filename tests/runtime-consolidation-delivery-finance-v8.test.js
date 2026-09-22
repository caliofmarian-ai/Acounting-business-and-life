import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const finance=read('server-delivery-finance.js');
const incidents=read('server-incidents.js');
const delivery=read('server-delivery.js');
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

test('Delivery Finance remains standalone rollback-capable over Delivery 3707',()=>{
  assert.match(finance,/spawn\(process\.execPath,\['server-delivery\.js'\]/);
  assert.match(finance,/INTERNAL_DELIVERY_PORT \|\| 3707/);
  assert.match(finance,/Delivery child failed health check/);
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

test('parsed JSON reconstruction now lives at the final Delivery Finance to Delivery boundary',()=>{
  assert.match(finance,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(finance,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(finance,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(finance,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(finance,/delete headers\['transfer-encoding'\]/);
  assert.match(finance,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('V8 leaves Incident and raw-body webhook boundaries unchanged',()=>{
  assert.match(incidents,/INCIDENT_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
  assert.match(notifications,/verifyResendWebhook/);
});
