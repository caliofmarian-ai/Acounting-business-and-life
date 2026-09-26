import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const delivery=read('public/delivery-ui.js');
const shell=read('public/shell.js');
const mobile=read('public/mobile-feature-loader.js');
const finance=read('public/business-accounting-ui.js');

test('Merchant tools expose Profile Settings as a first-class shell-owned mobile action',()=>{
  assert.match(shell,/data-merchant-mobile-action="profileSettings"/);
  assert.match(shell,/>Profile Settings<\/strong>/);
  assert.match(shell,/if\(destination==='profileSettings'\)/);
  assert.match(shell,/destination==='profileSettings'\)return openProfileSettingsForRole\('merchant'\)/);
  assert.doesNotMatch(mobile,/merchantMobileTools|profileSettings','⚙️'/);
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
