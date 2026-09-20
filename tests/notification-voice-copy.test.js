import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationVoiceCopy,
  notificationVoiceLeaf,
  notificationVoiceLocales,
  notificationVoiceTranscriptMatrix,
  normalizeNotificationVoiceLocale
} from '../notification-voice-copy.js';

test('accepted English transcripts stay fixed for all three sets',()=>{
  assert.equal(notificationVoiceCopy({soundSlot:'general.info',variant:1}).text,'You have a new update.');
  assert.equal(notificationVoiceCopy({soundSlot:'general.info',variant:2}).text,'Psst... something new just landed.');
  assert.equal(notificationVoiceCopy({soundSlot:'general.info',variant:3}).text,'Business update. New information is available.');
  assert.equal(notificationVoiceCopy({soundSlot:'merchant.new_order',variant:2}).text,'New order! Time to make someone happy.');
  assert.equal(notificationVoiceCopy({soundSlot:'courier.new_delivery',variant:3}).text,'New delivery request received. Please review and respond.');
});

test('Tagalog copy is prepared for every accepted set without changing current audio storage',()=>{
  assert.deepEqual(notificationVoiceLocales(),['en-PH','fil-PH']);
  assert.equal(normalizeNotificationVoiceLocale('fil'),'fil-PH');
  assert.equal(normalizeNotificationVoiceLocale('tl-PH'),'fil-PH');
  assert.equal(notificationVoiceCopy({soundSlot:'merchant.new_order',variant:2,locale:'fil-PH'}).text,'Bagong order! Oras nang pasayahin ang isang customer.');
  assert.equal(notificationVoiceCopy({soundSlot:'finance.payment_received',variant:3,locale:'fil-PH'}).text,'Natanggap ang bayad. Na-update na ang financial record.');
});

test('role-specific action slots resolve to their actual shared or dedicated audio transcript leaf',()=>{
  assert.equal(notificationVoiceLeaf('merchant.new_order'),'merchant');
  assert.equal(notificationVoiceLeaf('courier.new_delivery'),'courier');
  assert.equal(notificationVoiceLeaf('merchant.action'),'action');
  assert.equal(notificationVoiceLeaf('supplier.action'),'action');
});

test('transcript matrix contains three choices for every supported slot',()=>{
  const matrix=notificationVoiceTranscriptMatrix('en-PH');
  for(const [slot,variants] of Object.entries(matrix)){
    assert.ok(slot);
    assert.deepEqual(Object.keys(variants),['1','2','3']);
    assert.ok(variants[1]);
    assert.ok(variants[2]);
    assert.ok(variants[3]);
  }
  assert.ok(Object.keys(matrix).length>=12);
});

test('unknown sound slots cannot create arbitrary transcript entries',()=>{
  assert.throws(()=>notificationVoiceCopy({soundSlot:'../../private',variant:2}),/Unknown notification sound slot/);
});
