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


test('notification attention metadata is attached centrally to inbox and Web Push payloads',()=>{
  assert.match(core,/notificationAttention/);
  assert.match(core,/role_hint,e\.event_code,e\.category,e\.entity_type/);
  assert.match(core,/entity_id:row\.entity_id,attention/);
  assert.match(core,/\.\.\.message,attention:notificationAttention/);
  assert.match(server,/r\.role_hint,e\.id event_id/);
  assert.match(server,/soundVariant:soundPreferences\[msg\.attention\.soundSlot\]/);
});

test('branded foreground audio uses accepted fixed assets while the service worker remains OS-controlled',()=>{
  assert.match(ui,/new Audio\(data\.url\)/);
  assert.match(ui,/\/api\/notifications\/audio-url/);
  assert.doesNotMatch(sw,/new Audio\(/);
});


test('notification attention preferences persist sound vibration and important-alert controls',()=>{
  assert.match(core,/notification_attention_preferences/);
  assert.match(core,/sound_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(core,/vibration_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(core,/important_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(server,/\/api\/notifications\/attention-preferences/);
  assert.match(server,/attention_preferences:attentionPreferences/);
  assert.match(ui,/notificationSounds/);
  assert.match(ui,/notificationVibration/);
  assert.match(ui,/notificationImportantAlerts/);
});

test('Web Push consumes attention metadata without combining silent and vibration',()=>{
  assert.match(sw,/attention\.silent===true/);
  assert.match(sw,/else if\(Array\.isArray\(attention\.vibrate\)/);
  assert.match(sw,/renotify:Boolean\(attention\.renotify\)/);
  assert.match(sw,/requireInteraction:Boolean\(attention\.requireInteraction\)/);
  assert.match(core,/attentionPref\.vibration_enabled\?baseAttention\.vibrate:\[\]/);
  assert.match(core,/attentionPref\.important_alerts_enabled\?baseAttention\.requireInteraction:false/);
});


test('users can choose Set 1 2 or 3 independently for each notification sound slot',()=>{
  assert.match(core,/notification_sound_preferences/);
  assert.match(core,/PRIMARY KEY\(account_id,sound_slot\)/);
  assert.match(core,/DEFAULT_NOTIFICATION_SOUND_VARIANT/);
  assert.match(server,/\/api\/notifications\/sound-preference/);
  assert.match(server,/sound_variants:notificationSoundVariants\(\)/);
  assert.match(server,/sound_slots:notificationSoundSlots\(\)/);
  assert.match(server,/default_sound_variant:DEFAULT_NOTIFICATION_SOUND_VARIANT/);
  assert.match(ui,/data-sound-slot/);
  assert.match(ui,/Set 2 is the Business & Life default/);
});


test('notification audio preview is authenticated, short-lived and never exposes bucket credentials',()=>{
  assert.match(server,/\/api\/notifications\/audio-url/);
  assert.match(server,/const me=await identity\(req\)/);
  assert.match(server,/presignNotificationAudioUrl/);
  assert.match(server,/expiresIn=900/);
  assert.match(server,/Cache-Control','no-store/);
  assert.doesNotMatch(server,/NOTIFICATION_AUDIO_SECRET_ACCESS_KEY.*res\.json/s);
});

test('notification settings provide an explicit listen button for every sound slot',()=>{
  assert.match(ui,/data-preview-sound/);
  assert.match(ui,/▶ Listen/);
  assert.match(ui,/previewNotificationVoice/);
  assert.match(ui,/notificationAudioUrl/);
});

test('foreground voice polling establishes a baseline and only plays fresh unread audible events',()=>{
  assert.match(ui,/primeForegroundVoice/);
  assert.match(ui,/lastForegroundEventId=rows\[0\]\?\.event_id/);
  assert.match(ui,/fresh\.find\(row=>!row\.read_at&&row\.attention\?\.soundSlot&&!row\.attention\?\.silent\)/);
  assert.match(ui,/voicePollTimer=setInterval\(pollForegroundVoice,10000\)/);
  assert.match(ui,/foregroundSoundEnabled/);
  assert.match(ui,/audioUserInteracted/);
});


test('notification settings expose exact spoken transcripts and localized Filipino Set 2',()=>{
  assert.match(server,/voice_transcripts:notificationVoiceTranscriptMatrix\('en-PH'\)/);
  assert.match(server,/planned_voice_transcripts:notificationVoiceTranscriptMatrix\(preferredLocale\)/);
  assert.match(server,/localized_voice_variants:\{'fil-PH':\[2\]\}/);
  assert.match(ui,/data-voice-transcript/);
  assert.match(ui,/Set 2 speaks Filipino \/ Tagalog/);
  assert.match(ui,/localized_voice_variants/);
  assert.match(ui,/updateVoiceTranscript/);
  assert.doesNotMatch(ui,/Until that audio pack is generated/);
});
