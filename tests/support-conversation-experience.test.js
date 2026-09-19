import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-admin-operations.js');
const admin=read('public/admin-console.js');
const user=read('public/admin-operations-ui.js');
const notifications=read('public/notifications-ui.js');
const core=read('notification-core.js');
const notificationServer=read('server-notifications.js');
const loader=read('public/mobile-feature-loader.js');

test('support messages preserve user versus Admin context even for one account',()=>{
  assert.match(server,/actor_context TEXT NOT NULL DEFAULT 'user'/);
  assert.match(server,/actor_context,visibility,message\) VALUES\(\$1,\$2,'admin'/);
  assert.match(server,/m\.actor_context/);
  assert.match(user,/Business & Life Support/);
  assert.match(user,/fromAdmin/);
  assert.match(user,/fromUser/);
  assert.match(admin,/context=m\.actor_context==='admin'/);
});

test('support reply notification opens its exact ticket',()=>{
  assert.match(notifications,/entity_type==='support_ticket'/);
  assert.match(notifications,/BusinessLifeAdminOps\?\.openTicket/);
  assert.match(user,/abl:open-support-ticket/);
  assert.match(user,/support_ticket/);
  assert.match(core,/\?support_ticket=/);
  assert.match(loader,/BusinessLifeFeatureLoader=Object\.freeze\(\{openSupportTicket\}\)/);
  assert.match(notifications,/BusinessLifeFeatureLoader\?\.openSupportTicket/);
});

test('one inbox notification thread is shown per support ticket',()=>{
  assert.match(notificationServer,/ROW_NUMBER\(\) OVER\(PARTITION BY CASE WHEN e\.entity_type='support_ticket'/);
  assert.match(notificationServer,/WHERE thread_rank=1/);
  assert.match(notificationServer,/e\.entity_type='support_ticket' AND e\.entity_id=\$2/);
});

test('Admin Support has editable voice transcription and AI drafting',()=>{
  assert.match(admin,/adminVoiceStart/);
  assert.match(admin,/\/api\/support\/assist\/transcribe/);
  assert.match(admin,/Draft with AI/);
  assert.match(admin,/automatic/i);
  assert.match(server,/\/api\/admin\/support\/:id\/assist\/draft/);
  assert.match(server,/automatic_send:false/);
  assert.match(server,/never claim it has been sent/);
});

test('Admin Support can translate an editable reply to English or Tagalog',()=>{
  assert.match(admin,/adminTranslateLanguage/);
  assert.match(admin,/option value="English"/);
  assert.match(admin,/option value="Tagalog"/);
  assert.match(admin,/Translate with AI/);
  assert.match(admin,/assist\/translate/);
  assert.match(server,/\/api\/admin\/support\/:id\/assist\/translate/);
  assert.match(server,/translateAdminSupportReply/);
  assert.match(server,/automatic_send:false/);
});
