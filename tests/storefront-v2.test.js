import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('server-marketplace.js');
const market=read('public/marketplace-ui.js');
const marketCss=read('public/marketplace.css');
const guest=read('public/guest-explore.js');
const guestCss=read('public/guest-explore.css');

test('Storefront V2 adds explicit presence and privacy-safe location fields',()=>{
  assert.match(server,/presence_type TEXT NOT NULL DEFAULT 'online'/);
  assert.match(server,/public_location_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(server,/location_label TEXT NOT NULL DEFAULT ''/);
  assert.match(server,/finding_instructions TEXT NOT NULL DEFAULT ''/);
  assert.match(server,/opening_hours_text TEXT NOT NULL DEFAULT ''/);
  assert.match(server,/pickup_lat DOUBLE PRECISION/);
  assert.match(server,/pickup_lng DOUBLE PRECISION/);
  assert.match(server,/CHECK \(presence_type IN \('online','physical','both'\)\)/);
  assert.match(server,/function hidePrivateLocation\(row\)/);
  assert.match(server,/row\.public_location_enabled/);
  assert.match(server,/pickup_address:'',pickup_lat:null,pickup_lng:null/);
  assert.match(server,/CASE WHEN s\.public_location_enabled THEN s\.pickup_address ELSE '' END pickup_address/);
});

test('Storefront media has a dedicated business-scoped cover and gallery model',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS merchant_storefront_media/);
  assert.match(server,/CHECK \(media_kind IN \('cover','gallery'\)\)/);
  assert.match(server,/merchant_storefront_one_cover_idx/);
  assert.match(server,/const STOREFRONT_MEDIA_MAX=8/);
  assert.match(server,/app\.post\('\/api\/merchant\/storefront\/media'/);
  assert.match(server,/app\.delete\('\/api\/merchant\/storefront\/media\/:id'/);
  assert.match(server,/Gallery supports up to \$\{STOREFRONT_MEDIA_MAX\} photos/);
  assert.match(server,/Storefront image is too large/);
  assert.match(server,/STOREFRONT_IMAGE_RE/);
});

test('Merchant storefront form exposes guided public/internal semantics and media controls',()=>{
  for(const id of ['storeLogoInput','storeCoverInput','storeGalleryInput','storePresence','storePublicLocation','storeOpeningHours','storeFinding','storeUseGps','storeSearchAddress','storeLocationMap']){
    assert.ok(market.includes(id),id+' must be present in Storefront V2');
  }
  assert.match(market,/Required · Public/);
  assert.match(market,/Public only when location sharing is ON/);
  assert.match(market,/Private by default/);
  assert.match(market,/function addStoreHelp/);
  assert.match(market,/function prepareStoreImage/);
  assert.match(market,/Gallery supports up to 8 photos/);
  assert.match(marketCss,/\.storeFieldHelp\{/);
  assert.match(marketCss,/\.storefrontV2Section\{/);
});

test('Merchant can select GPS, explicit address search, map click and draggable pin',()=>{
  assert.match(market,/navigator\.geolocation\.getCurrentPosition/);
  assert.match(market,/storeEditorMap\.on\('click'/);
  assert.match(market,/draggable:true/);
  assert.match(market,/storeSearchAddress[^\n]*onclick=searchStoreAddress/);
  assert.match(market,/\/api\/merchant\/storefront\/geocode\?business_id=/);
  assert.match(market,/setStorePin\(item\.lat,item\.lng,16\)/);
});

test('Geocoding is explicit, cached, rate-limited and provider URL is runtime-configurable',()=>{
  assert.match(server,/MARKETPLACE_GEOCODER_URL/);
  assert.match(server,/geocodeCache=new Map/);
  assert.match(server,/1100-\(Date\.now\(\)-geocodeLastAt\)/);
  assert.match(server,/url\.searchParams\.set\('limit','5'\)/);
  assert.match(server,/User-Agent':GEOCODER_AGENT/);
  assert.match(server,/app\.get\('\/api\/merchant\/storefront\/geocode'/);
  assert.doesNotMatch(market,/storeAddress[^\n]{0,100}addEventListener\('input'[^\n]{0,160}searchStoreAddress/);
});

test('Public customer and guest storefronts render cover, gallery and location only from public projection',()=>{
  assert.match(market,/function enhancePublicStorefrontV2/);
  assert.match(market,/store\.cover_image_url/);
  assert.match(market,/store\.gallery_images/);
  assert.match(market,/store\.public_location_enabled/);
  assert.match(market,/Open in Google Maps/);
  assert.match(market,/Open in Waze/);
  assert.match(market,/renderPublicStoreMap\(store,'publicStoreMap'\)/);
  assert.match(guest,/function enhanceGuestStorefrontV2/);
  assert.match(guest,/guestPublicStoreMap/);
  assert.match(guest,/BusinessLifeMarketplace\?\.renderPublicStoreMap/);
  assert.match(guestCss,/\.guestStoreCover\{/);
  assert.match(guestCss,/\.guestStoreLocation/);
});

test('Storefront save payload includes new location and logo fields without publishing private accounting data',()=>{
  for(const field of ['presence_type','public_location_enabled','location_label','finding_instructions','opening_hours_text','pickup_lat','pickup_lng','logo_data_url']){
    assert.ok(market.includes(field),field+' must be included in the storefront save flow');
  }
  assert.match(server,/if\(publicLocation&&\(lat==null\|\|lng==null\)\)/);
  assert.match(server,/Set a valid map pin before making the store location public/);
  assert.doesNotMatch(server,/merchant_storefront_media[\s\S]{0,500}(?:margin|supplier_relationship|ledger|unit_cost)/i);
});
