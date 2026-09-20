import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_SOUND_VARIANT,
  notificationSoundVariants,
  notificationSoundSlots,
  notificationSoundSlot,
  normalizeNotificationSoundVariant,
  isNotificationSoundSlot
} from '../notification-sound-options.js';

test('Set 2 is the fixed product default and appears first in user choices',()=>{
  assert.equal(DEFAULT_NOTIFICATION_SOUND_VARIANT,2);
  const variants=notificationSoundVariants();
  assert.deepEqual(variants.map(x=>x.id),[2,1,3]);
  assert.equal(variants[0].isDefault,true);
  assert.match(variants[0].label,/Set 2/);
});

test('all three accepted sound sets remain selectable',()=>{
  const variants=notificationSoundVariants();
  assert.deepEqual(new Set(variants.map(x=>x.id)),new Set([1,2,3]));
  assert.equal(normalizeNotificationSoundVariant(1),1);
  assert.equal(normalizeNotificationSoundVariant(2),2);
  assert.equal(normalizeNotificationSoundVariant(3),3);
  assert.equal(normalizeNotificationSoundVariant(99),2);
});

test('new merchant orders and new courier delivery requests have independent sound slots',()=>{
  assert.equal(notificationSoundSlot({eventCode:'order.created',role:'merchant',family:'action'}),'merchant.new_order');
  assert.equal(notificationSoundSlot({eventCode:'delivery.assigned',role:'courier',family:'action'}),'courier.new_delivery');
  assert.notEqual(
    notificationSoundSlot({eventCode:'order.created',role:'merchant',family:'action'}),
    notificationSoundSlot({eventCode:'delivery.assigned',role:'courier',family:'action'})
  );
});

test('finance and role-specific actions map to stable configurable slots',()=>{
  assert.equal(notificationSoundSlot({eventCode:'order.payment_confirmed',role:'merchant',family:'finance'}),'finance.payment_received');
  assert.equal(notificationSoundSlot({eventCode:'procurement.po_created',role:'supplier',family:'action'}),'supplier.action');
  assert.equal(notificationSoundSlot({eventCode:'service.request_created',role:'service_provider',family:'action'}),'service.action');
});

test('slot catalog contains every slot returned by the mapping policy',()=>{
  const ids=new Set(notificationSoundSlots().map(x=>x.id));
  for(const id of [
    'merchant.new_order','merchant.action','courier.new_delivery','courier.action',
    'supplier.action','service.action','finance.payment_received','general.info',
    'general.success','general.action','general.urgent','general.warning'
  ]) assert.equal(ids.has(id),true,id);
  assert.equal(isNotificationSoundSlot('merchant.new_order'),true);
  assert.equal(isNotificationSoundSlot('unknown.slot'),false);
});
