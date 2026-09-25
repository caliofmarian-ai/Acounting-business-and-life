import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const auth=read('public/auth-ui.js');
const hardening=read('public/auth-hardening-ui.js');
const profileSettings=read('public/profile-settings-ui.js');
const css=read('public/shell.css');

test('avatar routes directly to the canonical Account Home instead of opening a duplicate menu',()=>{
  assert.match(shell,/accountAvatarButton'\)\.addEventListener\('click', openAccountHome\)/);
  assert.match(shell,/aria-label="Open Account Home"/);
  assert.match(shell,/function openAccountHome\(\)/);
  assert.doesNotMatch(shell,/accountAvatarButton'\)\.addEventListener\('click', openDrawer\)/);
});

test('Account Home is the one selector for profiles Admin and account settings',()=>{
  const home=shell.slice(shell.indexOf('function renderAccountHome()'),shell.indexOf('function applyActiveRole()'));
  assert.match(home,/accountProfileGrid/);
  assert.match(home,/id="accountAdminProfile"/);
  assert.match(home,/id="accountHomeSettings"/);
  assert.match(home,/id="accountHomeSignOut"/);
  assert.match(home,/accountIdentityLabel\(account\)/);
  assert.match(shell,/function accountIdentityLabel\(account=snapshot\?\.account\).*'Test Account ID':'Personal ID'/);
  assert.match(css,/\.accountHomeAction/);
  assert.match(css,/@media\(max-width:520px\)\{\.accountProfileGrid\{grid-template-columns:1fr\}/);
  assert.match(css,/Account Home Visual Polish V1/);
  assert.match(css,/\[data-account-role="merchant"\]/);
  assert.match(css,/\[data-account-role="customer"\]/);
  assert.match(css,/\[data-account-role="supplier"\]/);
  assert.match(css,/\[data-account-role="courier"\]/);
  assert.match(css,/\[data-account-role="service_provider"\]/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('sign out is permanently reachable and ends the current server and browser session',()=>{
  assert.match(shell,/id="drawerSignOutButton"/);
  assert.match(shell,/function signOutCurrentAccount\(button\)/);
  assert.match(shell,/profileApi\('\/api\/auth\/logout',\{method:'POST',body:'\{\}'\}\)/);
  assert.match(shell,/localStorage\.removeItem\('abl_token'\)/);
  assert.match(shell,/window\.location\.replace\('\/'\)/);
  assert.match(css,/\.accountSignOutEntry/);
  assert.match(css,/\.accountSignOutAction/);
});

test('Account Settings is a dedicated routed workspace with focused categories',()=>{
  assert.match(shell,/id = 'accountSettingsWorkspace'/);
  assert.match(shell,/data-account-settings-view="personal"/);
  assert.match(shell,/data-account-settings-view="security"/);
  assert.match(shell,/data-account-settings-view="profiles"/);
  assert.match(shell,/id="accountMoneyBanking"/);
  assert.match(shell,/id="accountNotifications"/);
  assert.match(shell,/id="accountLegalPrivacy"/);
  assert.match(shell,/id="accountHelpSupport"/);
  assert.match(shell,/href="\/help"/);
  assert.match(shell,/openAccountMoney/);
  assert.match(shell,/BusinessLifeNotifications/);
  assert.match(shell,/BusinessLifeFeatureLoader/);
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
  assert.doesNotMatch(shell,/merchantProfileSettingsCard/);
  assert.match(profileSettings,/openProfileSettings\(role=['"]{2}\)/);
});

test('shared Account Settings utilities are compact progressive rows on Android',()=>{
  assert.match(css,/\.accountUtilityList\{[^}]*display:grid/);
  assert.match(css,/\.accountUtilityList>button,.accountUtilityList>a\{[^}]*min-height:58px/);
  assert.match(shell,/Language here controls supported account communications and document routing/);
  assert.match(shell,/It does not yet translate every application screen/);
});
