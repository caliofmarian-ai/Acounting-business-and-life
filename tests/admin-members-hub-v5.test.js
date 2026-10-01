import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const functions=read('admin-functions.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0,'Missing start marker: '+start);
  assert.ok(b>a,'Missing end marker: '+end);
  return source.slice(a,b);
}

test('Commerce readiness is reachable from the current Admin Members Hub and keeps the second gate explicit',()=>{
  assert.match(ui,/function commerceReadinessRowsFromAuthorizations/);
  assert.match(ui,/function commerceReadinessRow/);
  assert.match(ui,/async function openAdminCommerceReadiness/);
  assert.match(ui,/\/api\/governance\/admin\/readiness\//);
  assert.match(ui,/eligible_limited/);
  assert.match(ui,/eligible_full/);
  assert.match(ui,/Profile approval does not publish a business/);
  assert.match(ui,/state\.memberHubTab=decision==='approve'&&isSuperAdmin\(\)&&\['merchant','service_provider'\]\.includes\(a\.role\)\?'commerce':'requests'/);
});

test('Members Hub V5 removes Profiles as a separate sidebar module',()=>{
  const modules=between(ui,'const modules=[','function hasAny');
  assert.doesNotMatch(modules,/id:'profiles'/);
  assert.doesNotMatch(ui,/function profilesPanel\(\)/);
  assert.doesNotMatch(ui,/profiles:'Review people and profile access'/);
  assert.match(modules,/id:'members',label:'Members'/);
  assert.match(modules,/members\.view/);
  assert.match(modules,/MEMBER_PROFILE_GOVERNANCE_PERMISSIONS/);
  const render=between(ui,'async function renderActive','async function loadBase');
  assert.doesNotMatch(render,/active==='profiles'/);
});

test('Members Hub V5 keeps Directory permission separate from Profile Governance permissions',()=>{
  assert.match(ui,/const MEMBER_PROFILE_REVIEW_PERMISSIONS=/);
  assert.match(ui,/const MEMBER_PROFILE_GOVERNANCE_PERMISSIONS=/);
  const tabs=between(ui,'function memberHubTabs','function activeMemberHubTab');
  assert.match(tabs,/if\(hasAny\(\['members\.view'\]\)\)tabs\.push\(\{id:'directory'/);
  assert.match(tabs,/if\(hasAny\(MEMBER_PROFILE_REVIEW_PERMISSIONS\)\)tabs\.push\(\{id:'requests'/);
  assert.match(tabs,/if\(inviteRolesForAdmin\(\)\.length\)tabs\.push\(\{id:'invitations'/);
  assert.match(tabs,/if\(hasAny\(MEMBER_PROFILE_GOVERNANCE_PERMISSIONS\)\)tabs\.push\(\{id:'authorizations'/);

  const profileOnboarding=between(functions,'profile_onboarding:Object.freeze','trust_safety:Object.freeze');
  assert.doesNotMatch(profileOnboarding,/members\.view/);
});

test('Governance-only Members tab path fails closed before Member Directory API access',()=>{
  const panel=between(ui,'async function membersPanel','async function wireMembers');
  const governanceIndex=panel.indexOf("if(hub.active!=='directory')");
  const directoryPermissionIndex=panel.indexOf("if(!hasAny(['members.view']))");
  const apiIndex=panel.indexOf("api('/api/admin/members?");
  assert.ok(governanceIndex>=0&&directoryPermissionIndex>governanceIndex,'Governance branch must precede Directory permission gate');
  assert.ok(apiIndex>directoryPermissionIndex,'Directory API must only execute after members.view gate');
  assert.match(panel,/return memberGovernancePanel\(hub\.active,hub\.tabs\)/);
});

test('Members Hub V5 exposes the four internal information architecture tabs when permitted',()=>{
  assert.match(ui,/id:'directory',label:'Directory'/);
  assert.match(ui,/id:'requests',label:'Profile requests'/);
  assert.match(ui,/id:'invitations',label:'Invitations'/);
  assert.match(ui,/id:'authorizations',label:'Authorizations'/);
  assert.match(ui,/class="memberHubNav"/);
  assert.match(ui,/data-member-hub-tab/);
  assert.match(css,/ADMIN MEMBERS HUB V5/);
  assert.match(css,/\.memberHubNav\{display:flex;gap:7px;overflow-x:auto/);
  assert.match(css,/@media\(max-width:520px\)/);
});

test('Application and authorization detail routes return to the correct Members tabs',()=>{
  assert.match(ui,/← Back to Profile requests/);
  assert.match(ui,/state\.active='members';state\.memberHubTab='requests'/);
  assert.match(ui,/← Back to Authorizations/);
  assert.match(ui,/state\.active='members';state\.memberHubTab='authorizations'/);
  assert.doesNotMatch(ui,/state\.active='profiles'/);
});

test('Members Hub V5 reuses existing Profile Governance rendering and wiring',()=>{
  assert.match(ui,/rows\(pending,profileApplicationRow\)/);
  assert.match(ui,/invitationAction\(\)/);
  assert.match(ui,/rows\(auths,profileAuthorizationRow\)/);
  assert.match(ui,/if\(state\.memberHubTab&&state\.memberHubTab!=='directory'\)\{\s*wireProfiles\(\)/);
  assert.match(ui,/data-admin-application/);
  assert.match(ui,/data-admin-authorization/);
  assert.match(ui,/id="profileInviteForm"/);
});
