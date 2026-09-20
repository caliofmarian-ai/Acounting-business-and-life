import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const supplierUrl=new URL('../server-suppliers.js',import.meta.url);
const v3Url=new URL('../server-supplier-commercial-v3.js',import.meta.url);
const supplier=readFileSync(supplierUrl,'utf8');
const v3=readFileSync(v3Url,'utf8');

for(const [label,url] of [['Supplier server',supplierUrl],['Supplier Commercial V3 server',v3Url]]){
  test(label+' has valid JavaScript syntax',()=>{
    const r=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr||r.stdout);
  });
}

test('Supplier server initializes and registers V3 before proxy fallback',()=>{
  assert.match(supplier,/ensureSupplierCommercialV3Schema/);
  assert.match(supplier,/registerSupplierCommercialV3Routes/);
  assert.ok(supplier.indexOf('ensureSupplierCommercialV3Schema(pool)')>0);
  assert.ok(supplier.indexOf('registerSupplierCommercialV3Routes({app,pool,body,identity})')<supplier.indexOf('app.use(proxy)'));
});

test('future PO items snapshot handling mode and normal receiving records a supply lot',()=>{
  assert.match(supplier,/handling_mode_snapshot/);
  assert.match(supplier,/l\.item\.handling_mode\|\|'sealed_resale'/);
  assert.match(supplier,/recordPoReceiptLot\(client/);
  assert.match(supplier,/receiptInput:r/);
});

test('Supplier payment uses current commercial outstanding rather than blindly PO expected total',()=>{
  assert.match(supplier,/commercialOutstandingForPo\(pool,id\)/);
  assert.match(supplier,/current Supplier commercial outstanding amount/);
  assert.doesNotMatch(supplier,/const outstanding=Math\.max\(0,Number\(po\.expected_total\)-Number\(po\.paid_amount\)\)/);
});

test('V3 does not claim lot quarantine fully blocks aggregate inventory sales',()=>{
  assert.match(v3,/aggregate_inventory_sale_blocking:false/);
  assert.match(v3,/not yet fully lot-allocated for every sale/);
});
