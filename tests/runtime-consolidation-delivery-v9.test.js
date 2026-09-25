import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const finance=read('server-delivery-finance.js');
const delivery=read('server-delivery.js');
const suppliers=read('server-suppliers.js');
const services=read('server-services.js');
const marketplace=read('server-marketplace.js');
const orders=read('server-orders.js');
const auth=read('server-auth.js');
const notifications=read('server-notifications.js');
const legal=read('server-legal.js');

test('Delivery is embedded beneath Delivery Finance and localhost 3707 is retired',()=>{
  assert.match(delivery,/export async function startEmbeddedDelivery\(\)/);
  assert.match(delivery,/export async function stopEmbeddedDelivery\(\)/);
  assert.match(delivery,/Business & Life delivery mounted in-process/);
  assert.match(delivery,/directExecution/);
  assert.match(delivery,/Business & Life delivery server listening on/);
  assert.match(finance,/deliveryFetch,startEmbeddedDelivery,stopEmbeddedDelivery/);
  assert.match(finance,/deliveryApp=await startEmbeddedDelivery\(\)/);
  assert.match(finance,/return deliveryApp\(req,res,next\)/);
  assert.doesNotMatch(finance,/INTERNAL_DELIVERY_PORT/);
  assert.doesNotMatch(finance,/\|\|\s*3707/);
  assert.doesNotMatch(finance,/127\.0\.0\.1:3707/);
  assert.doesNotMatch(finance,/spawn\(process\.execPath,\['server-delivery\.js'\]/);
});

test('Delivery remains standalone rollback-capable while Suppliers is embedded beneath it',()=>{
  assert.match(delivery,/startEmbeddedSuppliers/);
  assert.match(delivery,/stopEmbeddedSuppliers/);
  assert.match(delivery,/suppliersApp=await startEmbeddedSuppliers\(\)/);
  assert.match(delivery,/return suppliersApp\(req,res,next\)/);
  assert.doesNotMatch(delivery,/INTERNAL_SUPPLIERS_PORT/);
  assert.doesNotMatch(delivery,/\|\|\s*3607/);
  assert.doesNotMatch(delivery,/spawn\(process\.execPath,\['server-suppliers\.js'\]/);
  assert.match(suppliers,/startEmbeddedServices/);
  assert.match(suppliers,/servicesApp=await startEmbeddedServices\(\)/);
  assert.doesNotMatch(suppliers,/INTERNAL_SERVICES_PORT/);
  assert.doesNotMatch(suppliers,/\|\|\s*3507/);
});

test('Delivery fetch facade refuses to bypass Delivery-owned routes',()=>{
  assert.match(delivery,/export function isDeliveryOwnedPath/);
  assert.match(delivery,/pathname\.startsWith\('\/api\/delivery\/'\)/);
  assert.match(delivery,/pathname==='\/api\/courier\/delivery-profile'/);
  assert.match(delivery,/pathname\.startsWith\('\/api\/courier\/deliveries\/'\)/);
  assert.match(delivery,/pathname\.startsWith\('\/api\/admin\/delivery\/'\)/);
  assert.match(delivery,/DELIVERY_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(delivery,/return upstream\(path,options\)/);
});

test('Delivery domain ownership remains on server-delivery',()=>{
  for(const marker of [
    "app.post('/api/delivery/quote'",
    "app.post('/api/marketplace/checkout'",
    "app.put('/api/delivery/store-location'",
    "app.get('/api/delivery/merchant'",
    "app.post('/api/delivery/:id/request-courier'",
    "app.get('/api/courier/delivery-profile'",
    "app.post('/api/courier/documents'",
    "app.put('/api/courier/availability'",
    "app.post('/api/courier/deliveries/:id/status'",
    "app.post('/api/courier/deliveries/:id/location'",
    "app.post('/api/courier/deliveries/:id/complete'",
    "app.get('/api/delivery/mine'",
    "app.get('/api/delivery/:id/live'",
    "app.get('/api/admin/delivery/pricing'",
    "app.put('/api/admin/delivery/pricing'",
    "app.get('/api/admin/couriers'",
    "app.get('/api/admin/deliveries'",
    "app.post('/api/admin/deliveries/:id/assign'",
    "app.get('/delivery.css'",
    "app.get('/delivery-ui.js'"
  ])assert.ok(delivery.includes(marker),`missing Delivery marker: ${marker}`);
});

test('parsed request bodies stay in-process without a legacy Accounting HTTP boundary',()=>{
  assert.match(delivery,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(suppliers,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
  assert.doesNotMatch(auth,/server-v03\.js/);
  assert.doesNotMatch(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.doesNotMatch(auth,/http\.request/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('V9 preserves scoped Admin Legal and notification wrappers above Delivery',()=>{
  assert.match(delivery,/verifyAdminAssertion/);
  assert.match(delivery,/Scoped Admin assertion required/);
  assert.match(legal,/app\.post\('\/api\/delivery\/quote'/);
  assert.match(legal,/app\.post\('\/api\/courier\/deliveries\/:id\/location'/);
  assert.match(notifications,/app\.post\('\/api\/courier\/deliveries\/:id\/complete'/);
  assert.match(notifications,/delivery\.completed/);
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
});

test('completion security and monetization evidence remain in Delivery',()=>{
  assert.match(delivery,/Customer delivery code is incorrect/);
  assert.match(delivery,/status='delivered'/);
  assert.match(delivery,/last_lat=NULL,last_lng=NULL,last_location_at=NULL/);
  assert.match(delivery,/recordMonetizableCompletion\(client,\{serviceScope:'marketplace'/);
  assert.match(delivery,/recordMonetizableCompletion\(client,\{serviceScope:'delivery'/);
});
