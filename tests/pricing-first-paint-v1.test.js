import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/pricing-transparency.js');
const css=read('public/pricing-transparency.css');

test('pricing slots reserve card geometry before awaiting the pricing request',()=>{
  const start=ui.indexOf('async function blFillPricing');
  const end=ui.indexOf('const blPricingObserver',start);
  const block=ui.slice(start,end);
  assert.match(ui,/function blPricingSkeleton\(node\)/);
  assert.match(ui,/node\.dataset\.blPricingReady='loading'/);
  assert.match(ui,/node\.setAttribute\('aria-busy','true'\)/);
  assert.match(ui,/blFeeLoading/);
  assert.match(block,/nodes\.forEach\(blPricingSkeleton\)/);
  const skeletonIndex=block.indexOf('nodes.forEach(blPricingSkeleton)');
  const awaitIndex=block.indexOf('await blPricingGet()');
  assert.ok(skeletonIndex>=0&&awaitIndex>skeletonIndex,'skeleton must be committed before the network await');
});

test('pricing loading skeleton never invents a price rate or fee',()=>{
  const start=ui.indexOf('function blPricingSkeleton');
  const end=ui.indexOf('async function blFillPricing',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/₱|%|0\.5|99|90 days|30 days/i);
  assert.match(block,/Loading pricing details/);
});

test('pricing success and failure hydrate the same reserved slot atomically',()=>{
  assert.match(ui,/n\.innerHTML=scope==='customer_checkout'\?blCheckoutCard\(data\):scope==='public'\?blPublicCard\(data\):blRoleCard\(scope,data\)/);
  assert.match(ui,/n\.dataset\.blPricingReady='1'/);
  assert.match(ui,/n\.removeAttribute\('aria-busy'\)/);
  assert.match(ui,/blFeeLoadError/);
  assert.match(ui,/n\.dataset\.blPricingReady='error'/);
});

test('pricing loading success and error cards keep stable minimum geometry',()=>{
  assert.match(css,/\.blFeeCard\{[^}]*min-height:86px/);
  assert.match(css,/\.blFeeLoading\{/);
  assert.match(css,/\.blFeeLoadError\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('pricing renderer keeps a single shared in-flight canonical pricing request',()=>{
  assert.match(ui,/let blPricingPromise=null/);
  assert.match(ui,/if\(!blPricingPromise\)blPricingPromise=fetch\(BL_PUBLIC_PRICING_ENDPOINT/);
  assert.match(ui,/const BL_PUBLIC_PRICING_ENDPOINT='\/api\/public\/pricing'/);
});
