import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const m=JSON.parse(readFileSync(new URL('../marketing-kit/merchant-growth-manifest.json',import.meta.url),'utf8'));
test('merchant visual kit has mobile reference and three editable Canva masters',()=>{assert.match(m.figma.productReference.nodeId,/^\d+:\d+$/);assert.equal(m.assets.length,3);for(const a of m.assets)assert.equal(a.canvaStatus,'editable_master_ready')});
test('merchant visual claims remain bounded',()=>{assert.equal(m.claims.guaranteedProfit,false);assert.equal(m.claims.automaticMerchantApproval,false);assert.equal(m.claims.arbitraryExternalParcelDelivery,false)});
