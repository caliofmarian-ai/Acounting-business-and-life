import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const m=JSON.parse(readFileSync(new URL('../marketing-kit/supplier-growth-manifest.json',import.meta.url),'utf8'));
test('supplier visual kit has mobile reference and three editable Canva masters',()=>{assert.match(m.figma.productReference.nodeId,/^\d+:\d+$/);assert.equal(m.assets.length,3);for(const a of m.assets)assert.equal(a.canvaStatus,'editable_master_ready')});
test('supplier visual claims remain bounded',()=>{assert.equal(m.claims.guaranteedSales,false);assert.equal(m.claims.guaranteedPayment,false);assert.equal(m.claims.automaticSupplierApproval,false);assert.equal(m.claims.universalMerchantTrust,false)});
