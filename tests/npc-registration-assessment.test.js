import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const assessment = JSON.parse(
  readFileSync(new URL('../privacy/npc-registration-assessment.json', import.meta.url), 'utf8')
);
const draft = readFileSync(
  new URL('../docs/privacy/NPC_REGISTRATION_ASSESSMENT_DRAFT.md', import.meta.url),
  'utf8'
);
const controller = JSON.parse(
  readFileSync(new URL('../privacy/controller-profile.json', import.meta.url), 'utf8')
);

test('NPC registration decision remains unresolved until verified launch facts exist', () => {
  assert.equal(assessment.status, 'assessment_in_progress');
  assert.equal(assessment.finalRegistrationDecision, null);
  assert.equal(assessment.launchGateIfUnresolved, true);
  assert.match(draft, /FINAL_NPC_REGISTRATION_DECISION = PENDING/);
  assert.match(draft, /does \*\*not\*\* currently state that Business & Life:[\s\S]*must register; or[\s\S]*is exempt/i);
});

test('all mandatory trigger families are represented without invented outcomes', () => {
  const t = assessment.mandatoryTriggerAssessment;
  assert.equal(t.employees250OrMore.threshold, 250);
  assert.equal(t.employees250OrMore.verifiedEmployeeCount, null);
  assert.equal(t.employees250OrMore.status, 'unresolved');

  assert.equal(t.sensitivePersonalInformation1000OrMoreIndividuals.thresholdIndividuals, 1000);
  assert.equal(t.sensitivePersonalInformation1000OrMoreIndividuals.currentDesignCanProcessSensitivePersonalInformation, true);
  assert.equal(t.sensitivePersonalInformation1000OrMoreIndividuals.verifiedSensitivePersonalInformationIndividuals, null);
  assert.equal(t.sensitivePersonalInformation1000OrMoreIndividuals.status, 'unresolved');

  assert.equal(t.processingLikelyToPoseRiskToRightsAndFreedoms.triggerMet, null);
  assert.equal(t.processingLikelyToPoseRiskToRightsAndFreedoms.status, 'formal_risk_assessment_required');

  assert.equal(t.automatedDecisionMakingOrProfilingDps.triggerMet, null);
  assert.equal(t.automatedDecisionMakingOrProfilingDps.status, 'dps_inventory_review_required');
});

test('SPI assessment includes education and government licence evidence but does not claim all data is SPI', () => {
  const categories = assessment.mandatoryTriggerAssessment.sensitivePersonalInformation1000OrMoreIndividuals.evidenceCategories;
  assert.ok(categories.includes('education_or_qualification_data_in_private_cv_credential_evidence'));
  assert.ok(categories.includes('government_issued_licence_or_credential_evidence_where_applicable'));
  assert.match(draft, /This does \*\*not\*\* mean every CV, transaction or support ticket is sensitive personal information/);
});

test('risk-sensitive domains are captured for formal assessment', () => {
  const domains = assessment.mandatoryTriggerAssessment.processingLikelyToPoseRiskToRightsAndFreedoms.potentialRiskRelevantDomains;
  for (const expected of [
    'private_credentials_and_cv_evidence',
    'government_issued_licence_evidence',
    'active_delivery_location',
    'payment_settlement_and_accounting_records',
    'support_and_incident_evidence',
    'privacy_rights_requests'
  ]) assert.ok(domains.includes(expected));
});

test('automated decision and profiling are not guessed', () => {
  const x = assessment.mandatoryTriggerAssessment.automatedDecisionMakingOrProfilingDps;
  assert.equal(x.triggerMet, null);
  assert.ok(x.currentKnownBoundaries.includes('referral_external_analytics_off'));
  assert.ok(x.currentKnownBoundaries.includes('referral_profiling_not_activated'));
  assert.match(draft, /No broad conclusion is made for the entire platform/);
});

test('controller profile and registration assessment stay consistent', () => {
  assert.equal(controller.npcRegistration.status, 'assessment_required_before_public_launch');
  assert.equal(controller.npcRegistration.mandatoryRegistrationDecision, null);
  assert.equal(assessment.operator.operatingName, controller.operatingName);
  assert.equal(assessment.operator.legalEntityFormed, controller.legalEntity.formed);
  assert.equal(assessment.operator.operatorType, controller.initialOperator.type);
  assert.equal(assessment.operator.confirmedPic, false);
  assert.equal(assessment.operator.individualPicDeFactoDpoIfConfirmed, true);
});

test('official NPC sources are pinned without inventing registration evidence', () => {
  assert.equal(assessment.sources.npcCircular2022_04, 'https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf');
  assert.equal(assessment.sources.npcFaq2026, 'https://privacy.gov.ph/pips-and-pics/faqs/');
  assert.equal(assessment.registrationPath.npcrsAccount, null);
  assert.equal(assessment.registrationPath.registrationId, null);
  assert.equal(assessment.registrationPath.certificate, null);
});
