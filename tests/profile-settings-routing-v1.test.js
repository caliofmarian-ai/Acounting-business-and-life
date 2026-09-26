import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const money=read('public/profile-money-ui.js');
const accounting=read('public/business-accounting-ui.js');
const settings=read('public/profile-settings-ui.js');

test('shell owns one canonical Profile Settings router with visible loading feedback',()=>{
  assert.match(shell,/function openProfileSettingsForRole\(role\)/);
  assert.match(shell,/const open=window\.BusinessLifeProfileSettings\?\.open/);
  assert.match(shell,/if\(typeof open==='function'\)return open\(role\)/);
  assert.match(shell,/Profile Settings is still loading\. Try again in a moment\./);
  assert.match(shell,/openProfileSettings:openProfileSettingsForRole/);
});

test('Account Money and Banking has the same no-silent-click boundary',()=>{
  assert.match(shell,/function openAccountMoneySettings\(\)/);
  assert.match(shell,/const open=window\.BusinessLifeProfileSettings\?\.openAccountMoney/);
  assert.match(shell,/Money & Banking is still loading\. Try again in a moment\./);
  assert.match(shell,/accountMoneyBanking'\)\?\.addEventListener\('click',openAccountMoneySettings\)/);
  assert.match(shell,/openAccountMoneySettings,/);
});

test('Merchant Customer Courier Local Services and generic role settings use canonical shell router',()=>{
  assert.match(shell,/destination==='profileSettings'\)return openProfileSettingsForRole\('merchant'\)/);
  assert.match(shell,/openProfileSettingsForRole\('customer'\)/);
  assert.match(shell,/openProfileSettingsForRole\('courier'\)/);
  assert.match(shell,/openProfileSettingsForRole\('service_provider'\)/);
  assert.match(shell,/if\(feature==='Profile Settings'\)return openProfileSettingsForRole\(role\)/);
  assert.doesNotMatch(shell,/BusinessLifeProfileSettings\?\.open\?\./);
  assert.doesNotMatch(shell,/openAccountMoney\?\./);
});

test('Profile Money delegates Settings routing to shell and has a user-visible fallback',()=>{
  assert.match(money,/function openPmSettings\(\)/);
  assert.match(money,/shell\?\.openProfileSettings/);
  assert.match(money,/Profile Settings is still loading\. Try again in a moment\./);
  assert.match(money,/moneyOpenSettings'\)\?\.addEventListener\('click',openPmSettings\)/);
  assert.doesNotMatch(money,/BusinessLifeProfileSettings\?\.open\?\./);
});

test('Business Finance delegates Settings routing to shell and has a user-visible fallback',()=>{
  assert.match(accounting,/function openFinanceProfileSettings\(role\)/);
  assert.match(accounting,/shell\?\.openProfileSettings/);
  assert.match(accounting,/Profile Settings is still loading\. Try again in a moment\./);
  assert.match(accounting,/settings\.onclick=\(\)=>openFinanceProfileSettings\(overview\.role\)/);
  assert.doesNotMatch(accounting,/BusinessLifeProfileSettings\?\.open\?\./);
  assert.match(accounting,/function accountingToast\(message\)/);
  assert.doesNotMatch(accounting,/window\.alert/);
});

test('Profile Settings module keeps canonical active-profile boundary checks',()=>{
  assert.match(settings,/state\?\.surface!=='profile'/);
  assert.match(settings,/requested!==state\.activeRole/);
  assert.match(settings,/Open the profile first, then use its Settings card/);
  assert.match(settings,/BusinessLifeProfileSettings=Object\.freeze\(\{open:openProfileSettings,openAccountMoney:openAccountMoneySettings\}\)/);
});
