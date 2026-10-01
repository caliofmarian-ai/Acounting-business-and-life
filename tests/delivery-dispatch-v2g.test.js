import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-delivery.js');
const ui=read('public/delivery-ui.js');
const v2f=read('delivery-dispatch-v2f-core.js');
const v2g=read('delivery-dispatch-v2g-core.js');

test('Delivery V2G persists offer expiry and backfills existing pending offers',()=>{
  assert.match(server,/expires_at TIMESTAMPTZ/);
  assert.match(server,/ALTER TABLE delivery_offers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ/);
  assert.match(server,/deliveryOfferTtlSeconds\(process\.env\)/);
  assert.match(server,/offered_at\+make_interval\(secs=>\$1::int\)/);
});

test('stale pending offers are expired lazily without background polling',()=>{
  const start=server.indexOf('async function expireStaleDeliveryOffers');
  const end=server.indexOf('async function pendingCourierOffers',start);
  const block=server.slice(start,end);
  assert.match(block,/status='expired'/);
  assert.match(block,/expires_at<=NOW\(\)/);
  assert.match(block,/offer_expired/);
  assert.match(block,/dof\.delivery_id=\$\$\{values\.length\}/);
  assert.match(block,/dof\.courier_account_id=\$\$\{values\.length\}/);
  assert.match(block,/dx\.business_id=\$\$\{values\.length\}/);
  assert.doesNotMatch(block,/dof\.delivery_id=\$\{values\.length\}/);
  assert.doesNotMatch(block,/dof\.courier_account_id=\$\{values\.length\}/);
  assert.doesNotMatch(block,/dx\.business_id=\$\{values\.length\}/);
  assert.doesNotMatch(block,/setInterval|setTimeout/);
});

test('Courier pending list hides expired offers and exposes only safe expiry timestamp',()=>{
  const start=server.indexOf('async function pendingCourierOffers');
  const end=server.indexOf('async function recordDispatchEvent',start);
  const block=server.slice(start,end);
  assert.match(block,/expireStaleDeliveryOffers/);
  assert.match(block,/dof\.expires_at/);
  assert.match(block,/dof\.expires_at>NOW\(\)/);
  assert.match(v2f,/expires_at:row\.expires_at\|\|null/);
  const viewStart=v2f.indexOf('export function deliveryOfferSafeView');
  const viewEnd=v2f.indexOf('export function deliveryOfferCourierGate',viewStart);
  assert.doesNotMatch(v2f.slice(viewStart,viewEnd),/dropoff_address|dropoff_lat|dropoff_lng|customer_contact/);
});

test('new dispatch offers receive bounded expiry and retry opens a new round only after pending offers end',()=>{
  const start=server.indexOf('async function createOfferRound');
  const end=server.indexOf('async function offerWaitingDeliveriesToCourier',start);
  const block=server.slice(start,end);
  assert.match(block,/expireStaleDeliveryOffers/);
  assert.match(block,/Courier offers are already pending/);
  assert.match(block,/NOW\(\)\+make_interval\(secs=>\$4::int\)/);
  assert.match(block,/nextRound=currentRound\+1/);
  assert.match(v2g,/DELIVERY_OFFER_TTL_DEFAULT_SECONDS=120/);
  assert.match(v2g,/DELIVERY_OFFER_TTL_MIN_SECONDS=30/);
  assert.match(v2g,/DELIVERY_OFFER_TTL_MAX_SECONDS=600/);
});

test('expired offer cannot be accepted or refused',()=>{
  for(const route of [
    "app.post('/api/courier/delivery-offers/:offerId/decline'",
    "app.post('/api/courier/delivery-offers/:offerId/accept'"
  ]){
    const start=server.indexOf(route);
    const end=server.indexOf("app.post('/api/courier/",start+route.length);
    const block=server.slice(start,end>start?end:start+8000);
    assert.match(block,/deliveryOfferExpired/);
    assert.match(block,/DELIVERY_OFFER_EXPIRED/);
    assert.match(block,/status='expired'/);
  }
});

test('Merchant Delivery board exposes pending-offer count and retry only after offers finish',()=>{
  const start=server.indexOf("app.get('/api/delivery/merchant'");
  const end=server.indexOf("app.post('/api/delivery/:id/request-courier'",start);
  const block=server.slice(start,end);
  assert.match(block,/dispatch_pending_offer_count/);
  assert.match(block,/dispatch_next_offer_expiry/);
  assert.match(block,/dof\.expires_at>NOW\(\)/);
  assert.match(ui,/Retry courier offers/);
  assert.match(ui,/No active courier offer/);
  assert.match(ui,/courier offer.*pending/);
});

test('Courier offer card displays response deadline without exposing Customer destination',()=>{
  const start=ui.indexOf('function courierOfferCard');
  const end=ui.indexOf('function courierDeliveriesPanel',start);
  const block=ui.slice(start,end);
  assert.match(block,/Respond by/);
  assert.match(block,/expires_at/);
  assert.match(block,/Expired offers cannot be accepted/);
  assert.doesNotMatch(block,/dropoff_address|dropoff_lat|dropoff_lng|customer_contact/);
});
