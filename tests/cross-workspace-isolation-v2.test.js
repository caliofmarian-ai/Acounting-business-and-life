import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const services=read('public/services-ui.js');
const money=read('public/profile-money-ui.js');
const settings=read('public/profile-settings-ui.js');

test('shell owns every profile feature workspace that can replace the hub',()=>{
  assert.match(shell,/FEATURE_WORKSPACE_IDS=\[[^\]]*servicesWorkspace[^\]]*profileMoneyWorkspace[^\]]*profileSettingsWorkspace/);
  assert.match(shell,/hideFeatureWorkspaces\(workspaceId\)/);
});

test('Local Services top-level routes delegate to canonical shell exclusivity',()=>{
  assert.match(services,/function openServicesWorkspace\(\)/);
  assert.match(services,/openFeatureWorkspace\?\.\('servicesWorkspace'\)/);
  assert.match(services,/async function openDirectory\(category=''\)\{if\(!openServicesWorkspace\(\)\)return/);
  assert.match(services,/async function openCustomerJobs\(\)\{if\(!openServicesWorkspace\(\)\)return/);
  assert.match(services,/openProviderWorkspace\(section='Profile'\)[\s\S]*if\(!openServicesWorkspace\(\)\)return/);
  assert.match(services,/profileMoneyWorkspace/);
  assert.match(services,/profileSettingsWorkspace/);
});

test('Profile Money routes through shell and keeps complete fallback isolation',()=>{
  assert.match(money,/function openPmWorkspace\(\)/);
  assert.match(money,/openFeatureWorkspace\?\.\('profileMoneyWorkspace'\)/);
  assert.match(money,/async function openPm\(role\)\{pmRole=role;if\(!pmtok\(\)\|\|!openPmWorkspace\(\)\)return/);
  assert.match(money,/profileSettingsWorkspace/);
  assert.match(money,/accountSettingsWorkspace/);
});

test('Profile Settings opened from a profile joins shell workspace ownership',()=>{
  assert.match(settings,/openFeatureWorkspace\?\.\('profileSettingsWorkspace'\)/);
  assert.match(settings,/profileMoneyWorkspace/);
});

test('Services and Profile Money never fall back to browser-native alerts',()=>{
  assert.doesNotMatch(services,/\balert\s*\(/);
  assert.doesNotMatch(money,/window\.alert|\balert\s*\(/);
  assert.match(services,/servicesFallbackToast/);
  assert.match(money,/profileMoneyFallbackToast/);
  assert.match(money,/catch\(err\)\{pmtoast\(err\.message\|\|'This entry could not be reversed\.'\)\}/);
});
