import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const userUi=read('public/profile-governance-ui.js');
const adminUi=read('public/admin-console.js');
const governance=read('server-profile-governance.js');
const notifications=read('server-notifications.js');
const notificationUi=read('public/notifications-ui.js');
const core=read('notification-core.js');

test('applicant review screen explains status next steps and profile lock',()=>{
  assert.match(userUi,/Application under review/);
  assert.match(userUi,/Your profile remains locked until a decision is made/);
  assert.match(userUi,/You can still add evidence/);
  assert.match(userUi,/If Admin needs a correction/);
  assert.match(userUi,/Admin note/);
  assert.match(userUi,/You will be notified when the review status changes/);
});

test('submitted and under-review applications can append evidence without rewriting core fields',()=>{
  assert.match(userUi,/canAddEvidence=canEdit\|\|pendingReview/);
  assert.match(userUi,/Your application details stay locked while Admin reviews the submitted version/);
  assert.match(governance,/status IN \('application_started','requirements_pending','rejected','submitted','under_review'\)/);
  assert.match(governance,/Application can no longer be edited in its current state/);
  assert.match(governance,/application_evidence_added/);
  assert.match(governance,/UPDATE profile_applications SET updated_at=NOW\(\) WHERE id=\$1/);
});

test('applicant sees uploaded document summaries from governance state',()=>{
  for(const marker of ['original_file_name','detected_mime','byte_size','scan_status'])assert.match(governance,new RegExp(marker));
  assert.match(userUi,/Your uploaded documents/);
  assert.match(userUi,/govUploadedEvidenceHtml/);
  assert.match(userUi,/Security scan passed/);
});

test('Admin can explicitly request more information with applicant-facing reason',()=>{
  assert.match(adminUi,/data-review-decision="requirements_pending"/);
  assert.match(adminUi,/Request more information/);
  assert.match(adminUi,/Message to applicant \/ review note/);
  assert.match(adminUi,/included in their review update/);
  assert.match(governance,/requirements_pending'\]\.includes\(decision\)|'requirements_pending'\]\.includes/);
  assert.match(governance,/decision==='requirements_pending'/);
  assert.match(governance,/Explain what information or correction is required/);
});

test('profile review notifications carry human-readable status guidance and reviewer note',()=>{
  assert.match(notifications,/function profileReviewNotificationData/);
  assert.match(notifications,/status_title/);
  assert.match(notifications,/status_explanation/);
  assert.match(notifications,/next_step/);
  assert.match(notifications,/reviewer_note_text/);
  assert.match(notifications,/review:\$\{a\.status\}:\$\{clean\(a\.updated_at,80\)\}/);
  assert.match(core,/profileReviewEmailHtml/);
  assert.match(core,/Current review status/);
  assert.match(core,/What this means/);
  assert.match(core,/What you can do now/);
  assert.match(core,/Admin note/);
  assert.doesNotMatch(core,/Your \{\{role\}\} application is now \{\{status\}\}\./);
});

test('profile application notifications route Admin and applicant to different exact contexts',()=>{
  assert.match(notificationUi,/adminNotification=String\(n\.role_hint\|\|''\)\.toLowerCase\(\)==='admin'/);
  assert.match(notificationUi,/BusinessLifeProfileGovernance\?\.openApplicationById/);
  assert.match(notificationUi,/\/\?profile_application=/);
  assert.match(userUi,/openApplicationById/);
  assert.match(userUi,/profile_application/);
  assert.match(core,/\/?profile_application=\$\{encodeURIComponent\(row\.entity_id\)\}/);
});

test('additional evidence during review notifies scoped Admin reviewers',()=>{
  assert.match(notifications,/profile\.application_evidence_added/);
  assert.match(notifications,/applications\/:id\/documents/);
  assert.match(notifications,/adminNotificationRecipients/);
  assert.match(core,/Additional application document uploaded/);
});
