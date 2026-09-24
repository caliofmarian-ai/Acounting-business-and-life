import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const suppliers=read('server-suppliers.js');
const services=read('server-services.js');
const marketplace=read('server-marketplace.js');
const qa=read('qa-acceptance.js');
const governance=read('server-profile-governance.js');

test('Local Services is embedded beneath Suppliers and localhost 3507 is retired',()=>{
  assert.match(services,/export async function startEmbeddedServices\(\)/);
  assert.match(services,/export async function stopEmbeddedServices\(\)/);
  assert.match(services,/Business & Life Local Services mounted in-process/);
  assert.match(services,/directExecution/);
  assert.match(services,/Business & Life Local Services server listening on/);
  assert.match(suppliers,/servicesFetch,startEmbeddedServices,stopEmbeddedServices/);
  assert.match(suppliers,/servicesApp=await startEmbeddedServices\(\)/);
  assert.match(suppliers,/return servicesApp\(req,res,next\)/);
  assert.doesNotMatch(suppliers,/INTERNAL_SERVICES_PORT/);
  assert.doesNotMatch(suppliers,/\|\|\s*3507/);
  assert.doesNotMatch(suppliers,/127\.0\.0\.1:3507/);
  assert.doesNotMatch(suppliers,/spawn\(process\.execPath,\['server-services\.js'\]/);
});

test('Supplier root composition delegates to embedded Local Services without stale localhost Services state',()=>{
  assert.doesNotMatch(suppliers,/\bupstreamPort\b/);
  assert.match(suppliers,/if\(pathname==='\/'\|\|pathname==='\/index\.html'\)\{\s*const r=await upstream\(path,options\);/);
  assert.match(suppliers,/async function upstream\(path,options=\{\}\)\{return servicesFetch\(path,options\)\}/);
});

test('Local Services remains standalone rollback-capable while Marketplace is embedded beneath it',()=>{
  assert.match(services,/startEmbeddedMarketplace/);
  assert.match(services,/stopEmbeddedMarketplace/);
  assert.match(services,/marketplaceApp=await startEmbeddedMarketplace\(\)/);
  assert.match(services,/return marketplaceApp\(req,res,next\)/);
  assert.doesNotMatch(services,/INTERNAL_MARKETPLACE_PORT/);
  assert.doesNotMatch(services,/\|\|\s*3407/);
  assert.doesNotMatch(services,/spawn\(process\.execPath,\['server-marketplace\.js'\]/);
  assert.match(marketplace,/spawn\(process\.execPath,\['server-orders\.js'\]/);
  assert.match(marketplace,/INTERNAL_ORDERS_PORT \|\| 3307/);
});

test('Local Services fetch facade refuses to bypass Service-owned routes',()=>{
  assert.match(services,/export function isServicesOwnedPath/);
  assert.match(services,/pathname\.startsWith\('\/api\/services\/'\)/);
  assert.match(services,/pathname\.startsWith\('\/api\/service-provider\/'\)/);
  assert.match(services,/pathname\.startsWith\('\/api\/admin\/service-credentials\/'\)/);
  assert.match(services,/LOCAL_SERVICES_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(services,/return marketplaceFetch\(path,options\)/);
});

test('Local Services domain ownership remains on server-services',()=>{
  for(const marker of [
    "app.get('/api/services/categories'",
    "app.get('/api/services/providers'",
    "app.get('/api/services/providers/:accountId'",
    "app.get('/api/service-provider/me'",
    "app.put('/api/service-provider/me'",
    "app.put('/api/service-provider/services'",
    "app.post('/api/service-provider/credentials'",
    "app.post('/api/service-provider/portfolio'",
    "app.post('/api/services/jobs'",
    "app.get('/api/services/jobs/mine'",
    "app.post('/api/service-provider/jobs/:id/quote'",
    "app.post('/api/services/jobs/:id/accept-quote'",
    "app.post('/api/service-provider/jobs/:id/status'",
    "app.post('/api/services/jobs/:id/confirm-completion'",
    "app.post('/api/services/jobs/:id/review'",
    "app.patch('/api/admin/service-credentials/:id'",
    "app.get('/services.css'",
    "app.get('/services-ui.js'"
  ])assert.ok(services.includes(marker),`missing Local Services marker: ${marker}`);
});

test('parsed JSON remains preserved through Local Services and is reconstructed only at Marketplace to Orders',()=>{
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(marketplace,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(marketplace,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(marketplace,/delete headers\['transfer-encoding'\]/);
  assert.match(marketplace,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('Local Services authorization state monetization and credential audit authorities remain intact',()=>{
  assert.match(services,/Service Provider profile required/);
  assert.match(services,/Customer profile required/);
  assert.match(services,/Cannot move job from \$\{current\.status\} to \$\{status\}/);
  assert.match(services,/Completed job not available for confirmation/);
  assert.match(services,/Review is available only after a completed, confirmed service job/);
  assert.match(services,/recordMonetizableCompletion\(client,\{serviceScope:'local_services'/);
  assert.match(services,/requireAdminPermission\(pool,me\.account\.id,'credential\.verify',territoryId\)/);
  assert.match(services,/appendAdminAudit\(pool/);
  assert.match(services,/service_credential\.reviewed/);
});

test('Local Services UI remains composed exactly at its layer',()=>{
  assert.match(services,/href="\/services\.css"/);
  assert.match(services,/src="\/services-ui\.js"/);
  assert.match(services,/pathname==='\/'\|\|pathname==='\/index\.html'/);
  assert.match(services,/const r=await servicesFetch\(req\.path,\{headers:req\.headers\}\)/);
});


test('Local Services V11 runtime acceptance is wired into canonical QA',()=>{
  assert.match(qa,/LOCAL_SERVICES_RUNTIME_V11_WAVE='local_services_runtime_v11'/);
  assert.match(qa,/runLocalServicesRuntimeV11Acceptance/);
  assert.match(qa,/config\.wave===LOCAL_SERVICES_RUNTIME_V11_WAVE/);
  assert.match(qa,/service_provider_experience_v1:true/);
  assert.match(qa,/root_composition:Boolean\(rootComposition\)/);
  assert.match(qa,/index_composition:Boolean\(indexComposition\)/);
});


test('Governance preserves Service category authorization then dispatches selection through the embedded runtime',()=>{
  const start=governance.indexOf("app.put('/api/service-provider/services'");
  const end=governance.indexOf("function proxy(req,res,next)",start);
  assert.ok(start>=0&&end>start,'Service Provider governance route is missing');
  const route=governance.slice(start,end);
  assert.match(route,/activeAuthorization\(me\.account\.id,'service_provider'\)/);
  assert.match(route,/service_category_authorizations/);
  assert.match(route,/filtered\.length!==requested\.length/);
  assert.match(route,/req\.body=\{\.\.\.req\.body,services:filtered\}/);
  assert.match(route,/return authHardeningApp\(req,res,next\)/);
  assert.doesNotMatch(route,/return forwardJson\(req,res,req\.originalUrl/);
});
