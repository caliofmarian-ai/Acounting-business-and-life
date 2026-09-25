import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const deliveryServer=read('server-delivery.js');
const paymentServer=read('server-payments.js');
const moneyCore=read('profile-money-core.js');
const deliveryUi=read('public/delivery-ui.js');
const qa=read('qa-acceptance.js');

function courierHomeBlock(){
  const start=shell.indexOf('const COURIER_HOME_CACHE_MS');
  const end=shell.indexOf('function renderServiceProviderHub',start);
  return shell.slice(start,end>start?end:undefined);
}

test('Courier Home baseline loads delivery profile and full Courier Money in parallel',()=>{
  const block=courierHomeBlock();
  assert.match(block,/Promise\.allSettled\(\[/);
  assert.match(block,/profileApi\('\/api\/courier\/delivery-profile'\)/);
  assert.match(block,/profileApi\('\/api\/profile-money\/courier'\)/);
  assert.match(block,/renderCourierHomeData/);
});

test('current Courier delivery profile endpoint carries documents and up to 100 delivery-history rows',()=>{
  const start=deliveryServer.indexOf("app.get('/api/courier/delivery-profile'");
  const end=deliveryServer.indexOf("app.post('/api/courier/documents'",start);
  const block=deliveryServer.slice(start,end);
  assert.match(block,/courier_documents/);
  assert.match(block,/LIMIT 100/);
  assert.match(block,/documents:docs\.rows/);
  assert.match(block,/deliveries:deliveries\.rows/);
});

test('current Courier Money endpoint loads recent delivery history and deep Money context',()=>{
  assert.match(paymentServer,/profileMoneySnapshot\(pool,role,me\.account\.id\)/);
  const start=moneyCore.indexOf('export async function courierMoneySnapshot');
  const end=moneyCore.indexOf('export async function serviceProviderMoneySnapshot',start);
  const block=moneyCore.slice(start,end);
  assert.match(block,/netAllocations\(pool,'courier_net',accountId\)/);
  assert.match(block,/ORDER BY d\.created_at DESC LIMIT 40/);
  assert.match(block,/recent_deliveries:recent\.rows/);
});

test('Courier Home does not activate live map polling or Leaflet before explicit route intent',()=>{
  const block=courierHomeBlock();
  assert.doesNotMatch(block,/loadLeaflet|renderDeliveryMap|openLiveDelivery|setInterval/);
  assert.match(deliveryUi,/async function loadLeaflet/);
  assert.match(deliveryUi,/async function openLiveDelivery/);
  const liveStart=deliveryUi.indexOf('async function openLiveDelivery');
  const liveEnd=deliveryUi.indexOf('async function openMerchantDelivery',liveStart);
  const live=deliveryUi.slice(liveStart,liveEnd);
  assert.match(live,/setInterval/);
  assert.match(live,/renderDeliveryMap/);
});

test('canonical Courier performance baseline records switch and Home waterfall separately',()=>{
  assert.match(qa,/COURIER_PERFORMANCE_BASELINE_WAVE='courier_performance_baseline_v1'/);
  assert.match(qa,/first_open_request_count:3/);
  assert.match(qa,/profile_switch_request_count:1/);
  assert.match(qa,/home_request_count:2/);
  assert.match(qa,/delivery_profile_ms/);
  assert.match(qa,/profile_money_ms/);
  assert.match(qa,/detailed_delivery_history_loaded_on_home:true/);
  assert.match(qa,/detailed_money_workspace_loaded_on_home:true/);
  assert.match(qa,/leaflet_loaded_on_home:false/);
});
