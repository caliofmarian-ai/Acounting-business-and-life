import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const supplierUrl=new URL('../server-suppliers.js',import.meta.url);
const accountingUrl=new URL('../server-business-accounting.js',import.meta.url);
const sourcingUrl=new URL('../server-supplier-sourcing-v4.js',import.meta.url);
const coreUrl=new URL('../supplier-sourcing-core.js',import.meta.url);

const supplier=readFileSync(supplierUrl,'utf8');
const accounting=readFileSync(accountingUrl,'utf8');
const sourcing=readFileSync(sourcingUrl,'utf8');

for(const [label,url] of [
  ['Supplier server',supplierUrl],
  ['Business accounting server',accountingUrl],
  ['Supplier sourcing V4 server',sourcingUrl],
  ['Supplier sourcing V4 core',coreUrl]
]){
  test(label+' has valid JavaScript syntax',()=>{
    const r=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr||r.stdout);
  });
}

test('Supplier server initializes and registers V4 before proxy fallback',()=>{
  assert.match(supplier,/ensureSupplierSourcingV4Schema/);
  assert.match(supplier,/registerSupplierSourcingV4Routes/);
  assert.ok(supplier.indexOf('ensureSupplierSourcingV4Schema(pool)')>0);
  assert.ok(supplier.indexOf('registerSupplierSourcingV4Routes({app,pool,body,identity})')<supplier.indexOf('app.use(proxy)'));
});

test('both procurement gateways use one canonical preferred-source reorder helper',()=>{
  assert.match(supplier,/supplierReorderSuggestions\(pool,b\.id\)/);
  assert.match(accounting,/supplierReorderSuggestions\(pool,businessId\)/);
  assert.match(sourcing,/LEFT JOIN LATERAL/);
  assert.match(sourcing,/merchant_inventory_supplier_sources/);
  assert.match(sourcing,/ORDER BY ms\.preference_rank/);
  assert.match(sourcing,/rel\.state='accepted'/);
  assert.doesNotMatch(supplier,/if\(Number\(b\.id\)!==1\)return res\.json\(\[\]\)/);
});

test('reorder helper never creates purchase orders automatically',()=>{
  const helper=sourcing.slice(
    sourcing.indexOf('export async function supplierReorderSuggestions'),
    sourcing.indexOf('export const supplierSourcingV4Internals')
  );
  assert.doesNotMatch(helper,/INSERT INTO purchase_orders/);
  assert.doesNotMatch(helper,/supplier_quotes/);
  assert.match(helper,/PREFERRED_SOURCE/);
  assert.match(helper,/NO_CONFIGURED_SOURCE/);
});

test('V4 purchase order conversion snapshots the source quote',()=>{
  assert.match(sourcing,/ADD COLUMN IF NOT EXISTS source_quote_id/);
  assert.match(sourcing,/source_quote_id:Number\(quote\.id\)/);
  assert.match(sourcing,/price_per_pack_snapshot/);
  assert.match(sourcing,/handling_mode_snapshot/);
});
