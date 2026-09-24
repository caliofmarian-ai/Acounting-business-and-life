import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('orders-read-core.js');
const orders=read('server-orders.js');
const marketplace=read('server-marketplace.js');
const delivery=read('server-delivery.js');
const finance=read('server-delivery-finance.js');
const accounting=read('server-business-accounting.js');
const auth=read('server-auth.js');
const qa=read('qa-acceptance.js');
const workflow=read('.github/workflows/admin-runtime.yml');

test('Orders is embedded beneath Marketplace and localhost 3307 is retired',()=>{
  assert.match(orders,/export async function startEmbeddedOrders\(\)/);
  assert.match(orders,/export async function stopEmbeddedOrders\(\)/);
  assert.match(orders,/Business & Life Orders mounted in-process/);
  assert.match(orders,/directExecution/);
  assert.match(orders,/Business & Life order server listening on/);
  assert.match(marketplace,/ordersFetch,startEmbeddedOrders,stopEmbeddedOrders/);
  assert.match(marketplace,/ordersApp=await startEmbeddedOrders\(\)/);
  assert.match(marketplace,/return ordersApp\(req,res,next\)/);
  assert.doesNotMatch(marketplace,/INTERNAL_ORDERS_PORT/);
  assert.doesNotMatch(marketplace,/\|\|\s*3307/);
  assert.doesNotMatch(marketplace,/127\.0\.0\.1:3307/);
  assert.doesNotMatch(marketplace,/spawn\(process\.execPath,\['server-orders\.js'\]/);
});

test('Orders remains standalone rollback-capable over Auth on 3207',()=>{
  assert.match(orders,/spawn\(process\.execPath,\['server-auth\.js'\]/);
  assert.match(orders,/INTERNAL_AUTH_PORT \|\| 3207/);
  assert.match(orders,/Auth child failed health check/);
  assert.match(orders,/authReady=true/);
  assert.match(auth,/server-v03\.js/);
});

test('Orders fetch facade refuses to bypass Orders-owned paths',()=>{
  assert.match(orders,/export function isOrdersOwnedPath/);
  assert.match(orders,/pathname==='\/orders\.css'/);
  assert.match(orders,/pathname==='\/orders-ui\.js'/);
  assert.match(orders,/pathname==='\/api\/orders'/);
  assert.match(orders,/pathname\.startsWith\('\/api\/orders\/'\)/);
  assert.match(orders,/ORDERS_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(orders,/return internalFetch\(path,options\)/);
});

test('Orders route ownership remains on server-orders',()=>{
  for(const marker of [
    "app.get('/api/orders/products'",
    "app.post('/api/orders'",
    "app.get('/api/orders/mine'",
    "app.get('/api/orders/:id'",
    "app.post('/api/orders/:id/check-in'",
    "app.get('/api/orders/track/:token'",
    "app.get('/api/orders/merchant/list'",
    "app.post('/api/orders/merchant/create'",
    "app.post('/api/orders/merchant/:id/confirm-presence'",
    "app.post('/api/orders/merchant/:id/start'",
    "app.post('/api/orders/merchant/:id/ready'",
    "app.post('/api/orders/merchant/:id/handoff'",
    "app.post('/api/orders/merchant/:id/payment'",
    "app.post('/api/orders/merchant/:id/complete'",
    "app.post('/api/orders/merchant/:id/cancel'",
    "app.get('/api/orders/merchant/customers/:customerId/trust'",
    "app.put('/api/orders/merchant/customers/:customerId/trust'",
    "app.get('/orders-ui.js'",
    "app.get('/orders.css'"
  ])assert.ok(orders.includes(marker),`missing Orders marker: ${marker}`);
});

test('Marketplace keeps shared start and cancel authority before Orders fallback',()=>{
  assert.match(marketplace,/app\.post\('\/api\/orders\/merchant\/:id\/start',body,marketplaceStart\)/);
  assert.match(marketplace,/app\.post\('\/api\/orders\/merchant\/:id\/cancel',body,marketplaceCancel\)/);
  assert.match(marketplace,/if\(!\(await marketplaceOrderKind\(id\)\)\)return proxy\(req,res\)/);
  assert.match(marketplace,/source_kind='marketplace_product'/);
});

test('authorized cross-layer Order reads use the shared Orders read core',()=>{
  assert.match(core,/export async function readOrderDetail/);
  for(const source of [orders,marketplace,delivery,finance,accounting])assert.match(source,/readOrderDetail/);
  assert.doesNotMatch(marketplace,/childFetch.*api\/orders/);
  assert.doesNotMatch(delivery,/upstream.*api\/orders/);
  assert.doesNotMatch(finance,/downstreamFetch.*api\/orders/);
  assert.doesNotMatch(accounting,/upstream.*api\/orders/);
});

test('parsed JSON reconstruction moves to the final Orders to Auth HTTP boundary',()=>{
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(marketplace,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.match(orders,/Buffer\.from\(JSON\.stringify\(req\.body\?\?\{\}\)\)/);
  assert.match(orders,/headers\['content-length'\]=String\(payload\.length\)/);
  assert.match(orders,/delete headers\['transfer-encoding'\]/);
  assert.match(orders,/if\(payload\)up\.end\(payload\);else req\.pipe\(up\)/);
});

test('Orders root composes Auth exactly once before Marketplace decorators',()=>{
  assert.match(orders,/href="\/orders\.css"/);
  assert.match(orders,/src="\/orders-ui\.js"/);
  assert.match(orders,/internalFetch\(path,\{\.\.\.options,headers\}\)/);
  assert.match(marketplace,/ordersFetch\(req\.path,\{headers:req\.headers\}\)/);
});

test('Orders V13 runtime acceptance is wired into canonical QA',()=>{
  assert.match(qa,/ORDERS_RUNTIME_V13_WAVE='orders_runtime_v13'/);
  assert.match(qa,/runOrdersRuntimeV13Acceptance/);
  assert.match(qa,/config\.wave===ORDERS_RUNTIME_V13_WAVE/);
  assert.match(qa,/direct_order_creation:true/);
  assert.match(qa,/customer_history:true/);
  assert.match(qa,/public_tracker:true/);
  assert.match(qa,/merchant_trust:true/);
});

test('Admin Runtime Contract watches the shared Orders read core on PR and main',()=>{
  const count=(workflow.match(/- 'orders-read-core\.js'/g)||[]).length;
  assert.equal(count,2);
});
