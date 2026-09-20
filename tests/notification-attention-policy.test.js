import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationAttention,
  notificationAttentionFamilies,
  normalizeAttentionRole
} from '../notification-attention-policy.js';

test('attention taxonomy stays limited to the six owner-approved families',()=>{
  assert.deepEqual(notificationAttentionFamilies(),['info','success','action','urgent','finance','warning']);
});

test('role normalization keeps multi-profile attention deterministic',()=>{
  assert.equal(normalizeAttentionRole('delivery'),'courier');
  assert.equal(normalizeAttentionRole('super_admin'),'admin');
  assert.equal(normalizeAttentionRole('service-provider'),'service_provider');
  assert.equal(normalizeAttentionRole('unknown'),'');
});

test('merchant new order is action while customer delivery assignment is informational',()=>{
  assert.equal(notificationAttention({eventCode:'order.created',roleHint:'merchant',priority:'high'}).family,'action');
  assert.equal(notificationAttention({eventCode:'delivery.assigned',roleHint:'customer',priority:'high'}).family,'info');
});

test('courier assignment is an action and gets a courier-specific foreground sound key',()=>{
  const x=notificationAttention({eventCode:'delivery.assigned',roleHint:'courier',priority:'high'});
  assert.equal(x.family,'action');
  assert.equal(x.role,'courier');
  assert.equal(x.foregroundSoundKey,'bl-action-courier');
});

test('merchant and courier action cues remain distinguishable for multi-profile users',()=>{
  const merchant=notificationAttention({eventCode:'order.created',roleHint:'merchant'});
  const courier=notificationAttention({eventCode:'delivery.offer_received',roleHint:'courier'});
  assert.equal(merchant.foregroundSoundKey,'bl-action-merchant');
  assert.equal(courier.foregroundSoundKey,'bl-action-courier');
  assert.notEqual(merchant.foregroundSoundKey,courier.foregroundSoundKey);
});

test('finance and cancellation events cannot be confused with generic success',()=>{
  assert.equal(notificationAttention({eventCode:'order.payment_confirmed',roleHint:'merchant'}).family,'finance');
  assert.equal(notificationAttention({eventCode:'procurement.payment_received',roleHint:'supplier'}).family,'finance');
  assert.equal(notificationAttention({eventCode:'order.cancelled',roleHint:'customer'}).family,'warning');
});

test('status-bearing events resolve success and warning states centrally',()=>{
  assert.equal(notificationAttention({eventCode:'procurement.po_updated',data:{status:'received'}}).family,'success');
  assert.equal(notificationAttention({eventCode:'procurement.po_updated',data:{status:'rejected'}}).family,'warning');
  assert.equal(notificationAttention({eventCode:'service.status_changed',data:{status:'completed'}}).family,'success');
  assert.equal(notificationAttention({eventCode:'service.status_changed',data:{status:'failed'}}).family,'warning');
  assert.equal(notificationAttention({eventCode:'profile.application_reviewed',data:{status:'approved'}}).family,'success');
  assert.equal(notificationAttention({eventCode:'profile.application_reviewed',data:{status:'denied'}}).family,'warning');
});

test('urgent support and expiring offers have explicit high-attention behavior',()=>{
  const support=notificationAttention({eventCode:'support.ticket_created',roleHint:'admin',priority:'urgent',category:'support'});
  assert.equal(support.family,'urgent');
  assert.equal(support.requireInteraction,true);
  assert.equal(support.renotify,true);
  assert.ok(support.vibrate.length>0);

  const expiring=notificationAttention({eventCode:'delivery.offer_expiring',roleHint:'courier',priority:'urgent'});
  assert.equal(expiring.family,'urgent');
  assert.equal(expiring.repeat,'controlled');
});

test('controlled repeat is reserved for genuinely expiring action workflows',()=>{
  assert.equal(notificationAttention({eventCode:'delivery.offer_received',roleHint:'courier'}).repeat,'controlled');
  assert.equal(notificationAttention({eventCode:'order.merchant_ack_required',roleHint:'merchant'}).repeat,'controlled');
  assert.equal(notificationAttention({eventCode:'order.created',roleHint:'merchant'}).repeat,'none');
  assert.equal(notificationAttention({eventCode:'order.payment_confirmed',roleHint:'merchant'}).repeat,'none');
});

test('marketing is silent and cannot impersonate urgent operational attention',()=>{
  const x=notificationAttention({eventCode:'campaign.new_offer',category:'marketing',priority:'urgent'});
  assert.equal(x.family,'info');
  assert.equal(x.silent,true);
  assert.deepEqual(x.vibrate,[]);
  assert.equal(x.renotify,false);
  assert.equal(x.requireInteraction,false);
  assert.equal(x.foregroundSoundKey,'');
});

test('security fallback is warning rather than promotional or success feedback',()=>{
  const x=notificationAttention({eventCode:'auth.security_notice',category:'security',priority:'high'});
  assert.equal(x.family,'warning');
  assert.equal(x.silent,false);
  assert.equal(x.foregroundSoundKey,'bl-warning');
});
