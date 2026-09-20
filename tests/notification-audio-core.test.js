import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationAudioDescriptor,
  notificationAudioConfigured,
  presignNotificationAudioUrl
} from '../notification-audio-core.js';

const env={
  NOTIFICATION_AUDIO_BUCKET:'notification-audio-test123',
  NOTIFICATION_AUDIO_ENDPOINT:'https://t3.storageapi.dev',
  NOTIFICATION_AUDIO_ACCESS_KEY_ID:'test_access_key',
  NOTIFICATION_AUDIO_SECRET_ACCESS_KEY:'test_secret_key',
  NOTIFICATION_AUDIO_REGION:'auto'
};

test('notification audio maps special and general slots to durable object keys',()=>{
  assert.equal(notificationAudioDescriptor({soundSlot:'merchant.new_order',variant:2}).key,'notifications/en-PH/set2/merchant.mp3');
  assert.equal(notificationAudioDescriptor({soundSlot:'courier.new_delivery',variant:3}).key,'notifications/en-PH/set3/courier.mp3');
  assert.equal(notificationAudioDescriptor({soundSlot:'finance.payment_received',variant:1}).key,'notifications/en-PH/set1/finance.mp3');
  assert.equal(notificationAudioDescriptor({soundSlot:'supplier.action',variant:2}).key,'notifications/en-PH/set2/action.mp3');
  assert.equal(notificationAudioDescriptor({soundSlot:'general.warning',variant:3}).key,'notifications/en-PH/set3/warning.mp3');
});

test('Filipino notification locale falls back explicitly to the currently available English audio assets',()=>{
  const x=notificationAudioDescriptor({soundSlot:'general.info',variant:2,locale:'fil-PH'});
  assert.equal(x.requested_locale,'fil-PH');
  assert.equal(x.audio_locale,'en-PH');
  assert.equal(x.locale_fallback,true);
  assert.equal(x.key,'notifications/en-PH/set2/info.mp3');
});

test('unknown slots are rejected instead of becoming arbitrary bucket keys',()=>{
  assert.throws(()=>notificationAudioDescriptor({soundSlot:'../../secret',variant:2}),/Unknown notification sound slot/);
});

test('notification audio config fails closed when bucket credentials are missing',()=>{
  assert.equal(notificationAudioConfigured({}),false);
  assert.equal(notificationAudioConfigured(env),true);
});

test('presigned GET URL uses virtual-hosted S3 style without exposing the secret',()=>{
  const url=presignNotificationAudioUrl({
    key:'notifications/en-PH/set2/merchant.mp3',
    expiresIn:900,
    now:new Date('2026-09-20T17:20:30.000Z'),
    env
  });
  const parsed=new URL(url);
  assert.equal(parsed.hostname,'notification-audio-test123.t3.storageapi.dev');
  assert.equal(parsed.pathname,'/notifications/en-PH/set2/merchant.mp3');
  assert.equal(parsed.searchParams.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256');
  assert.equal(parsed.searchParams.get('X-Amz-Date'),'20260920T172030Z');
  assert.equal(parsed.searchParams.get('X-Amz-Expires'),'900');
  assert.equal(parsed.searchParams.get('X-Amz-SignedHeaders'),'host');
  assert.match(parsed.searchParams.get('X-Amz-Credential')||'',/^test_access_key\/20260920\/auto\/s3\/aws4_request$/);
  assert.match(parsed.searchParams.get('X-Amz-Signature')||'',/^[a-f0-9]{64}$/);
  assert.equal(url.includes('test_secret_key'),false);
});

test('presigned URL expiry is bounded to one hour',()=>{
  const url=presignNotificationAudioUrl({key:'notifications/en-PH/set2/info.mp3',expiresIn:999999,now:new Date('2026-09-20T17:20:30.000Z'),env});
  assert.equal(new URL(url).searchParams.get('X-Amz-Expires'),'3600');
});
