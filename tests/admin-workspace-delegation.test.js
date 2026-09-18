import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ADMIN_PERMISSIONS} from '../admin-authorization.js';
import {ADMIN_RANKS,ADMIN_FUNCTION_BUNDLES,canDelegateRank,expandAdminFunctions,isFunctionAssignableToRole} from '../admin-functions.js';

const auth=readFileSync(new URL('../admin-authorization.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-admin-operations.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/admin-console.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/admin-console.js',import.meta.url),'utf8');

test('Admin rank hierarchy separates protected owner authority from delegated specialist work',()=>{
  assert.equal(ADMIN_RANKS.super_admin.level,100);
  assert.ok(ADMIN_RANKS.country_admin.level>ADMIN_RANKS.territory_admin.level);
  assert.ok(ADMIN_RANKS.territory_admin.level>ADMIN_RANKS.specialist.level);
  assert.equal(canDelegateRank('super_admin','country_admin'),true);
  assert.equal(canDelegateRank('country_admin','territory_admin'),true);
  assert.equal(canDelegateRank('territory_admin','specialist'),true);
  assert.equal(canDelegateRank('specialist','specialist'),false);
  assert.equal(canDelegateRank('country_admin','super_admin'),false);
});

test('function bundles expand only to canonical Admin permissions',()=>{
  for(const bundle of Object.values(ADMIN_FUNCTION_BUNDLES)){
    assert.ok(bundle.permissions.includes('admin.console'));
    for(const p of bundle.permissions)assert.ok(ADMIN_PERMISSIONS.includes(p),bundle.code+' uses unknown permission '+p);
  }
  assert.ok(expandAdminFunctions(['support_operations'],'specialist').includes('support.manage'));
  assert.equal(isFunctionAssignableToRole('admin_delegation','specialist'),false);
  assert.equal(isFunctionAssignableToRole('support_operations','specialist'),true);
});

test('Admin schema and authorization support specialists without turning Admin into a public profile',()=>{
  assert.match(auth,/admin_function_assignments/);
  assert.match(auth,/specialist/);
  assert.match(auth,/platform_admin_assignments/);
  assert.match(auth,/admin_permission_grants/);
  assert.match(server,/\/api\/admin\/catalog/);
  assert.match(server,/canDelegateRank/);
  assert.match(server,/function_codes/);
});

test('dedicated Admin workspace is a separate permission-driven surface',()=>{
  assert.match(server,/\/admin-console\.html/);
  assert.match(server,/app\.get\('\/admin'/);
  assert.match(html,/Admin Workspace/);
  assert.match(ui,/No delegated Admin workspace is available/);
  assert.match(ui,/Team & Delegation/);
  assert.match(ui,/function_codes/);
  assert.match(ui,/state\.me\.permissions/);
});
