import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const market=read('public/marketplace-ui.js');
const delivery=read('public/delivery-ui.js');

test('Marketplace explicitly announces checkout rendering to Delivery',()=>{
  assert.match(market,/abl:marketplace-checkout-rendered/);
  assert.match(market,/businessId:Number\(currentStore\.business_id\)/);
});

test('Delivery checkout enhancement is event-driven without global polling or DOM observation',()=>{
  const start=delivery.indexOf('function observeCheckout');
  const end=delivery.indexOf('function applyDeliveryState',start);
  const block=delivery.slice(start,end);
  assert.match(block,/abl:marketplace-checkout-rendered/);
  assert.match(block,/ensureDeliveryQuoteUi\(\)/);
  assert.doesNotMatch(block,/setInterval/);
  assert.doesNotMatch(block,/MutationObserver/);
});

test('active live-delivery polling remains preserved separately',()=>{
  assert.match(delivery,/async function openLiveDelivery[\s\S]*setInterval/);
  assert.match(delivery,/if\(document\.getElementById\('deliveryWorkspace'\)\?\.classList\.contains\('hidden'\)\)return/);
});
