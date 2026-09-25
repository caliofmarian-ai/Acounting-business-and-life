import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const services=read('server-services.js');
const delivery=read('server-delivery.js');
const marketplace=read('server-marketplace.js');
const orders=read('server-orders.js');
const auth=read('server-auth.js');
const qa=read('qa-acceptance.js');
const workflow=read('.github/workflows/admin-runtime.yml');

test('Marketplace is embedded beneath Local Services and localhost 3407 is retired',()=>{
  assert.match(marketplace,/export async function startEmbeddedMarketplace\(\)/);
  assert.match(marketplace,/export async function stopEmbeddedMarketplace\(\)/);
  assert.match(marketplace,/Business & Life Marketplace mounted in-process/);
  assert.match(marketplace,/directExecution/);
  assert.match(marketplace,/Business & Life marketplace server listening on/);
  assert.match(services,/marketplaceFetch,startEmbeddedMarketplace,stopEmbeddedMarketplace/);
  assert.match(services,/marketplaceApp=await startEmbeddedMarketplace\(\)/);
  assert.match(services,/return marketplaceApp\(req,res,next\)/);
  assert.doesNotMatch(services,/INTERNAL_MARKETPLACE_PORT/);
  assert.doesNotMatch(services,/\|\|\s*3407/);
  assert.doesNotMatch(services,/127\.0\.0\.1:3407/);
  assert.doesNotMatch(services,/spawn\(process\.execPath,\['server-marketplace\.js'\]/);
});

test('Marketplace remains standalone rollback-capable while Orders is embedded beneath it',()=>{
  assert.match(marketplace,/startEmbeddedOrders/);
  assert.match(marketplace,/stopEmbeddedOrders/);
  assert.match(marketplace,/ordersApp=await startEmbeddedOrders\(\)/);
  assert.match(marketplace,/return ordersApp\(req,res,next\)/);
  assert.doesNotMatch(marketplace,/INTERNAL_ORDERS_PORT/);
  assert.doesNotMatch(marketplace,/\|\|\s*3307/);
  assert.doesNotMatch(marketplace,/spawn\(process\.execPath,\['server-orders\.js'\]/);
  assert.match(orders,/startEmbeddedAccountAuth/);
  assert.doesNotMatch(orders,/INTERNAL_AUTH_PORT/);
  assert.doesNotMatch(orders,/\|\|\s*3207/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
});

test('Delivery delegates shared checkout to the in-process Marketplace command without bypassing ownership',()=>{
  assert.match(marketplace,/export async function createEmbeddedMarketplaceOrder/);
  assert.match(delivery,/import \{createEmbeddedMarketplaceOrder\} from '\.\/server-marketplace\.js'/);
  assert.match(delivery,/createEmbeddedMarketplaceOrder\(\{authorization:authHeader\(req\),body:req\.body\?\?\{\}\}\)/);
  assert.doesNotMatch(delivery,/upstream\('\/api\/marketplace\/checkout'/);
});

test('Marketplace fetch facade refuses to bypass Marketplace-owned routes',()=>{
  assert.match(marketplace,/export function isMarketplaceOwnedPath/);
  assert.match(marketplace,/pathname\.startsWith\('\/api\/public\/marketplace\/'\)/);
  assert.match(marketplace,/pathname\.startsWith\('\/api\/marketplace\/'\)/);
  assert.match(marketplace,/pathname==='\/api\/merchant\/storefront'/);
  assert.match(marketplace,/\(\?:start\|cancel\)/);
  assert.match(marketplace,/MARKETPLACE_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(marketplace,/return ordersFetch\(path,options\)/);
});

test('Marketplace route ownership remains on server-marketplace',()=>{
  for(const marker of [
    "app.get('/api/public/marketplace/storefronts'",
    "app.get('/api/public/marketplace/storefronts/:businessId'",
    "app.get('/api/marketplace/storefronts'",
    "app.get('/api/marketplace/storefronts/:businessId'",
    "app.post('/api/marketplace/checkout'",
    "app.get('/api/merchant/storefront'",
    "app.put('/api/merchant/storefront'",
    "app.post('/api/merchant/storefront/import-legacy'",
    "app.post('/api/merchant/storefront/products'",
    "app.patch('/api/merchant/storefront/products/:id'",
    "app.post('/api/merchant/storefront/products/:id/images/generate'",
    "app.post('/api/merchant/storefront/products/:id/images/:mediaId/approve'",
    "app.post('/api/merchant/storefront/products/:id/images/:mediaId/archive'",
    "app.post('/api/orders/merchant/:id/start'",
    "app.post('/api/orders/merchant/:id/cancel'",
    "app.get('/marketplace.css'",
    "app.get('/marketplace-ui.js'",
    "app.get('/guest-explore.css'",
    "app.get('/guest-explore.js'"
  ])assert.ok(marketplace.includes(marker),`missing Marketplace marker: ${marker}`);
});

test('shared Merchant start and cancel remain Marketplace-first before Orders fallback',()=>{
  assert.match(marketplace,/if\(!\(await marketplaceOrderKind\(id\)\)\)return proxy\(req,res\)/);
  assert.match(marketplace,/marketplace_stock_events/);
  assert.match(marketplace,/order_stock_consumptions/);
  assert.match(marketplace,/source_kind='marketplace_product'/);
});

test('parsed request bodies stay in-process without a legacy Accounting HTTP boundary',()=>{
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(marketplace,/const parsedJsonBody=req\.body!==undefined/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
  assert.doesNotMatch(auth,/server-v03\.js/);
  assert.doesNotMatch(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.doesNotMatch(auth,/http\.request/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('Marketplace and Local Services root composition remains layered exactly once',()=>{
  assert.match(marketplace,/href="\/marketplace\.css"/);
  assert.match(marketplace,/href="\/guest-explore\.css"/);
  assert.match(marketplace,/src="\/marketplace-ui\.js"/);
  assert.match(marketplace,/src="\/guest-explore\.js"/);
  assert.match(services,/href="\/services\.css"/);
  assert.match(services,/src="\/services-ui\.js"/);
  assert.match(services,/const r=await marketplaceFetch\(path,options\)/);
});

test('Marketplace V12 runtime acceptance is wired into canonical QA',()=>{
  assert.match(qa,/MARKETPLACE_RUNTIME_V12_WAVE='marketplace_runtime_v12'/);
  assert.match(qa,/runMarketplaceRuntimeV12Acceptance/);
  assert.match(qa,/config\.wave===MARKETPLACE_RUNTIME_V12_WAVE/);
  assert.match(qa,/customer_marketplace_e2e_v1:true/);
  assert.match(qa,/root_composition:Boolean\(rootComposition\)/);
  assert.match(qa,/index_composition:Boolean\(indexComposition\)/);
});

test('Admin Runtime Contract watches Marketplace runtime changes on PR and main',()=>{
  const count=(workflow.match(/- 'server-marketplace\.js'/g)||[]).length;
  assert.equal(count,2);
});
