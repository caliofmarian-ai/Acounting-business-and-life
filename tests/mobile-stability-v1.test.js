import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

const shell=read('public/shell.js');
const governance=read('public/profile-governance-ui.js');
const admin=read('public/admin-operations-ui.js');
const adminConsole=read('public/admin-console.js');
const incidents=read('public/incidents-ui.js');
const legal=read('public/legal-ui.js');
const payments=read('public/payments-ui.js');
const auth=read('public/auth-hardening-ui.js');
const accounting=read('public/business-accounting-ui.js');
const notifications=read('public/notifications-ui.js');
const manifest=JSON.parse(read('public/manifest.webmanifest'));
const sw=read('public/sw.js');
const paymongo=read('server-paymongo.js');

test('profile drawer lifecycle is event-driven and cannot self-trigger a MutationObserver loop',()=>{
  assert.doesNotMatch(governance,/new\s+MutationObserver/);
  assert.doesNotMatch(governance,/setInterval\(/);
  assert.match(governance,/abl:drawer-rendered/);
  assert.match(shell,/abl:drawer-rendered/);
  assert.match(shell,/if \(snapshot\?\.account\) renderDrawer\(\)/);
});

test('high-frequency housekeeping pollers are removed from mobile UI modules',()=>{
  for(const [name,source] of Object.entries({admin,incidents,legal,payments,auth,accounting})){
    assert.doesNotMatch(source,/setInterval\(/,name+' should not use recurring housekeeping polling');
  }
  assert.doesNotMatch(admin,/new\s+MutationObserver/);
  assert.doesNotMatch(incidents,/new\s+MutationObserver/);
  assert.doesNotMatch(legal,/new\s+MutationObserver/);
  assert.doesNotMatch(payments,/new\s+MutationObserver/);
  assert.doesNotMatch(accounting,/new\s+MutationObserver/);
  assert.doesNotMatch(auth,/new\s+MutationObserver/);
});

test('notifications use low-frequency visible-only refresh without broad DOM observer',()=>{
  assert.doesNotMatch(notifications,/new\s+MutationObserver/);
  assert.match(notifications,/setInterval\([^\n]*60000/);
  assert.match(notifications,/!document\.hidden/);
});

test('blocking profile/admin requests have finite timeouts',()=>{
  assert.match(shell,/AbortController/);
  assert.match(shell,/10000/);
  assert.match(admin,/AbortController/);
  assert.match(admin,/12000/);
});

test('PWA has stable identity and never boots stale cached HTML',()=>{
  assert.equal(manifest.id,'/');
  assert.equal(manifest.start_url,'/');
  assert.doesNotMatch(sw,/PRECACHE=\[[^\]]*['"]\/['"]/);
  assert.match(sw,/request\.mode==='navigate'/);
  assert.match(sw,/cache:'no-store'/);
  assert.match(sw,/offline\.html/);
  assert.match(sw,/business-life-runtime-v16/);
});

test('Railway previews cannot expose installable PWA assets by default',()=>{
  assert.match(paymongo,/RAILWAY_SERVICE_NAME/);
  assert.match(paymongo,/railwayServiceName==='accounting-business-life'/);
  assert.match(paymongo,/PWA installation is disabled on preview services/);
  assert.match(paymongo,/app\.get\('\/manifest\.webmanifest'/);
  assert.match(paymongo,/app\.get\('\/sw\.js'/);
});

test('incident Admin shortcut is consolidated into the dedicated Admin workspace',()=>{
  assert.doesNotMatch(incidents,/incidentAdminButton/);
  assert.match(admin,/window\.location\.assign\('\/admin'\)/);
  assert.match(adminConsole,/Trust & Safety/);
  assert.match(adminConsole,/incident\.triage/);
});
