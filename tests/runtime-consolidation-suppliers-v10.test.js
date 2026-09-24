import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const delivery=read('server-delivery.js');
const suppliers=read('server-suppliers.js');
const services=read('server-services.js');

test('Suppliers is embedded beneath Delivery and localhost 3607 is retired',()=>{
  assert.match(suppliers,/export async function startEmbeddedSuppliers\(\)/);
  assert.match(suppliers,/export async function stopEmbeddedSuppliers\(\)/);
  assert.match(suppliers,/Business & Life supplier procurement mounted in-process/);
  assert.match(suppliers,/directExecution/);
  assert.match(suppliers,/Business & Life supplier procurement server listening on/);
  assert.match(delivery,/suppliersFetch,startEmbeddedSuppliers,stopEmbeddedSuppliers/);
  assert.match(delivery,/suppliersApp=await startEmbeddedSuppliers\(\)/);
  assert.match(delivery,/return suppliersApp\(req,res,next\)/);
  assert.doesNotMatch(delivery,/INTERNAL_SUPPLIERS_PORT/);
  assert.doesNotMatch(delivery,/\|\|\s*3607/);
  assert.doesNotMatch(delivery,/127\.0\.0\.1:3607/);
  assert.doesNotMatch(delivery,/spawn\(process\.execPath,\['server-suppliers\.js'\]/);
});

test('Delivery root composition delegates to embedded Suppliers without stale localhost Supplier state',()=>{
  assert.doesNotMatch(delivery,/\bupstreamPort\b/);
  assert.match(delivery,/if\(pathname==='\/'\|\|pathname==='\/index\.html'\)\{\s*const r=await upstream\(path,options\);/);
  assert.doesNotMatch(delivery,/host:`127\.0\.0\.1:\$\{upstreamPort\}`/);
});

test('Suppliers remains rollback-capable over Local Services on 3507',()=>{
  assert.match(suppliers,/spawn\(process\.execPath,\['server-services\.js'\]/);
  assert.match(suppliers,/INTERNAL_SERVICES_PORT \|\| 3507/);
  assert.match(suppliers,/Services child failed health check/);
  assert.match(suppliers,/servicesReady=true/);
  assert.match(services,/server-marketplace\.js/);
});

test('Supplier fetch facade refuses to bypass Supplier-owned routes',()=>{
  assert.match(suppliers,/export function isSupplierOwnedPath/);
  assert.match(suppliers,/pathname\.startsWith\('\/api\/supplier\/'\)/);
  assert.match(suppliers,/pathname\.startsWith\('\/api\/procurement\/'\)/);
  assert.match(suppliers,/SUPPLIER_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(suppliers,/return upstream\(path,options\)/);
});

test('Supplier procurement route ownership remains on server-suppliers',()=>{
  for(const marker of [
    "app.get('/api/supplier/me'",
    "app.put('/api/supplier/me'",
    "app.post('/api/supplier/catalog'",
    "app.patch('/api/supplier/catalog/:id'",
    "app.post('/api/procurement/relationships/invite'",
    "app.post('/api/supplier/relationships/:businessId/respond'",
    "app.get('/api/procurement/suppliers/:supplierId/catalog'",
    "app.put('/api/procurement/catalog/:catalogId/link'",
    "app.post('/api/procurement/orders'",
    "app.get('/api/procurement/orders/:id'",
    "app.post('/api/supplier/orders/:id/respond'",
    "app.post('/api/supplier/orders/:id/status'",
    "app.post('/api/procurement/orders/:id/receive'",
    "app.post('/api/procurement/orders/:id/payment'",
    "app.get('/api/procurement/reorder-suggestions'",
    "app.get('/api/procurement/respond/:token'",
    "app.get('/suppliers.css'",
    "app.get('/suppliers-ui.js'"
  ])assert.ok(suppliers.includes(marker),`missing Supplier marker: ${marker}`);
});

test('Supplier V2 through V5 modules remain registered before fallback',()=>{
  for(const marker of [
    'registerSupplierDomainV2Routes({app,pool,body,identity})',
    'registerSupplierCommercialV3Routes({app,pool,body,identity})',
    'registerSupplierSourcingV4Routes({app,pool,body,identity})',
    'registerSupplierDailyV5Routes({app,pool,body,identity})',
    'registerSupplierExceptionsV5Routes({app,pool,body,identity})'
  ])assert.ok(suppliers.includes(marker),`missing Supplier module registration: ${marker}`);
});

test('parsed JSON is preserved at the Suppliers to Local Services boundary',()=>{
  assert.match(suppliers,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(suppliers,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(suppliers,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(suppliers,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(suppliers,/delete headers\['transfer-encoding'\]/);
  assert.match(suppliers,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('Supplier business authorization and procurement authorities remain intact',()=>{
  assert.match(suppliers,/Merchant profile required/);
  assert.match(suppliers,/Supplier profile required/);
  assert.match(suppliers,/Accepted Supplier relationship required/);
  assert.match(suppliers,/PO not found/);
  assert.match(suppliers,/Payment exceeds current Supplier commercial outstanding amount/);
  assert.match(suppliers,/recordPoReceiptLot/);
  assert.match(suppliers,/recordMonetizableCompletion\(client,\{serviceScope:'supplier'/);
  assert.match(suppliers,/source='supplier_payment'/);
});

test('Supplier UI remains composed exactly at its layer',()=>{
  assert.match(suppliers,/href="\/suppliers\.css"/);
  assert.match(suppliers,/src="\/suppliers-ui\.js"/);
  assert.match(suppliers,/pathname==='\/'\|\|pathname==='\/index\.html'/);
});
