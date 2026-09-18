import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = JSON.parse(
  readFileSync(new URL('../privacy/controller-profile.json', import.meta.url), 'utf8')
);
const governance = readFileSync(
  new URL('../docs/privacy/INITIAL_PIC_DPO_GOVERNANCE.md', import.meta.url),
  'utf8'
);
const notice = readFileSync(
  new URL('../docs/agreements/PRIVACY_NOTICE_FRAMEWORK.md', import.meta.url),
  'utf8'
);
const baseline = readFileSync(
  new URL('../docs/compliance/ph/PRIVACY_BASELINE.md', import.meta.url),
  'utf8'
);

test('Business & Life is recorded as operating name without inventing a legal entity', () => {
  assert.equal(profile.operatingName, 'Business & Life');
  assert.equal(profile.legalEntity.formed, false);
  assert.equal(profile.legalEntity.legalName, null);
  assert.equal(profile.legalEntity.registrationNumber, null);
  assert.match(governance, /Philippine legal-entity state:[\s\S]*NOT YET FORMED/);
});

test('initial Philippine operator remains a natural-person record without invented identity/contact', () => {
  assert.equal(profile.initialOperator.type, 'natural_person');
  assert.equal(profile.initialOperator.legalName, null);
  assert.equal(profile.initialOperator.publicContact, null);
  assert.equal(profile.pic.legalName, null);
  assert.equal(profile.pic.publicContact, null);
  assert.equal(profile.privacyNotice.placeholderPublicationAllowed, false);
});

test('PIC status follows actual control and controller allocation is not silently resolved', () => {
  assert.equal(profile.pic.status, 'controller_allocation_pending');
  assert.equal(profile.pic.candidate, 'initial_operator_and_project_owner_require_actual_control_assessment');
  assert.equal(profile.pic.activationApproved, false);
  assert.equal(profile.controllerAllocation.finalControllerModel, null);
  assert.equal(profile.controllerAllocation.philippineOperatorSolePicConfirmed, false);
  assert.equal(profile.controllerAllocation.projectOwnerSolePicConfirmed, false);
  assert.match(governance, /must not convert the local-operator assumption into a sole-PIC conclusion/i);
});

test('any confirmed individual PIC is recorded as de facto DPO without inventing a second person', () => {
  assert.equal(profile.dpo.status, 'pending_final_individual_pic_controller_allocation');
  assert.equal(profile.dpo.candidate, 'de_facto_for_any_confirmed_individual_pic_as_applicable');
  assert.equal(profile.dpo.separatePersonRequiredByThisRecord, false);
  assert.equal(profile.dpo.legalName, null);
  assert.equal(profile.dpo.officialEmail, null);
  assert.match(governance, /individual PIC or PIP is a \*\*de facto Data Protection Officer \(DPO\)\*\*/);
});

test('NPC registration remains assessment-required rather than guessed', () => {
  assert.equal(profile.npcRegistration.status, 'assessment_required_before_public_launch');
  assert.equal(profile.npcRegistration.mandatoryRegistrationDecision, null);
  assert.equal(profile.npcRegistration.npcrsRegistrationId, null);
  assert.equal(profile.npcRegistration.certificate, null);
  for (const trigger of [
    'employs_250_or_more_persons',
    'processes_sensitive_personal_information_of_1000_or_more_individuals',
    'processing_likely_to_pose_risk_to_rights_and_freedoms',
    'data_processing_system_involving_automated_decision_making_or_profiling'
  ]) {
    assert.ok(profile.npcRegistration.assessmentTriggers.includes(trigger));
  }
  assert.match(baseline, /NPC_REGISTRATION_STATUS = ASSESSMENT_REQUIRED_BEFORE_PUBLIC_LAUNCH/);
});

test('draft Privacy Notice records known structure but refuses unverified public identity facts', () => {
  assert.match(notice, /operating name: \*\*Business & Life\*\*/);
  assert.match(notice, /initial Philippine operator: natural person designated by the Project Owner/);
  assert.match(notice, /de facto DPO/);
  assert.match(notice, /Do not publish placeholders as facts/);
  assert.equal(profile.privacyNotice.effectiveControllerIdentityReady, false);
  assert.equal(profile.privacyNotice.effectiveDpoContactReady, false);
});

test('canonical governance sources are official NPC URLs', () => {
  assert.equal(profile.sourceFacts.npcDpoGuidance, 'https://privacy.gov.ph/appointing-a-data-protection-officer/');
  assert.equal(profile.sourceFacts.npcRegistrationCircular2022_04, 'https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf');
  assert.equal(profile.sourceFacts.npcRegistrationFaq2026, 'https://privacy.gov.ph/pips-and-pics/faqs/');
});
