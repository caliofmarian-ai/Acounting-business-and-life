import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');

test('Supplier server initializes V2 schema before serving and registers routes before proxy fallback',()=>{
  assert.match(server,/ensureSupplierDomainV2Schema/);
  assert.match(server,/registerSupplierDomainV2Routes/);
  const init=server.indexOf('await ensureSupplierDomainV2Schema(pool)');
  const register=server.indexOf('registerSupplierDomainV2Routes({app,pool,body,identity})');
  const proxy=server.indexOf('app.use(proxy)');
  assert.ok(init>0,'V2 schema initializer should be wired');
  assert.ok(register>init,'V2 routes should register after initialization definition');
  assert.ok(proxy>register,'V2 routes must register before proxy fallback');
});

test('existing Supplier V1 receiving and payment routes remain present',()=>{
  assert.match(server,/\/api\/procurement\/orders\/:id\/receive/);
  assert.match(server,/\/api\/procurement\/orders\/:id\/payment/);
  assert.match(server,/\/api\/supplier\/orders\/:id\/respond/);
  assert.match(server,/recordMonetizableCompletion/);
});


test('new purchase orders snapshot the qualifying Supplier quantity-tier price',()=>{
  assert.match(server,/priceForQuantity/);
  assert.match(server,/FROM supplier_catalog_price_tiers/);
  assert.match(server,/tiersByItem/);
  assert.match(server,/selectedPrice/);
  assert.match(server,/l\.selectedPrice,l\.line/);
});
