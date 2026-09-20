import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const shellCss=read('public/shell.css');
const help=read('public/help-linking.js');
const admin=read('public/admin-console.js');
const adminCss=read('public/admin-console.css');

test('profile activation is gated visibly by email verification before any onboarding request',()=>{
  const profiles=shell.slice(shell.indexOf('function profileManagementMarkup'),shell.indexOf('function accountSettingsHeader'));
  assert.match(profiles,/emailReady=Boolean\(account\.email_verified_at\)/);
  assert.match(profiles,/data-verify-email/);
  assert.match(profiles,/Verify email first/);
  assert.match(profiles,/data-complete-personal/);
  assert.match(shell,/Verify your email before activating a profile/);
  assert.match(shell,/openAccountSettings\('security'\)/);
  assert.match(shell,/openAccountSettings\('personal'\)/);
  assert.match(shellCss,/\.profileActivationGate/);
});

test('handled profile validation does not summon the global Help card over account controls',()=>{
  assert.match(help,/path==='\/api\/profiles\/customer\/activate'/);
  assert.match(help,/verify your email/);
});

test('Delivery owns tariff configuration while Finance explains and links to it',()=>{
  const delivery=admin.slice(admin.indexOf('function deliveryPricingPanel'),admin.indexOf('function deliveryCourierPanel'));
  assert.match(delivery,/<details class="adminDisclosure deliveryPricingDisclosure">/);
  assert.match(delivery,/Vehicle fees, distance rules and delivery capacity/);
  assert.match(admin,/Delivery tariffs are operational settings/);
  assert.match(admin,/data-open-admin-module="delivery"/);
  assert.match(admin,/activateModule\('delivery'\)/);
});

test('long Admin tools use progressive disclosure on mobile',()=>{
  assert.match(admin,/Monetization & subscriptions/);
  assert.match(admin,/Payments & commission planning/);
  assert.match(admin,/<details class="adminDisclosure delegationDisclosure">/);
  assert.match(admin,/Admin profile identity/);
  assert.match(admin,/href="\/\?account_settings=home"/);
  assert.match(adminCss,/\.adminDisclosure/);
  assert.match(adminCss,/\.financeDeliveryBoundary/);
});

test('Audit presents human labels, local readable time and scoped metric cards',()=>{
  assert.match(admin,/support_user_reply:'Support reply sent'/);
  assert.match(admin,/timeZone:'Asia\/Manila'/);
  assert.match(admin,/function auditMetricCards/);
  assert.match(admin,/Audit reference/);
  assert.doesNotMatch(admin,/<strong>'\+esc\(x\.event_code\|\|'Admin event'\)/);
});

test('Admin module changes avoid rebuilding the entire shell and delay loading feedback',()=>{
  const shellBlock=admin.slice(admin.indexOf('function shell()'),admin.indexOf('function showError'));
  assert.match(shellBlock,/activateModule/);
  assert.doesNotMatch(shellBlock,/state\.active=b\.dataset\.module;shell\(\)/);
  assert.match(admin,/setTimeout\(\(\)=>\{if\(request===state\.renderRequest\)/);
});
