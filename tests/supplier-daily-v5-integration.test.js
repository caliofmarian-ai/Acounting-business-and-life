import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-suppliers.js',import.meta.url),'utf8');

test('Supplier server initializes and registers Daily V5 before proxy fallback',()=>{
  assert.match(server,/ensureSupplierDailyV5Schema/);
  assert.match(server,/registerSupplierDailyV5Routes/);
  const init=server.indexOf('ensureSupplierDailyV5Schema(pool)');
  const register=server.indexOf('registerSupplierDailyV5Routes({app,pool,body,identity})');
  const proxy=server.indexOf('app.use(proxy)');
  assert.ok(init>0);
  assert.ok(register>init);
  assert.ok(proxy>register);
});

test('V1-V4 Supplier routes remain registered alongside V5',()=>{
  assert.match(server,/registerSupplierDomainV2Routes/);
  assert.match(server,/registerSupplierCommercialV3Routes/);
  assert.match(server,/registerSupplierSourcingV4Routes/);
  assert.match(server,/\/api\/supplier\/orders\/:id\/respond/);
  assert.match(server,/\/api\/supplier\/orders\/:id\/status/);
});
