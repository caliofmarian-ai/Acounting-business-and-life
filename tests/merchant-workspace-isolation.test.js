import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const delivery=read('public/delivery-ui.js');
const mobile=read('public/mobile-feature-loader.js');
const finance=read('public/business-accounting-ui.js');

test('Merchant tools expose Profile Settings as a first-class card',()=>{
  assert.match(mobile,/\['profileSettings','⚙️','Profile Settings'\]/);
  assert.match(mobile,/settings\.open\('merchant'\)/);
  assert.doesNotMatch(mobile,/\['accountAvatarButton','👤','Merchant'\]/);
});

test('Merchant Delivery contains no Admin controls or personal-ID privilege checks',()=>{
  assert.doesNotMatch(delivery,/account\?\.id\)===1/);
  assert.doesNotMatch(delivery,/Admin • Delivery/);
  assert.doesNotMatch(delivery,/Admin • Couriers/);
  assert.doesNotMatch(delivery,/data-del-assign/);
  assert.doesNotMatch(delivery,/\/api\/admin\/delivery/);
  assert.doesNotMatch(delivery,/\/api\/admin\/couriers/);
});

test('Merchant finance routes payout preferences to Profile Settings',()=>{
  assert.match(finance,/Payment and banking settings/);
  assert.match(finance,/Personal bank details stay securely under Account · Money & Banking/);
  assert.match(finance,/Manage settings/);
  assert.doesNotMatch(finance,/>Banking settings</);
});
