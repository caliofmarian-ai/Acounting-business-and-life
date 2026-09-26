import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const shell=read('public/shell.js');
const loader=read('public/mobile-feature-loader.js');
const notifications=read('public/notifications-ui.js');
const legal=read('public/legal-ui.js');
const paymentsServer=read('server-payments.js');
const notificationServer=read('server-notifications.js');

test('canonical shell reserves all global topbar controls before feature modules run',()=>{
  const top=html.slice(html.indexOf('<div class="topActions">'),html.indexOf('</header>'));
  for(const id of ['lazySupportBtn','notificationBell','notificationBadge','onlineState','activeRolePill','accountAvatarButton','lazyMoreBtn']){
    assert.ok(top.includes('id="'+id+'"'),id+' must be present in first-paint HTML');
  }
  assert.ok(top.indexOf('lazySupportBtn')<top.indexOf('notificationBell'));
  assert.ok(top.indexOf('notificationBell')<top.indexOf('onlineState'));
  assert.ok(top.indexOf('onlineState')<top.indexOf('activeRolePill'));
  assert.ok(top.indexOf('accountAvatarButton')<top.indexOf('lazyMoreBtn'));
  assert.doesNotMatch(top,/refreshBtn|>Refresh</);
});

test('shell wires reserved profile controls instead of depending on late creation',()=>{
  const block=shell.slice(shell.indexOf('function ensureShellChrome'),shell.indexOf('function syncMerchantWorkspaceNavVisibility'));
  assert.match(block,/document\.querySelector\('\.shellProfileControls'\)/);
  assert.match(block,/const rolePill=controls\.querySelector\('#activeRolePill'\)/);
  assert.match(block,/const avatarButton=controls\.querySelector\('#accountAvatarButton'\)/);
  assert.match(block,/dataset\.shellWired/);
  assert.match(block,/insertBefore\(controls,more\)/);
});

test('Help and More hydrate their reserved controls and keep fallback creation only for non-canonical shells',()=>{
  const block=loader.slice(loader.indexOf('async function mountLaunchers'),loader.indexOf('async function ensureGovernance'));
  assert.match(block,/let help=document\.getElementById\('lazySupportBtn'\)/);
  assert.match(block,/help\.onclick=openSupport/);
  assert.match(block,/let more=document\.getElementById\('lazyMoreBtn'\)/);
  assert.match(block,/more\.onclick=openMore/);
});

test('notification module hydrates the reserved bell and badge without replacing topbar structure',()=>{
  const block=notifications.slice(notifications.indexOf('function addBell'),notifications.indexOf('async function refreshUnread'));
  assert.match(block,/let b=document\.getElementById\('notificationBell'\)/);
  assert.match(block,/b\.onclick=openNotifications/);
  assert.match(block,/if\(!b\.querySelector\('#notificationBadge'\)\)/);
  assert.match(notifications,/badge\.classList\.toggle\('hidden',!x\.unread\)/);
});

test('lazy Legal stays inside More and never adds a new canonical topbar button',()=>{
  const block=legal.slice(legal.indexOf('function addButton'),legal.indexOf('function openSheet'));
  assert.match(block,/if\(window\.__ABL_LAZY_FEATURES__\)return/);
  assert.match(loader,/openButtonFeature\('legal','legalCenterBtn'\)/);
});

test('first-paint topbar controls receive their CSS before body scripts in the composed runtime',()=>{
  assert.match(notificationServer,/notifications\.css/);
  assert.match(notificationServer,/notifications-ui\.js/);
  assert.match(paymentsServer,/mobile-feature-loader\.css/);
  assert.match(paymentsServer,/mobile-feature-loader\.js/);
});
