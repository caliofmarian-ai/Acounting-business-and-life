import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const auth=read('public/auth-ui.js');
const hardening=read('public/auth-hardening-ui.js');
const profileSettings=read('public/profile-settings-ui.js');
const css=read('public/shell.css');

test('avatar drawer stays a switcher with one Account Settings entry',()=>{
  const drawer=shell.slice(shell.indexOf('function renderDrawer()'),shell.indexOf('function profileManagementMarkup()'));
  assert.match(drawer,/Active profiles/);
  assert.match(drawer,/id="accountSettingsButton"/);
  assert.doesNotMatch(drawer,/id="accountIdentityForm"/);
  assert.doesNotMatch(drawer,/Security & session/);
});

test('Account Settings is a dedicated routed workspace with focused categories',()=>{
  assert.match(shell,/id = 'accountSettingsWorkspace'/);
  assert.match(shell,/data-account-settings-view="personal"/);
  assert.match(shell,/data-account-settings-view="security"/);
  assert.match(shell,/data-account-settings-view="profiles"/);
  assert.match(shell,/Profile settings stay inside each profile/);
  assert.match(css,/\.accountSettingsWorkspace/);
});

test('security settings mount only inside the Security route and reuse canonical identity',()=>{
  assert.match(shell,/id="accountSecurityMount"/);
  assert.match(auth,/event\.detail\?\.view===['"]security['"]/);
  assert.match(hardening,/event\.detail\?\.view===['"]security['"]/);
  assert.match(hardening,/BusinessLifeProfileState\?\.snapshot\?\.account/);
  assert.doesNotMatch(hardening,/api\(['"]\/api\/me['"]\)/);
});

test('every operational profile retains its own Profile Settings card',()=>{
  assert.match(shell,/\['⚙️','Profile Settings'/);
  assert.match(shell,/merchantProfileSettingsCard/);
  assert.match(profileSettings,/openProfileSettings\(role=['"]{2}\)/);
});
