import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('public/marketplace-ui.js');
const delivery=read('server-delivery.js');
const marketplace=read('server-marketplace.js');

test('Customer Delivery checkout shows Delivery and Final total before order submission',()=>{
  assert.match(ui,/Total products/);
  assert.match(ui,/checkoutDeliveryAmount/);
  assert.match(ui,/Final total/);
  assert.match(ui,/checkoutFinalAmount/);
  assert.match(ui,/checkoutDeliveryFee\(activeDeliveryQuote\)/);
  assert.match(ui,/t\.total\+deliveryFee/);
});

test('Customer Delivery checkout requests canonical quote from the actual basket',()=>{
  assert.match(ui,/\/api\/delivery\/quote/);
  assert.match(ui,/items:checkoutItemsPayload\(\)/);
  assert.match(ui,/dropoff_lat:lat,dropoff_lng:lng/);
  assert.match(ui,/activeDeliveryQuote=quote/);
  assert.match(ui,/customer_delivery_total\?\?quote\?\.fee/);
});

test('Delivery order cannot be submitted until the displayed quote is valid',()=>{
  assert.match(ui,/place\.disabled=true/);
  assert.match(ui,/checkoutQuoteExpired\(activeDeliveryQuote\)/);
  assert.match(ui,/body\.delivery_quote_id=Number\(activeDeliveryQuote\.id\)/);
  assert.match(ui,/Delivery price is missing or expired/);
  assert.match(ui,/Address changed\. Confirm it again to calculate Delivery/);
});

test('Customer can resolve a private checkout destination without exposing Admin territory mechanics',()=>{
  assert.match(ui,/\/api\/delivery\/address-search\?q=/);
  assert.match(ui,/Confirm address & calculate price/);
  assert.match(ui,/Use current location/);
  assert.match(delivery,/app\.get\('\/api\/delivery\/address-search'/);
  const start=delivery.indexOf("app.get('/api/delivery/address-search'");
  const end=delivery.indexOf("app.post('/api/delivery/quote'",start);
  const block=delivery.slice(start,end);
  assert.match(block,/requireCustomer\(req\)/);
  assert.match(block,/geocodeAddress\(req\.query\?\.q,country\)/);
  assert.match(block,/private, no-store, max-age=0/);
});

test('Delivery reuses the existing Marketplace geocoder instead of duplicating a public location service',()=>{
  assert.match(marketplace,/export async function geocodeAddress\(query,countryCode=''/);
  assert.match(delivery,/createEmbeddedMarketplaceOrder,geocodeAddress/);
});
