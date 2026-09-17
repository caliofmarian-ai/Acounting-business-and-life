---
document_id: BL-40-PH-SOP-008
title: SOP — Profile Application, Authorization, Suspension and Evidence Expiry
document_type: sop
status: DRAFT
access_class: OPERATIONS_PRIVATE
applicable_profiles: [merchant, supplier, courier, service_provider]
applicable_functions: [Territory Admin, Country Admin, Compliance / Credential Reviewer]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Profile Application, Authorization, Suspension and Evidence Expiry

## Purpose

Keep governed operational profiles separate from ordinary account creation and ensure profile capability is based on documented invitation/application/authorization evidence.

## Scope

Applies to current merged profile-governance concepts. Future RBAC/Admin implementation may refine who may execute each privileged action.

## Roles

- Applicant completes role application/evidence/responsibility acknowledgement.
- Admin issues invitation/reviews/authorizes within delegated scope.
- Compliance Reviewer evaluates required evidence.

## Prerequisites

- Operating territory available/onboarding/active as applicable.
- Invitation required for Merchant/Supplier/Delivery where policy applies; Local Services application may be started through its visible application path.
- Current role requirement checklist exists.

## Inputs / evidence

- Invitation/application.
- Proposed business/profile details.
- Responsibility acknowledgement.
- Supporting evidence.
- Requested Local Services categories.
- Review decision/reason.
- Authorization expiry/status.

## Procedure

1. Determine whether the role requires invitation or may start application directly.
2. Applicant starts/accepts invitation in the intended territory.
3. Applicant completes editable application details and acknowledges role responsibility declaration.
4. Applicant uploads required evidence within allowed file/count limits.
5. For Merchant, include required business/store name. For Local Services, select at least one service category before submission.
6. Submit application; status moves to Submitted when requirements pass.
7. Authorized reviewer moves case through review and records decision/reason using current governance flow.
8. If approved, create/update the applicable profile authorization and enable operational scope according to implemented governance behavior.
9. Track authorization status/expiry and supporting evidence.
10. Where evidence/authorization becomes suspended, revoked or expired, operational use must be restricted according to role policy.
11. Reactivation/renewal requires current evidence and authorized decision; never silently reactivate expired evidence.

## Control points

- Application states are explicit and not one enabled=true boolean.
- Authorizations use active/suspended/revoked/expired concepts.
- Service category authorization may be separate from overall Service Provider profile.
- Territory scope matters.
- Platform authorization is separate from government licence/permit.

## Prohibited shortcuts

- Self-activating governed role outside allowed flow.
- Approving without required responsibility/evidence.
- Changing territory scope informally.
- Calling platform approval a government permit.
- Ignoring expired evidence.

## Exceptions / escalation

- Requirement unclear → Compliance/Country Admin/source research.
- Suspected false evidence → Trust & Safety/Compliance review.
- Urgent suspension for safety → use authorized status action and record reason.

## Records / audit

- Invitation.
- Application/status.
- Supporting evidence metadata.
- Review reason.
- Profile authorization.
- Category authorization.
- Expiry/status history.

## Related controlled forms

- BL-120-PH-FORM-001 Role / Profile Acknowledgement
- BL-120-PH-FORM-003 Platform Authorization Status Summary
- BL-120-PH-FORM-004 Compliance Requirement Checklist
- BL-120-PH-FORM-005 Evidence Submission Index

## Related public Help Center guides

- `/help/article/profile-approval-required`
- `/help/article/courier-approval-required`
- `/help/article/service-provider-approval`
- `/help/article/credentials-verification`

## KPI / quality controls

- Application turnaround.
- Missing-evidence rate.
- Decision reversal/error rate.
- Expired authorization backlog.
- Unauthorized activation incidents.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
