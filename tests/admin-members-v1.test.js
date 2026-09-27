import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('admin-authorization.js');
const functions=read('admin-functions.js');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0,'Missing start marker: '+start);
  assert.ok(b>a,'Missing end marker: '+end);
  return source.slice(a,b);
}

test('Members uses a dedicated scoped Admin permission and delegable function',()=>{
  assert.match(auth,/'members\.view'/);
  assert.match(auth,/IN \('country_admin','territory_admin'\)/);
  assert.match(functions,/member_directory:Object\.freeze/);
  assert.match(functions,/permissions:\['admin\.console','members\.view'\]/);
  assert.match(functions,/assignable_to:\['country_admin','territory_admin','specialist'\]/);
});

test('Members API is server scoped and keeps Super Admin platform-wide',()=>{
  const block=between(server,'async function memberDirectoryScope','function dispatchBusinessAccounting');
  assert.match(block,/scopeFromContext\(ctx,permission,'territory_id'\)/);
  assert.match(block,/ctx\.superAdmin.*platformWide:true/);
  assert.match(block,/accountIdsInPsgcScope/);
  assert.match(block,/profile_authorizations/);
  assert.match(block,/profile_applications/);
  assert.match(block,/business_memberships/);
  assert.match(block,/requirePermissionFromContext\(ctx,'members\.view'\)/);
  assert.match(server,/app\.get\('\/api\/admin\/members'/);
});

test('Members API supports bounded search filters and avoids sensitive account/session fields',()=>{
  const block=between(server,'async function adminMembers','async function optionalMemberRows');
  assert.match(block,/Math\.min\(100,Number\(req\.query\.limit\)\|\|50\)/);
  assert.match(block,/Math\.min\(5000,Number\(req\.query\.offset\)\|\|0\)/);
  assert.match(block,/personal_public_id personal_id/);
  assert.match(block,/email_verified_at/);
  assert.match(block,/MAX\(s\.created_at\).*last_session_at/);
  assert.doesNotMatch(block,/a\.phone/);
  assert.doesNotMatch(block,/a\.address/);
  assert.doesNotMatch(block,/password_hash/);
  assert.doesNotMatch(block,/password_salt/);
  assert.doesNotMatch(block,/ip_hash/);
  assert.doesNotMatch(block,/session_id/);
});

test('Admin UI keeps Member Directory behind members.view while the unified Members parent can host governed profile work',()=>{
  assert.match(ui,/\{id:'members',label:'Members',any:\['members\.view',\.\.\.MEMBER_PROFILE_GOVERNANCE_PERMISSIONS\]\}/);
  assert.match(ui,/if\(hasAny\(\['members\.view'\]\)\)tabs\.push\(\{id:'directory'/);
  assert.match(ui,/if\(!hasAny\(\['members\.view'\]\)\)throw new Error\('Member Directory access is not delegated/);
  assert.match(ui,/async function membersPanel/);
  assert.match(ui,/\/api\/admin\/members\?/);
  assert.match(ui,/Account ID or Personal ID/);
  assert.match(ui,/All verification states/);
  assert.match(ui,/All profiles/);
  assert.match(ui,/Platform-wide/);
  assert.match(ui,/Private addresses, passwords, sessions, IP data and uploaded evidence are not exposed here/);
  assert.match(css,/ADMIN MEMBERS V1/);
  assert.match(css,/@media\(max-width:520px\)/);
});
