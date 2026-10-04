import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  applicationStatusAfterReview,
  applicationStatusAfterSave,
  applicationStatusAfterSubmit,
  profileProjectionForApplication
} from '../profile-application-state-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const governance=read('server-profile-governance.js');
const accounting=read('server-business-accounting.js');
const notifications=read('server-notifications.js');
const adminUi=read('public/admin-console.js');
const applicantUi=read('public/profile-governance-ui.js');
const shell=read('public/shell.js');
const qa=read('qa-acceptance.js');
const qaWave=read('qa-merchant-governance-v1.js');

test('canonical application transitions never invent an Admin decision',()=>{
  for(const status of ['application_started','requirements_pending','rejected']){
    assert.equal(applicationStatusAfterSave(status),status);
    assert.equal(applicationStatusAfterSubmit(status),'submitted');
  }
  assert.equal(applicationStatusAfterReview('submitted','under_review'),'under_review');
  assert.equal(applicationStatusAfterReview('under_review','requirements_pending'),'requirements_pending');
  assert.equal(applicationStatusAfterReview('submitted','approve'),'approved');
  assert.equal(applicationStatusAfterReview('under_review','reject'),'rejected');
  assert.throws(()=>applicationStatusAfterSave('submitted'),error=>error.code==='APPLICATION_NOT_EDITABLE');
  assert.throws(()=>applicationStatusAfterReview('approved','approve'),error=>error.code==='APPLICATION_NOT_REVIEWABLE');
  assert.throws(()=>applicationStatusAfterReview('submitted','unexpected'),error=>error.code==='INVALID_REVIEW_DECISION');
});

test('profile projection is derived from the same committed application state',()=>{
  assert.deepEqual(profileProjectionForApplication('approved'),{enabled:true,status:'active',visibility:'private'});
  for(const status of ['application_started','requirements_pending','submitted','under_review','rejected','suspended','revoked']){
    assert.deepEqual(profileProjectionForApplication(status),{enabled:false,status,visibility:'private'});
  }
  assert.throws(()=>profileProjectionForApplication('mystery'),error=>error.code==='UNKNOWN_APPLICATION_STATE');
});

test('save, submit and review commit application and profile projection together',()=>{
  assert.match(governance,/async function syncProfileApplicationProjection/);
  for(const route of [
    governance.slice(governance.indexOf("app.put('/api/governance/applications/:id'"),governance.indexOf("app.post('/api/governance/applications/:id/documents'")),
    governance.slice(governance.indexOf("app.post('/api/governance/applications/:id/submit'"),governance.indexOf("app.get('/api/governance/admin/geography/status'")),
    governance.slice(governance.indexOf("app.post('/api/governance/admin/applications/:id/review'"),governance.indexOf("app.get('/api/governance/admin/readiness/"))
  ]){
    assert.match(route,/query\('BEGIN'\)/);
    assert.match(route,/FOR UPDATE/);
    assert.match(route,/syncProfileApplicationProjection/);
    assert.match(route,/applicationSnapshot\(id,client\)/);
    assert.match(route,/query\('COMMIT'\)/);
  }
  assert.doesNotMatch(governance,/status='requirements_pending',updated_at=NOW\(\) WHERE id=\$5/);
  assert.doesNotMatch(governance,/profile_authorizations authorization/);
  assert.match(governance,/profile_authorizations authz/);
});

test('review completion retains immutable actor, time, note and attestations',()=>{
  for(const marker of [
    'CREATE TABLE IF NOT EXISTS profile_application_reviews',
    'reviewer_account_id BIGINT NOT NULL',
    'reviewer_note TEXT NOT NULL',
    'evidence_attested BOOLEAN NOT NULL',
    'adult_eligibility_attested BOOLEAN NOT NULL',
    'approved_category_ids JSONB NOT NULL',
    'correlation_id TEXT NOT NULL',
    'recordApplicationReview'
  ])assert.ok(governance.includes(marker),'missing review history marker: '+marker);
  assert.match(governance,/review_history/);
  assert.match(governance,/committed:true,review_event_id/);
  assert.match(governance,/REVIEW_ATTESTATION_REQUIRED/);
});

test('Admin review UI has deterministic pending, committed and retryable failure states',()=>{
  const reviewUi=adminUi.slice(adminUi.indexOf('function setApplicationReviewBusy'),adminUi.indexOf('const COMMERCE_REVIEW_GUIDE'));
  assert.match(reviewUi,/querySelectorAll\('\[data-review-decision\]'\)/);
  assert.match(reviewUi,/action\.disabled=busy/);
  assert.match(reviewUi,/aria-busy/);
  assert.match(reviewUi,/The committed result will appear here/);
  assert.match(reviewUi,/committed\?\.committed!==true\|\|committed\?\.status!==expected/);
  assert.match(reviewUi,/role="alert"/);
  assert.match(reviewUi,/setApplicationReviewBusy\(form,false\)/);
  assert.match(reviewUi,/setAdminApplicationRoute\(a\.id\)/);
  assert.match(reviewUi,/applicationReviewHistoryHtml/);
  assert.doesNotMatch(reviewUi,/await loadBase\(\)/);
});

test('applicant modal and profile card reconcile immediately without a page reload',()=>{
  assert.match(applicantUi,/function upsertGovApplication/);
  assert.match(applicantUi,/reconcileGovApplication/);
  assert.match(applicantUi,/Saving application…/);
  assert.match(applicantUi,/Submitting for review…/);
  assert.match(applicantUi,/govReviewHistoryHtml/);
  assert.match(shell,/accountSettingsWorkspace&&!accountSettingsWorkspace\.classList\.contains\('hidden'\)/);
  assert.match(shell,/renderAccountSettings\(accountSettingsView\)/);
  assert.doesNotMatch(applicantUi,/location\.reload/);
});

test('notification delivery is pinned to the exact committed review event',()=>{
  assert.match(notifications,/applicationInfo\(id,reviewEventId=null\)/);
  assert.match(notifications,/review\.id=\$2/);
  assert.match(notifications,/applicationInfo\(req\.params\.id,committed\?\.review_event_id\)/);
  assert.match(notifications,/review_event_id:a\?\.review_event_id/);
  assert.match(notifications,/profile-app:\$\{a\.id\}:review:\$\{a\.review_event_id/);
});

test('post-commit accounting reconciliation cannot turn a committed approval into a retry trap',()=>{
  const route=accounting.slice(accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'"),accounting.indexOf('app.use((req,res,next)=>',accounting.indexOf("app.post('/api/governance/admin/applications/:id/review'")));
  assert.match(route,/ensureProfileBusinessBinding/);
  assert.match(route,/\.catch\(error=>console\.error\('Post-approval business binding reconciliation:'/);
});

test('isolated Preview acceptance exercises committed state, failure retry and duplicate serialization',()=>{
  assert.match(qa,/MERCHANT_GOVERNANCE_V1_WAVE='merchant_governance_v1'/);
  assert.match(qa,/runMerchantGovernanceV1Acceptance/);
  for(const marker of [
    "status='application_started'",
    'missing-attestation denial',
    'Promise.all([',
    'duplicate_commit_prevented:true',
    'notification_parity:true',
    'slow_feedback_contract:true',
    'restoreFixture'
  ])assert.ok(qaWave.includes(marker),'missing Preview acceptance marker: '+marker);
});
