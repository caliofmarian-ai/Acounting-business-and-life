import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const governance=read('server-profile-governance.js');
const adminServer=read('server-admin-operations.js');

for(const [label,path] of [['Admin console','public/admin-console.js'],['Profile governance','server-profile-governance.js']]){
  test(label+' has valid JavaScript syntax',()=>{
    const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../'+path,import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  });
}

test('Profiles is an actionable review surface rather than a read-only queue',()=>{
  assert.match(ui,/data-admin-application/);
  assert.match(ui,/\/api\/governance\/admin\/applications\/'\+Number\(id\)/);
  assert.match(ui,/data-review-decision="approve"/);
  assert.match(ui,/data-review-decision="reject"/);
  assert.match(ui,/data-review-decision="under_review"/);
  assert.match(ui,/approved_category_ids/);
  assert.match(ui,/data-admin-authorization/);
  assert.match(ui,/\/api\/governance\/admin\/authorizations\//);
});

test('Local Services review exposes requested category metadata while server credential gates remain authoritative',()=>{
  assert.match(governance,/requested_category_ids/);
  assert.match(governance,/requested_categories:requestedCategories\.rows/);
  assert.match(governance,/credential-gated category requires verified evidence before activation/i);
  assert.match(ui,/Credential evidence required/);
});

test('Trust & Safety opens incident evidence and writes only valid incident states',()=>{
  assert.match(ui,/data-admin-incident/);
  assert.match(ui,/\/api\/admin\/incidents\/'\+Number\(id\)/);
  assert.match(ui,/submitted','triaged','investigating','awaiting_information','resolved','dismissed','escalated/);
  assert.match(ui,/method:'PATCH'/);
  assert.match(ui,/data-incident-attachment/);
});

test('Territories opens official PH geography through the permission-gated PSGC registry flow',()=>{
  assert.match(ui,/id="territoryCreateForm"/);
  assert.match(ui,/id="territoryGeoSearchForm"/);
  assert.match(ui,/\/api\/governance\/admin\/geography\/search/);
  assert.match(ui,/\/api\/governance\/admin\/territories/);
  assert.match(ui,/Reference geography ≠ operating territory/);
  assert.doesNotMatch(ui,/Do not invent a pilot location/);
  assert.match(adminServer,/territory\.manage/);
});

test('Territory lifecycle status is editable without changing PSGC identity',()=>{
  assert.match(ui,/data-territory-status-form/);
  assert.match(ui,/TERRITORY_STATUSES=\['planned','onboarding','active','paused','suspended','closed'\]/);
  assert.match(ui,/\/api\/governance\/admin\/territories\/'\+id\+'\/status/);
  assert.match(governance,/app\.patch\('\/api\/governance\/admin\/territories\/:id\/status'/);
  assert.match(governance,/territory_status_changed/);
  assert.match(governance,/before_status:before\.status,after_status:status/);
  assert.match(governance,/Close or re-scope child territories before closing this territory/);
  assert.match(adminServer,/app\.patch\('\/api\/governance\/admin\/territories\/:id\/status'/);
  assert.match(ui,/Changing status does not edit the official PSGC identity/);
});

test('territory lifecycle gates invitation acceptance when onboarding closes',()=>{
  assert.match(governance,/t\.status IN \('onboarding','active'\).*FOR UPDATE OF i/);
  assert.match(governance,/operating territory is no longer open for onboarding/);
});

test('Support UI uses backend-valid statuses',()=>{
  assert.match(adminServer,/SUPPORT_STATUSES=new Set\(\['new','triaged','assigned','waiting_user','waiting_internal','resolved','closed','reopened'\]\)/);
  assert.match(ui,/\['new','triaged','assigned','waiting_user','waiting_internal','resolved','closed','reopened'\]/);
  assert.doesNotMatch(ui,/\['new','triaged','in_progress','waiting_user'/);
});

test('Team can manage subordinate assignment status while Super Admin remains protected',()=>{
  assert.match(ui,/data-admin-assignment/);
  assert.match(ui,/\/api\/admin\/assignments\/'\+Number\(a\.id\)\+'\/status/);
  assert.match(ui,/Protected Platform Owner assignment/);
  assert.match(adminServer,/Platform Owner Super Admin cannot be changed here/);
});

test('Settings no longer advertises nonexistent Admin preference controls',()=>{
  assert.doesNotMatch(ui,/<strong>Admin preferences<\/strong>/);
  assert.match(ui,/Admin access & responsibilities/);
  assert.match(ui,/Open personal Account Settings/);
});

test('new Admin action surfaces keep mobile touch targets and compact nav contract',()=>{
  assert.match(css,/\.adminDecisionGrid button,[^{]*\{min-height:44px\}/);
  assert.match(css,/\.adminEvidenceButton\{[^}]*min-height:44px/);
  assert.match(css,/\.adminNav\{[^}]*overflow-x:auto/);
  assert.match(css,/\.adminNav button\{[^}]*min-height:38px/);
});


test('Admin Overview leads with understandable work areas and keeps raw permissions collapsed',()=>{
  assert.match(ui,/Available work areas/);
  assert.match(ui,/data-overview-module/);
  assert.match(ui,/TECHNICAL ACCESS/);
  assert.doesNotMatch(ui,/<h3>My delegated functions<\/h3>/);
});

test('Support reply disables the actual submit action while sending',()=>{
  assert.match(ui,/button=form\.querySelector\('button\[type="submit"\]'\),out=document\.getElementById\('supportReplyResult'\)/);
});
