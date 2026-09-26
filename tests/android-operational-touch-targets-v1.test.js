import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const services=read('public/services.css');
const marketplace=read('public/marketplace.css');
const delivery=read('public/delivery.css');

test('Local Services operational actions meet the 44px Android touch contract',()=>{
  assert.match(services,/\.servicesBack\{width:44px;height:44px/);
  assert.match(services,/\.serviceFilter\{[^}]*min-height:44px/);
  assert.match(services,/\.requestServiceBtn\{[^}]*min-height:44px/);
  assert.match(services,/\.providerEditForm input,\.providerEditForm select,\.providerEditForm textarea\{[^}]*min-height:44px/);
  assert.match(services,/\.providerEditForm button\{[^}]*min-height:44px/);
  assert.match(services,/\.jobActions button\{[^}]*min-height:44px/);
  assert.match(services,/\.serviceModalActions button\{[^}]*min-height:44px/);
});

test('Marketplace operational actions meet the 44px Android touch contract',()=>{
  assert.match(marketplace,/\.marketBack\{width:44px;height:44px/);
  assert.match(marketplace,/\.marketFilter\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.addBasket\{[^}]*width:44px;height:44px/);
  assert.match(marketplace,/\.basketCheckout\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.basketClear\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.publishButton\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.imageAction\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.storeUploadButton\{[^}]*min-height:44px!important/);
  assert.match(marketplace,/\.storeMediaRemove\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.storeGalleryEditItem button\{[^}]*width:44px;height:44px/);
  assert.match(marketplace,/\.storeMapActions button\{min-height:44px/);
  assert.match(marketplace,/\.storeGeoResult\{[^}]*min-height:44px/);
  assert.match(marketplace,/\.storeDirections a\{[^}]*min-height:44px/);
});

test('Delivery operational actions meet the 44px Android touch contract',()=>{
  assert.match(delivery,/\.deliveryBack\{width:44px;height:44px/);
  assert.match(delivery,/\.deliveryBtn\{[^}]*min-height:44px/);
  assert.match(delivery,/\.deliveryForm input,\.deliveryForm select,\.deliveryForm textarea\{[^}]*min-height:44px/);
  assert.match(delivery,/\.deliveryForm button\{[^}]*min-height:44px/);
  assert.match(delivery,/\.deliveryQuoteCoords input\{[^}]*min-height:44px/);
  assert.match(delivery,/\.deliveryQuoteActions button\{[^}]*min-height:44px/);
});
