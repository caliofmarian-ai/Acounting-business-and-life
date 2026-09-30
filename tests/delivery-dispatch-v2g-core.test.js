import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_OFFER_TTL_DEFAULT_SECONDS,
  deliveryOfferTtlSeconds,
  deliveryOfferExpiresAt,
  deliveryOfferExpired
} from '../delivery-dispatch-v2g-core.js';

test('Delivery offer TTL defaults to 120 seconds and is bounded',()=>{
  assert.equal(DELIVERY_OFFER_TTL_DEFAULT_SECONDS,120);
  assert.equal(deliveryOfferTtlSeconds({}),120);
  assert.equal(deliveryOfferTtlSeconds({DELIVERY_OFFER_TTL_SECONDS:'5'}),30);
  assert.equal(deliveryOfferTtlSeconds({DELIVERY_OFFER_TTL_SECONDS:'90'}),90);
  assert.equal(deliveryOfferTtlSeconds({DELIVERY_OFFER_TTL_SECONDS:'9999'}),600);
});

test('Delivery offer expiry timestamp is deterministic',()=>{
  const now=Date.parse('2026-09-30T20:00:00.000Z');
  assert.equal(
    deliveryOfferExpiresAt({nowMs:now,ttlSeconds:120}),
    '2026-09-30T20:02:00.000Z'
  );
});

test('Delivery offer expiry check fails closed for malformed timestamp',()=>{
  const now=Date.parse('2026-09-30T20:02:00.000Z');
  assert.equal(deliveryOfferExpired('2026-09-30T20:01:59.999Z',{nowMs:now}),true);
  assert.equal(deliveryOfferExpired('2026-09-30T20:02:01.000Z',{nowMs:now}),false);
  assert.equal(deliveryOfferExpired('not-a-date',{nowMs:now}),true);
  assert.equal(deliveryOfferExpired(null,{nowMs:now}),false);
});
