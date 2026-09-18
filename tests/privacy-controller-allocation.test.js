import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const allocation = JSON.parse(
  readFileSync(new URL('../privacy/controller-allocation.json', import.meta.url), 'utf8')
);
const profile = JSON.parse(
  readFileSync(new URL('../privacy/controller-profile.json', import.meta.url), 'utf8')
);
const assessment = readFileSync(
  new URL('../docs/privacy/CONTROLLER_ALLOCATION_ASSESSMENT.md', import.meta.url),
  'utf8'
);
const notice = readFileSync(
  new URL('../docs/agreements/PRIVACY_NOTICE_FRAMEWORK.md', import.meta.url),
  'utf8'
);

test('controller model remains unresolved until real authority is confirmed', () => {
  assert.equal(allocation.status, 'allocation_assessment_in_progress');
  assert.equal(allocation.finalControllerModel, null);
  assert.equal(profile.controllerAllocation.status, 'assessment_in_progress');
  assert.equal(profile.controllerAllocation.finalControllerModel, null);
  assert.equal(profile.controllerAllocation.philippineOperatorSolePicConfirmed, false);
  assert.equal(profile.controllerAllocation.projectOwnerSolePicConfirmed, false);
  assert.equal(profile.controllerAllocation.multipleControllerModelConfirmed, false);
  assert.match(assessment, /FINAL_CONTROLLER_MODEL = UNRESOLVED/);
});

test('Project Owner material processing decisions are captured as controller evidence', () => {
  const evidence = allocation.actors.projectOwner.knownDecisionEvidence;
  for (const item of [
    'selected_referral_attribution_model',
    'approved_unconverted_referral_retention_90_days',
    'approved_converted_referral_retention_target_12_months',
    'directed_legitimate_interest_assessment_path',
    'kept_initial_pilot_rewards_off',
    'kept_posthog_off_until_verified'
  ]) assert.ok(evidence.includes(item));

  assert.equal(
    allocation.processingDomains.referral_growth_analytics.purposeDecision,
    'project_owner_material_decisions_recorded'
  );
  assert.equal(
    allocation.processingDomains.referral_growth_analytics.retentionDecision,
    'project_owner_approved_90_days_and_12_month_target'
  );
});

test('local Philippine operation is recorded without inventing final processing authority', () => {
  const op = allocation.actors.philippineOperator;
  assert.equal(op.type, 'natural_person');
  assert.equal(op.role, 'owner_designated_initial_local_operator');
  assert.equal(op.legalName, null);
  assert.equal(op.knownFinalProcessingDecisionAuthority, null);
  assert.equal(op.picStatus, 'provisional_candidate_pending_actual_control_confirmation');
  assert.equal(op.deFactoDpoIfConfirmedIndividualPic, true);
});

test('ownership and local operation alone cannot establish PIC status', () => {
  assert.equal(allocation.legalDecisionRules.localOperationDoesNotAloneProvePic, true);
  assert.equal(allocation.legalDecisionRules.ownershipDoesNotAloneProvePic, true);
  assert.equal(allocation.legalDecisionRules.actualControlOverCollectionPurposeOrExtentIsRequired, true);
  assert.equal(allocation.legalDecisionRules.personActingOnlyOnAnotherControllersInstructionsIsNotPicForThoseFunctions, true);
  assert.equal(allocation.legalDecisionRules.extraterritorialApplicabilityMustBeConsidered, true);
  assert.match(assessment, /Local operation is not the same as controller authority/);
});

test('unresolved processing domains stay unresolved rather than inheriting a global guess', () => {
  for (const [domain, state] of Object.entries(allocation.processingDomains)) {
    assert.equal(state.controllerConclusion, null, domain);
  }
});

test('controller allocation blocks effective notice and durable referral activation', () => {
  assert.equal(allocation.activation.controllerAllocationReady, false);
  assert.equal(allocation.activation.effectivePrivacyNoticeReady, false);
  assert.equal(allocation.activation.durableReferralAttributionAllowed, false);
  assert.equal(allocation.activation.externalPosthogAllowed, false);
  assert.equal(profile.pic.activationApproved, false);
  assert.equal(profile.privacyNotice.effectiveControllerIdentityReady, false);
  assert.match(notice, /Current controller-allocation status: \*\*UNRESOLVED \/ PRE-LAUNCH FACT FINDING\*\*/);
});

test('no actor legal identity is invented', () => {
  assert.equal(allocation.actors.projectOwner.legalName, null);
  assert.equal(allocation.actors.philippineOperator.legalName, null);
  assert.equal(allocation.actors.futureBusinessLifeEntity.legalName, null);
  assert.equal(profile.initialOperator.legalName, null);
  assert.equal(profile.pic.legalName, null);
});

test('official DPA and IRR sources are pinned', () => {
  assert.equal(allocation.sources.dataPrivacyAct, 'https://privacy.gov.ph/data-privacy-act/');
  assert.equal(allocation.sources.dataPrivacyIrr, 'https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/');
});
