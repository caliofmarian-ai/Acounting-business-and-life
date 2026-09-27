---
document_id: BL-40-PH-SOP-006
title: SOP — Local Services Request, Quote, Job, Completion and Review
document_type: sop
status: DRAFT
access_class: PROFILE_PRIVATE
applicable_profiles: [customer, service_provider]
applicable_functions: [Compliance / Credential Reviewer]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.1
legal_classification: PLATFORM_POLICY
---

# SOP — Local Services Request, Quote, Job, Completion and Review

## Purpose

Ensure Local Services work moves through a clear in-app lifecycle with accurate scope/quotes, privacy controls and review eligibility tied to real completed work.

## Scope

Applies to current public Service Provider discovery and service-job workflow.

## Roles

- Customer requests/accepts/confirms/reviews.
- Service Provider maintains profile, quotes and performs work.
- Reviewer verifies credentials where applicable.

## Prerequisites

- Service Provider enabled and public for normal discovery.
- Requested service/category is within platform-authorized scope.
- Customer describes requested work.

## Inputs / evidence

- Provider profile/services.
- Service request description, official coarse area, private exact address and window.
- Versioned itemised quote: scope, labour/material/call-out/travel lines, charging units, validity, inclusions, exclusions and terms.
- Customer response attached to the exact quote version.
- Schedule/status.
- Customer-accepted agreed total and, where needed, an explicitly approved change order.
- Customer completion confirmation.
- Ratings/review.

## Procedure

1. Customer discovers a public Service Provider/category and reviews public profile information.
2. Customer submits a service request with enough information to understand the work. The work description must not contain an address or private contact details.
3. Before quote acceptance, the Provider receives only the Customer's official coarse barangay/area. The exact address remains private.
4. Provider reviews request and may move into review/quote flow.
5. Provider sends an itemised quote. The server calculates every line subtotal and the PHP total; a browser-supplied total is not authoritative.
6. Customer accepts, declines or requests changes to the exact quote version. Only explicit acceptance moves the work into accepted/scheduled/in-progress states.
7. The assigned Provider intentionally requests the exact address only for fulfilment. Each successful access is independently logged.
8. Provider schedules/starts work using allowed state transitions.
9. Provider performs the work within the accepted scope. If price or scope must change, Provider sends a complete revised change order while the previous accepted price remains binding.
10. Customer explicitly accepts or declines the change order. Acceptance replaces the agreed-price snapshot; silence or continued work is not acceptance.
11. Provider marks job Completed only after the work is actually completed. Completion is pinned to the latest Customer-accepted total and is blocked while a change order awaits a response. Exact-address access expires immediately when the job leaves accepted/scheduled/in-progress status.
12. Customer separately confirms completion.
13. Only after Completed + Customer confirmed may Customer submit one verified review.
14. Public reputation contributes only according to provider's public-reputation setting and moderation rules.
15. Handle disputes/safety/privacy problems through Incident/support rather than manipulating review/status history.

## Control points

- Provider cannot request own service.
- Every money value is non-negative and bounded; line quantities must be positive and use a supported unit.
- Quote totals and subtotals are calculated server-side.
- A new quote creates a new immutable version; it does not rewrite accepted history.
- Acceptance targets the quote identifier and expected version under a database row lock.
- Quote expiry, stale version and forged total attempts fail closed.
- Completion total must equal the latest Customer-accepted total.
- A pending change order blocks completion until the Customer responds.
- Invalid job-state jumps are blocked.
- `provider_reviewing` cannot bypass Customer quote acceptance and move directly to `scheduled`.
- Provider list, quote and status payloads never contain the exact address.
- Exact-address access is assignment-, purpose- and state-scoped, rate-limited and audited.
- Completed, cancelled, disputed, requested, provider-reviewing and quoted jobs cannot release the exact address.
- Review requires completed + customer_confirmed.
- One review per job.
- Profile visibility and public reputation are separate controls.
- Job-linked portfolio is public only with required Customer publication consent.

## Prohibited shortcuts

- Falsifying credentials/experience.
- Starting regulated/gated work outside authorized scope.
- Marking unperformed work completed.
- Fabricating reviews.
- Publishing job-linked Customer images without consent.
- Using Customer address/contact outside service purpose.

## Exceptions / escalation

- Scope/price changes → versioned change order and explicit Customer approval; never a hidden final-price adjustment.
- Safety/dispute → disputed/incident path.
- Credential expires → stop gated activity until authorized.
- Payment dispute → Support/Finance according to implemented payment model.

## Records / audit

- Public/private provider profile.
- Services/categories.
- Credentials/evidence/status.
- Job/request/status, immutable quote versions, quote line items and quote-response event history.
- Accepted quote identifier, agreed total and pricing-lock timestamp.
- Privacy-safe coarse area and Customer-owned exact address.
- Provider exact-address access event, actor, Customer subject, job-status snapshot, purpose and correlation identifier; the audit record does not duplicate the address.
- Customer confirmation.
- Review.
- Portfolio consent.

## Related controlled forms

- BL-120-PH-FORM-003 Platform Authorization Status Summary
- BL-120-PH-FORM-004 Compliance Requirement Checklist
- BL-120-PH-FORM-005 Evidence Submission Index

## Related public Help Center guides

- `/help/article/find-local-service-provider`
- `/help/article/service-profile-visibility`
- `/help/article/credentials-verification`
- `/help/article/service-job-statuses`
- `/help/article/service-requests-quotes-jobs`
- `/help/article/verified-service-review`
- `/help/article/portfolio-publication-privacy`

## KPI / quality controls

- Request-to-quote rate.
- Quote acceptance.
- Completion/confirmation rate.
- Dispute/cancellation rate.
- Verified review rate.
- Credential expiry/compliance rate.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
