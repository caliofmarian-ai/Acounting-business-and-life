import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const loader=read('public/mobile-feature-loader.css');
const shell=read('public/shell.css');
const notifications=read('public/notifications.css');
const merchant=read('public/v03.css');
const admin=read('public/admin-console.css');

test('global shell topbar and More controls meet the 44px Android touch contract',()=>{
  assert.match(loader,/\.lazyFeatureButton\{[^}]*min-height:44px/);
  assert.match(loader,/\.lazyMoreSheet header button\{width:44px;height:44px/);
  assert.match(loader,/\.merchantMobileToolsGrid button\{[^}]*min-height:44px/);
  assert.match(notifications,/\.notificationBell\{[^}]*min-width:44px;height:44px/);
  assert.match(shell,/\.accountAvatarButton\{[^}]*min-width:44px;min-height:44px/);
  assert.match(shell,/\.activeRolePill\{[^}]*min-height:44px/);
});

test('Account drawer and identity actions meet the 44px Android touch contract',()=>{
  assert.match(shell,/\.drawerClose\{[^}]*width:44px;height:44px/);
  assert.match(shell,/\.drawerBack\{width:44px;height:44px/);
  assert.match(shell,/\.roleAction\{[^}]*min-height:44px/);
  assert.match(shell,/\.publicIdentity button\{[^}]*min-height:44px/);
  assert.match(shell,/\.accountSettingsHeader>button\{width:44px;height:44px/);
});

test('Customer and Merchant secondary actions meet the 44px Android touch contract',()=>{
  assert.match(shell,/\.customerHomePartial button\{[^}]*min-height:44px/);
  assert.match(shell,/\.customerMoneyHome \.hubSectionTitle button\{[^}]*min-height:44px/);
  assert.match(merchant,/\.moneyAdvancedLinks button\{min-height:44px/);
});

test('compact Admin navigation remains explicitly outside this slice',()=>{
  assert.match(admin,/\.adminNav button\{[^}]*min-height:38px/);
});
