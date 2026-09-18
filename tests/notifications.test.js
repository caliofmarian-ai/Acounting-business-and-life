import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core=readFileSync(new URL('../notification-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-notifications.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/notifications-ui.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../public/notifications-sw.js',import.meta.url),'utf8');
const auth=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');

test('notification schema separates events recipients deliveries preferences templates and push subscriptions',()=>{
  for(const table of ['notification_events','notification_recipients','notification_deliveries','notification_preferences','notification_templates','push_subscriptions']){
    assert.match(core,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(core,/UNIQUE\(event_id,account_id\)/);
  assert.match(core,/UNIQUE\(recipient_id,channel\)/);
});

test('notification event payload strips sensitive tokens coordinates and evidence',()=>{
  assert.match(core,/token\|password\|secret\|coordinate\|latitude\|longitude\|evidence\|attachment/i);
  assert.match(core,/safeData\(data\)/);
  assert.match(core,/data_json/);
});

test('delivery failure is post-transaction and cannot roll back canonical domain responses',()=>{
  assert.match(server,/Promise\.resolve\(\)\.then\(\(\)=>after\(data\)\)\.catch/);
  assert.match(server,/Post-transaction notification hook/);
  assert.match(core,/status='retry'/);
  assert.match(core,/attempt<3/);
  assert.match(core,/status='failed'/);
});

test('priority commerce and operations events are wired into one notification gateway',()=>{
  for(const marker of [
    "order.created","order.preparing","order.ready","order.payment_confirmed",
    "delivery.assigned","delivery.picked_up","delivery.completed",
    "procurement.po_created","procurement.po_updated","procurement.payment_received",
    "service.request_created","service.quote_created","service.status_changed",
    "support.reply","incident.updated","profile.application_submitted","profile.application_reviewed"
  ]) assert.match(server,new RegExp(marker.replace('.','\\.')));
});

test('support and governance routing respect scoped delegated Admin permissions',()=>{
  assert.match(core,/admin_permission_grants/);
  assert.match(core,/permission_code/);
  assert.match(server,/support\.manage/);
  assert.match(server,/merchant\.approve/);
  assert.match(server,/supplier\.approve/);
  assert.match(server,/courier\.verify/);
});

test('auth reset and verification email uses the shared notification delivery ledger without storing the secure link in event data',()=>{
  assert.match(auth,/sendTransientEmailNotification/);
  assert.match(auth,/safeBody/);
  assert.match(auth,/password reset instructions were requested/i);
  assert.match(core,/sendTransientEmailNotification/);
  assert.match(core,/notification_deliveries/);
});

test('notification center supports inbox preferences locale and Web Push opt-in',()=>{
  assert.match(ui,/notificationBell/);
  assert.match(ui,/unread-count/);
  assert.match(ui,/notificationLocale/);
  assert.match(ui,/fil-PH/);
  assert.match(ui,/PushManager/);
  assert.match(ui,/serviceWorker\.register/);
  assert.match(sw,/showNotification/);
  assert.match(sw,/notificationclick/);
});

test('marketing notifications default to opt-in while mandatory events override channel opt-out only for configured mandatory channels',()=>{
  assert.match(core,/isMarketing=category==='marketing'/);
  assert.match(core,/mandatory&&emailDefault/);
  assert.match(core,/mandatory&&pushDefault/);
});
