import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-delivery.js');
const ui=read('public/delivery-ui.js');
const shell=read('public/shell.js');
const notifications=read('server-notifications.js');
const notificationCore=read('notification-core.js');
const qa=read('qa-courier-acceptance.js');

test('Delivery dispatch persists governed offer rounds and audit events',()=>{
  assert.match(server,/ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS dispatch_round INTEGER NOT NULL DEFAULT 0/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS delivery_offers/);
  assert.match(server,/UNIQUE\(delivery_id,courier_account_id,offer_round\)/);
  assert.match(server,/CHECK\(status IN \('pending','accepted','declined','withdrawn','expired'\)\)/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS delivery_dispatch_events/);
});

test('Merchant request creates offers instead of directly assigning a Courier',()=>{
  const start=server.indexOf("app.post('/api/delivery/:id/request-courier'");
  const end=server.indexOf("app.get('/api/courier/home'",start);
  const block=server.slice(start,end);
  assert.match(block,/createOfferRound\(client,d/);
  assert.match(block,/dispatch_offer_count/);
  assert.match(block,/waiting_for_available_courier/);
  assert.doesNotMatch(block,/courier_account_id\s*=|status='courier_assigned'/);
});

test('Courier offers are eligibility-scoped and exact Customer destination is absent before acceptance',()=>{
  assert.match(server,/eligibleCouriersForDelivery/);
  assert.match(server,/courierTerritoryAuthorized/);
  assert.match(server,/courierHasActiveDelivery/);
  assert.match(server,/deliveryOfferCourierGate/);
  assert.match(server,/pendingCourierOffers/);
  const core=read('delivery-dispatch-v2f-core.js');
  const viewStart=core.indexOf('export function deliveryOfferSafeView');
  const viewEnd=core.indexOf('export function deliveryOfferCourierGate',viewStart);
  const view=core.slice(viewStart,viewEnd);
  assert.doesNotMatch(view,/dropoff_address|dropoff_lat|dropoff_lng|customer_name|customer_contact/);
});

test('Courier may decline without assignment and may accept atomically',()=>{
  const declineStart=server.indexOf("app.post('/api/courier/delivery-offers/:offerId/decline'");
  const acceptStart=server.indexOf("app.post('/api/courier/delivery-offers/:offerId/accept'");
  const statusStart=server.indexOf("app.post('/api/courier/deliveries/:id/status'",acceptStart);
  const decline=server.slice(declineStart,acceptStart);
  const accept=server.slice(acceptStart,statusStart);
  assert.match(decline,/status='declined'/);
  assert.doesNotMatch(decline,/UPDATE deliveries[\s\S]*courier_account_id|UPDATE deliveries[\s\S]*status='courier_assigned'/);
  assert.match(accept,/FOR UPDATE OF dof,d/);
  assert.match(accept,/d\.status!=='awaiting_courier'/);
  assert.match(accept,/courierOfferGateFromDb/);
  assert.match(accept,/status='courier_assigned'/);
  assert.match(accept,/status=CASE WHEN id=\$1 THEN 'accepted' ELSE 'withdrawn' END/);
  assert.match(accept,/UPDATE courier_profiles SET available=FALSE/);
  assert.match(accept,/assignment_mode:'courier_accept'/);
});

test('first accept wins and competing offers are withdrawn',()=>{
  const start=server.indexOf("app.post('/api/courier/delivery-offers/:offerId/accept'");
  const end=server.indexOf("app.post('/api/courier/deliveries/:id/status'",start);
  const block=server.slice(start,end);
  assert.match(block,/SELECT \* FROM deliveries WHERE id=\$1 FOR UPDATE/);
  assert.match(block,/d\.courier_account_id!=null/);
  assert.match(block,/WHERE delivery_id=\$2 AND offer_round=\$3 AND status='pending'/);
  assert.match(block,/WHERE courier_account_id=\$1 AND delivery_id<>\$2 AND status='pending'/);
});

test('availability can surface already waiting deliveries but active Courier cannot go available again',()=>{
  const start=server.indexOf("app.put('/api/courier/availability'");
  const end=server.indexOf("app.get('/api/courier/delivery-offers'",start);
  const block=server.slice(start,end);
  assert.match(block,/courierHasActiveDelivery/);
  assert.match(block,/offerWaitingDeliveriesToCourier/);
  assert.match(block,/new_offer_count/);
  assert.match(block,/new_offer_delivery_ids/);
  assert.match(block,/status='withdrawn'/);
  assert.match(block,/offer_withdrawn_unavailable/);
  assert.match(block,/withdrawn_offer_count/);
});

test('Admin assignment is exceptional and cannot override a Courier refusal',()=>{
  const start=server.indexOf("app.post('/api/admin/deliveries/:id/assign'");
  const end=server.indexOf('function proxy',start);
  const block=server.slice(start,end);
  assert.match(block,/override_reason/);
  assert.match(block,/requires an override reason/);
  assert.match(block,/status='declined'/);
  assert.match(block,/cannot be force-assigned/);
  assert.match(block,/admin_assignment_override/);
  assert.match(block,/courierOfferGateFromDb/);
  const adminUi=read('public/admin-console.js');
  assert.match(adminUi,/Normal dispatch is Courier-controlled/);
  assert.match(adminUi,/Manual Courier assignment/);
  assert.match(adminUi,/override_reason/);
  assert.match(adminUi,/Apply manual override/);
  assert.doesNotMatch(adminUi,/>Assign<\/button>/);
});

test('Courier Android UI separates incoming offers from accepted jobs',()=>{
  assert.match(ui,/New delivery offers/);
  assert.match(ui,/data-offer-accept/);
  assert.match(ui,/data-offer-decline/);
  assert.match(ui,/Accept delivery/);
  assert.match(ui,/Refuse/);
  assert.match(ui,/exact Customer address stays private until you accept/i);
  assert.match(ui,/A delivery becomes your job only after Accept succeeds/);
  assert.match(shell,/offer.*waiting/i);
  assert.match(shell,/Accept or Refuse/);
});

test('notifications distinguish offer from accepted assignment',()=>{
  assert.match(notificationCore,/delivery\.offer_received/);
  assert.match(notifications,/eventCode:'delivery\.offer_received'/);
  assert.match(notifications,/delivery-offer:\$\{offer\.offer_id\}:received/);
  assert.match(notifications,/app\.post\('\/api\/delivery\/:id\/request-courier'/);
  assert.match(notifications,/app\.post\('\/api\/courier\/delivery-offers\/:offerId\/accept'/);
  assert.match(notifications,/delivery\.assigned/);
});

test('Courier acceptance QA no longer depends on normal Admin assignment',()=>{
  assert.match(qa,/\/api\/courier\/delivery-offers/);
  assert.match(qa,/Controlled QA refusal before re-offer/);
  assert.match(qa,/Courier accepts Delivery offer/);
  assert.match(qa,/assignment_mode!=='courier_accept'/);
  const dispatchStart=qa.indexOf("if(delivery.status==='awaiting_courier')");
  const dispatchEnd=qa.indexOf("if(Number(delivery.courier_account_id)",dispatchStart);
  assert.doesNotMatch(qa.slice(dispatchStart,dispatchEnd),/\/api\/admin\/deliveries\/.*\/assign/);
});
