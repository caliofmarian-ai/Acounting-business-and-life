import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const identity=read('identity-server.js');
const settings=read('public/profile-settings-ui.js');
const notifications=read('public/notifications-ui.js');
const legal=read('public/legal-ui.js');
const legalServer=read('server-legal.js');
const loader=read('public/mobile-feature-loader.js');
const css=read('public/shell.css');

test('signed-in bootstrap opens canonical Account Home instead of forcing a profile workspace',()=>{
  const start=shell.indexOf('async function refreshProfile');
  const end=shell.indexOf('function onShellVisibility',start);
  const block=shell.slice(start,end);
  assert.match(block,/renderAccountHome\(\)/);
  assert.doesNotMatch(block,/applyActiveRole\(\)/);
  assert.match(shell,/Choose where you want to continue/);
});

test('disabling an active profile preserves account continuity and chooses next enabled profile or null',()=>{
  assert.match(identity,/if\(!enabled\)\{const next=await pool\.query/);
  assert.match(identity,/enabled=TRUE AND role<>\$2/);
  assert.match(identity,/UPDATE accounts SET active_role=\$1[^]*next\.rows\[0\]\?\.role\|\|null/);
  const start=shell.indexOf('async function toggleProfile');
  const end=shell.indexOf('async function openDrawer',start);
  const block=shell.slice(start,end);
  assert.match(block,/enabled:false,visibility:'private'/);
  assert.match(block,/activeRole=snapshot\.account\.active_role\|\|null/);
  assert.match(block,/renderAccountHome\(\)/);
});

test('Account Settings shared utilities never silently switch operational profile',()=>{
  const start=shell.indexOf('function renderAccountSettings');
  const end=shell.indexOf('async function openAccountSettings',start);
  const block=shell.slice(start,end);
  assert.match(block,/accountNotifications/);
  assert.match(block,/accountLegalPrivacy/);
  assert.match(block,/accountHelpSupport/);
  assert.doesNotMatch(block,/\/api\/me\/active-role/);
  assert.doesNotMatch(block,/activeRole\s*=/);
});

test('notification language reuses account preferred_locale without claiming whole-app translation',()=>{
  assert.match(notifications,/notificationLocale/);
  assert.match(notifications,/\/api\/notifications\/locale/);
  assert.match(notifications,/en-PH/);
  assert.match(notifications,/fil-PH/);
  assert.match(legalServer,/SELECT preferred_locale FROM accounts/);
  assert.match(shell,/Language here controls supported account communications and document routing/);
  assert.match(shell,/does not yet translate every application screen/);
});

test('Account Settings reuses canonical Notifications Legal Privacy and Support implementations',()=>{
  assert.match(notifications,/BusinessLifeNotifications=Object\.freeze/);
  assert.match(shell,/BusinessLifeNotifications/);
  assert.match(legal,/BusinessLifeLegal=Object\.freeze\(\{open:openCenter,close:closeLegal\}\)/);
  assert.match(loader,/async function openLegalCenter\(\)/);
  assert.match(loader,/window\.BusinessLifeLegal/);
  assert.match(loader,/async function openSupport\(\)/);
  assert.match(shell,/BusinessLifeFeatureLoader/);
  assert.doesNotMatch(shell,/function openLegalCenter\(/);
  assert.doesNotMatch(shell,/function openSupport\(/);
});

test('Profile Settings remains tied to currently selected profile rather than Account Settings',()=>{
  assert.match(settings,/state\?\.surface!=='profile'/);
  assert.match(settings,/requested!==state\.activeRole/);
  assert.match(settings,/Open the profile first, then use its Settings card/);
  assert.match(shell,/Profile settings stay inside each profile/);
});

test('shared Account Settings utilities add no polling or identity observer',()=>{
  const start=shell.indexOf('function renderAccountSettings');
  const end=shell.indexOf('async function openAccountSettings',start);
  const block=shell.slice(start,end);
  assert.doesNotMatch(block,/setInterval\s*\(/);
  assert.doesNotMatch(block,/MutationObserver/);
  assert.doesNotMatch(block,/\/api\/me['"]/);
});

test('shared utility rows remain compact and touch-safe on mobile',()=>{
  assert.match(css,/\.accountUtilityList>button,.accountUtilityList>a\{[^}]*min-height:58px/);
  assert.match(css,/grid-template-columns:36px minmax\(0,1fr\) auto/);
  assert.match(css,/overflow-wrap:anywhere/);
  assert.match(css,/@media\(max-width:520px\)\{\.accountSettingsWorkspace/);
});
