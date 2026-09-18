import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const modules={
  services:read('public/services-ui.js'),
  delivery:read('public/delivery-ui.js'),
  suppliers:read('public/suppliers-ui.js'),
  marketplace:read('public/marketplace-ui.js'),
  orders:read('public/orders-ui.js')
};

test('shell publishes the canonical reusable profile snapshot',()=>{
  assert.match(shell,/BusinessLifeProfileState/);
  assert.match(shell,/snapshot\s*[,}]/);
  assert.match(shell,/abl:profile-state/);
  assert.match(shell,/publishProfileState/);
});

test('role feature decorators are event-driven and never poll identity in background',()=>{
  for(const [name,source] of Object.entries(modules)){
    assert.doesNotMatch(source,/new\s+MutationObserver/,name+' must not observe DOM to rediscover profile state');
    assert.doesNotMatch(source,/setInterval\(\(\)=>decorate|setInterval\(\(\)=>decorate[A-Za-z]*/,name+' must not periodically redecorate profile state');
    assert.match(source,/abl:profile-state/,name+' must subscribe to canonical profile-state');
    assert.match(source,/BusinessLifeProfileState/,name+' must consume cached profile-state');
  }
});

test('operational polling remains separate from profile identity lifecycle',()=>{
  assert.match(modules.delivery,/openLiveDelivery[\s\S]*setInterval/);
  assert.match(modules.orders,/openCustomerOrders[\s\S]*setInterval/);
});
