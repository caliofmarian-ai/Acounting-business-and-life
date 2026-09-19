import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const server=read('server-admin-operations.js');

test('profile drawer caches profile and Admin context instead of refetching every open',()=>{
  assert.match(shell,/PROFILE_CACHE_MS = 30000/);
  assert.match(shell,/ADMIN_CONTEXT_CACHE_MS = 60000/);
  assert.match(shell,/profileRefreshPromise/);
  assert.match(shell,/adminContextRefreshPromise/);
  assert.match(shell,/Date\.now\(\)-profileFetchedAt>=PROFILE_CACHE_MS/);
  assert.match(shell,/Date\.now\(\)-adminContextFetchedAt>=ADMIN_CONTEXT_CACHE_MS/);
});

test('in-flight profile and Admin context requests are deduplicated',()=>{
  assert.match(shell,/if\(profileRefreshPromise\)return profileRefreshPromise/);
  assert.match(shell,/if\(adminContextRefreshPromise\)return adminContextRefreshPromise/);
  assert.match(shell,/finally\{profileRefreshPromise=null\}/);
  assert.match(shell,/finally\{adminContextRefreshPromise=null\}/);
});

test('drawer never shows an incomplete profile list while Admin authority is loading',()=>{
  assert.match(shell,/const adminStale=!adminContextFetchedAt/);
  assert.match(shell,/Loading account and Admin access/);
  assert.match(shell,/Preparing the complete profile list/);
  const open=shell.slice(shell.indexOf('async function openDrawer'),shell.indexOf('function closeDrawer'));
  assert.match(open,/if\(snapshot\?\.account&&!profileStale&&!adminStale\)renderDrawer\(\)/);
  assert.match(open,/if\(adminStale\)tasks\.push\(refreshAdminContext\(\)\)/);
});

test('Admin identity endpoint does not build territory scope tree',()=>{
  const start=server.indexOf("app.get('/api/admin/me'");
  const end=server.indexOf("app.get('/api/admin/catalog'",start);
  const block=server.slice(start,end);
  assert.match(block,/getAdminAssignments/);
  assert.match(block,/adminIdentityPayload/);
  assert.doesNotMatch(block,/buildAdminScopeContext/);
  assert.match(server,/function adminIdentityPayload/);
});
