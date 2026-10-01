import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const functions=read('admin-functions.js');
const adminServer=read('server-admin-operations.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0,'Missing start marker: '+start);
  assert.ok(b>a,'Missing end marker: '+end);
  return source.slice(a,b);
}

test('Admin overview supplies active Merchant businesses to Commerce readiness',()=>{
  assert.match(adminServer,/CASE WHEN a\.role='merchant' THEN COALESCE\(\(/);
  assert.match(adminServer,/FROM business_memberships bm/);
  assert.match(adminServer,/JOIN businesses b ON b\.id=bm\.business_id/);
  assert.match(adminServer,/WHERE bm\.account_id=a\.account_id AND bm\.active=TRUE/);
  assert.match(adminServer,/jsonb_build_object\('id',b\.id,'name',b\.name\)/);
  assert.match(adminServer,/END businesses/);
  assert.match(ui,/Array\.isArray\(a\.businesses\)/);
  assert.match(ui,/Review commerce/);
});

test('Commerce readiness explains every review item in plain language without weakening governed validation',()=>{
  assert.match(ui,/const COMMERCE_REVIEW_GUIDE=Object\.freeze/);
  assert.match(ui,/Does the declared activity match what this business actually does\?/);
  assert.match(ui,/Does the declared operating context match how and where this business actually operates\?/);
  assert.match(ui,/Are the applicable business-registration requirements resolved\?/);
  assert.match(ui,/Are the applicable tax \/ receipt record requirements resolved\?/);
  assert.match(ui,/Is the business allowed to operate or vend at this location\?/);
  assert.match(ui,/Are the applicable food-safety \/ sanitary requirements resolved\?/);
  assert.match(ui,/What to check/);
  assert.match(ui,/Useful evidence/);
  assert.match(ui,/Decision for this check/);
  assert.match(ui,/Evidence \/ record you checked/);
  assert.match(ui,/Official source \/ authority/);
  assert.match(ui,/Reviewer explanation/);
  assert.match(ui,/Verified — evidence checked/);
  assert.match(ui,/Not applicable — sourced decision/);
  assert.match(ui,/Confirm the business setup/);
  assert.match(ui,/Resolve the requirements that apply/);
  assert.match(ui,/checks resolved/);
  assert.match(ui,/Eligible does not mean government-approved/);
  assert.doesNotMatch(ui,/data-commerce-outcome[^\n]{0,250}selected="selected"/);
});

test('Super Admin Member Details exposes contextual Commerce readiness routing',()=>{
  assert.match(ui,/function memberCommerceReadinessMarkup\(data\)/);
  assert.match(ui,/if\(!isSuperAdmin\(\)\)return''/);
  assert.match(ui,/data-member-jump="memberCommerceSection"/);
  assert.match(ui,/title:'Commerce readiness'/);
  assert.match(ui,/data-member-commerce-review/);
  assert.match(ui,/Merchant · Business #/);
  assert.match(ui,/Local Services profile/);
  assert.match(ui,/openAdminCommerceReadiness\(Number\(button\.dataset\.memberCommerceReview\)/);
  assert.match(ui,/async function openAdminCommerceReadiness\(accountId,role,businessId,label='',returnMemberId=null\)/);
  assert.match(ui,/if\(returnMemberId\)\{/);
  assert.match(ui,/state\.memberDetailId=Number\(returnMemberId\)/);
});

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
