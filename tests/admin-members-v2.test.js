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

test('Members V2 separates read access from high-risk member controls',()=>{
  assert.match(auth,/'members\.view'/);
  assert.match(auth,/'members\.manage_status'/);
  assert.match(auth,/'members\.sessions\.revoke'/);
  assert.match(auth,/'members\.close_account'/);
  const bundle=between(functions,'member_account_controls:Object.freeze','profile_onboarding:Object.freeze');
  assert.match(bundle,/assignable_to:\['country_admin','territory_admin','specialist'\]/);
  assert.match(bundle,/permissions:\['admin\.console','members\.view','members\.manage_status','members\.close_account','members\.sessions\.revoke'\]/);
  const directory=between(functions,'member_directory:Object.freeze','member_account_controls:Object.freeze');
  assert.doesNotMatch(directory,/members\.manage_status/);
  assert.doesNotMatch(directory,/members\.sessions\.revoke/);
  assert.doesNotMatch(directory,/members\.close_account/);
});

test('Member detail reuses delegated scope and returns only safe security summaries',()=>{
  const block=between(server,'async function adminMemberDetails','async function ensureMemberControlTarget');
  assert.match(block,/memberScopeRecord\(ctx,accountId,'members\.view'\)/);
  assert.match(block,/password_configured/);
  assert.match(block,/active_session_count/);
  assert.match(block,/SELECT event_code,created_at FROM auth_security_events/);
  assert.match(block,/business_memberships/);
  assert.match(block,/profile_business_bindings/);
  assert.doesNotMatch(block,/SELECT[^\n]*ip_hash/);
  assert.doesNotMatch(block,/SELECT[^\n]*session_id/);
  assert.doesNotMatch(block,/evidence_data_url/);
  assert.doesNotMatch(block,/application_data/);
  assert.match(server,/app\.get\('\/api\/admin\/members\/:accountId'/);
});

test('Member controls require explicit confirmation, reason, audit and protect Super Admin/self',()=>{
  const block=between(server,'async function ensureMemberControlTarget','function dispatchBusinessAccounting');
  assert.match(block,/id===Number\(ctx\.accountId\)/);
  assert.match(block,/admin_role\)='super_admin'/);
  assert.match(block,/members\.manage_status/);
  assert.match(block,/members\.sessions\.revoke/);
  assert.match(block,/req\.body\?\.confirm!==true/);
  assert.match(block,/reason\.length<8/);
  assert.match(block,/appendAdminAudit/);
  assert.match(block,/member_account_suspended/);
  assert.match(block,/member_account_reactivated/);
  assert.match(block,/member_sessions_revoked/);
  assert.match(server,/app\.patch\('\/api\/admin\/members\/:accountId\/status'/);
  assert.match(server,/app\.post\('\/api\/admin\/members\/:accountId\/sessions\/revoke'/);
});

test('Members V2 UI provides a mobile detail workspace without destructive delete',()=>{
  assert.match(ui,/data-member-open/);
  assert.match(ui,/async function memberDetailPanel/);
  assert.match(ui,/Profiles/);
  assert.match(ui,/Applications/);
  assert.match(ui,/Authorizations/);
  assert.match(ui,/Businesses & memberships/);
  assert.match(ui,/Financial balances and payment credentials are not exposed here/);
  assert.match(ui,/Admin authority/);
  assert.match(ui,/Activity timeline/);
  assert.match(ui,/Sign out all active sessions/);
  assert.match(ui,/Suspend account/);
  assert.match(ui,/Reactivate account/);
  assert.match(ui,/Hard-delete is intentionally not available here/);
  assert.doesNotMatch(ui,/data-member-delete/);
  assert.match(css,/ADMIN MEMBERS V2/);
  assert.match(css,/\.memberDetailHero/);
  assert.match(css,/@media\(max-width:520px\)/);
});
