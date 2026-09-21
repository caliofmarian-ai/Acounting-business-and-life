import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');

function courierHomeBlock(){
  const start=shell.indexOf('const COURIER_HOME_CACHE_MS');
  const end=shell.indexOf('function renderRoleHub',start);
  assert.ok(start>=0&&end>start);
  return shell.slice(start,end);
}

test('Courier Home reads only canonical delivery profile and Courier Money in parallel',()=>{
  const block=courierHomeBlock();
  assert.match(block,/Promise\.allSettled\(\[/);
  assert.match(block,/profileApi\('\/api\/courier\/delivery-profile'\)/);
  assert.match(block,/profileApi\('\/api\/profile-money\/courier'\)/);
  assert.doesNotMatch(block,/\/api\/admin\//);
});

test('Courier Home uses a short cache plus explicit refresh instead of polling',()=>{
  const block=courierHomeBlock();
  assert.match(block,/const COURIER_HOME_CACHE_MS=20000/);
  assert.match(block,/Date\.now\(\)-courierHomeCache\.loadedAt<COURIER_HOME_CACHE_MS/);
  assert.match(block,/id="courierHomeRefresh"/);
  assert.match(block,/loadCourierHome\(hub,\{force:true\}\)/);
  assert.doesNotMatch(block,/setInterval\s*\(/);
  assert.doesNotMatch(block,/MutationObserver/);
  assert.doesNotMatch(block,/fetch\s*\(/);
});

test('Home availability stays server-authoritative and approval gated',()=>{
  const block=courierHomeBlock();
  assert.match(block,/profile\.eligibility_status!=='approved'/);
  assert.match(block,/eligibility_expires_at/);
  assert.match(block,/profileApi\('\/api\/courier\/availability',\{method:'PUT'/);
  assert.match(block,/Boolean\(result\?\.available\)!==desired/);
  assert.match(block,/Admin approval is required before availability can be enabled/);
  assert.match(block,/data-next-available=/);
});

test('Courier Home prioritizes active route then assigned delivery without inventing state',()=>{
  const block=courierHomeBlock();
  for(const state of ['courier_en_route_to_merchant','courier_arrived_at_merchant','picked_up','in_transit','courier_arrived_at_customer']){
    assert.match(block,new RegExp(state));
  }
  assert.match(block,/destination:'Tracking'/);
  assert.match(block,/destination:'Deliveries'/);
  assert.match(block,/No assigned delivery right now/);
});

test('Courier Home never turns customer delivery fees into Courier earnings',()=>{
  const block=courierHomeBlock();
  assert.match(block,/earnings\?\.tracked/);
  assert.match(block,/customerMoney\(earnings\.paid\)/);
  assert.match(block,/No courier_net allocation evidence exists/);
  assert.match(block,/Delivery fees stay customer charge context, not Courier earnings/);
  assert.doesNotMatch(block,/customerMoney\(summary\.customer_delivery_fees_context\)/);
});

test('Courier Home exposes honest loading partial error retry and empty states',()=>{
  const block=courierHomeBlock();
  for(const token of ['courierHomeLoading','courierHomeError','courierHomePartial','data-courier-home-retry','courierHomeEmpty']){
    assert.match(block,new RegExp(token));
  }
  assert.match(block,/No earnings amount has been assumed/);
});

test('Courier Home remains Android-first with usable actions and no horizontal grid dependency',()=>{
  assert.match(css,/\.courierPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(css,/\.courierStatusMain button,[^}]*\.courierAvailabilityRow button\{[^}]*min-height:44px/);
  assert.match(css,/\.courierCurrentWork button,[^}]*\.courierHomeEmpty button\{[^}]*min-height:44px/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/@media\(max-width:350px\)/);
});
