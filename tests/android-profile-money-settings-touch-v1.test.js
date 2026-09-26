import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.css');
const money=read('public/profile-money.css');
const settings=read('public/profile-settings.css');

test('Courier and Local Services profile-home actions meet the 44px Android contract',()=>{
  assert.match(shell,/\.courierHomePartial button\{[^}]*min-height:44px/);
  assert.match(shell,/\.courierHomeSection \.hubSectionTitle button\{[^}]*min-height:44px/);
  assert.match(shell,/\.serviceProviderHomeEmpty button\{[^}]*min-height:44px/);
  assert.match(shell,/\.serviceProviderMoneyHome \.hubSectionTitle button\{[^}]*min-height:44px/);
});

test('Profile Money inputs and actions meet the 44px Android contract',()=>{
  assert.match(money,/\.moneyEntryForm input,\.moneyEntryForm select\{[^}]*min-height:44px/);
  assert.match(money,/\.moneySettingsButton\{[^}]*min-height:44px/);
  assert.match(money,/\.moneyReverse\{min-height:44px/);
});

test('Profile Settings controls meet the 44px Android contract',()=>{
  assert.match(settings,/\.settingsProfiles button\{[^}]*min-height:44px/);
  assert.match(settings,/\.settingsForm input,\.settingsForm select,\.settingsForm textarea\{[^}]*min-height:44px/);
  assert.match(settings,/\.settingsChecks label\{[^}]*min-height:44px/);
  assert.match(settings,/\.settingsPrimary,\.settingsSecondary,\.settingsDanger\{[^}]*min-height:44px/);
  assert.match(settings,/\.financialAccountActions button\{[^}]*min-height:44px/);
  assert.match(settings,/\.settingsMethodGrid label\{[^}]*min-height:44px/);
  assert.match(settings,/\.settingsAvatarEntry\{[^}]*min-height:44px/);
  assert.match(settings,/\.profileSettingsLinks button\{[^}]*min-height:44px/);
});
