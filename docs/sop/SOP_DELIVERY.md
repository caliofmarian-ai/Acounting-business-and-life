---
document_id: BL-40-PH-SOP-005
title: SOP — Delivery Quote, Dispatch, Active Tracking and Handoff
document_type: sop
status: DRAFT
access_class: PROFILE_PRIVATE
applicable_profiles: [customer, merchant, courier]
applicable_functions: [Territory Admin]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Delivery Quote, Dispatch, Active Tracking and Handoff

## Purpose

Move a Delivery order from quote to verified handoff using approved pricing, ready/paid dispatch gates and eligible Courier assignment.

## Scope

Applies to current Business & Life delivery workflows.

## Roles

- Customer requests quote/receives delivery.
- Merchant configures pickup point and requests Courier after order readiness/payment.
- Courier maintains eligibility/availability and performs assignment.
- Admin manages pricing/eligibility/assignment where authorized.

## Prerequisites

- Merchant Delivery enabled.
- Merchant pickup coordinates configured.
- Active Delivery pricing configured.
- Customer destination valid.
- For dispatch: order Ready and Paid.
- Courier approved/not expired and available.

## Inputs / evidence

- Pickup/dropoff coordinates.
- Pricing-version inputs.
- Estimated weight/volume if available.
- Delivery quote.
- Order readiness/payment.
- Courier eligibility/vehicle class.
- Active status/location.
- Customer handoff code.

## Procedure

1. Customer requests a Delivery quote for a Delivery-enabled Merchant.
2. System validates coordinates, active pricing and configured maximum service distance.
3. Review quote fee/distance and use it before its current 15-minute expiry.
4. Delivery checkout currently requires online/digital payment; cash delivery remains disabled.
5. Merchant prepares order and confirms payment.
6. When order is Ready and Paid, Merchant requests Courier dispatch.
7. Assign/select only an approved eligible Courier who may become available under current rules.
8. Courier follows allowed delivery statuses from assignment toward Merchant pickup and Customer arrival.
9. Courier may share location only while active tracking is open for that assigned delivery.
10. At Customer destination, Courier reaches customer-arrival state before completion.
11. Customer provides the active completion/handoff code at actual handoff.
12. Courier enters code; system marks Delivery delivered, clears live location and completes linked order.

## Control points

- Quote status must be quoted/unexpired when used.
- Current quote expiry is 15 minutes.
- Dispatch blocked unless order Ready + Paid.
- Courier availability blocked unless eligibility approved and unexpired.
- Status transitions are constrained.
- Tracking closes after delivered/failed/cancelled.
- Correct Customer delivery code required.

## Prohibited shortcuts

- Reusing expired quote.
- Cash Delivery checkout in current model.
- Dispatching an unpaid/unready order.
- Allowing unapproved/expired Courier availability.
- Continuous off-duty location tracking.
- Requesting handoff code before actual handoff.
- Falsifying delivered status.

## Exceptions / escalation

- Destination outside max distance → no quote.
- Pricing missing → Admin configuration required.
- Courier unavailable → remain awaiting assignment/escalate capacity.
- Safety/route incident → safety procedure + private Incident.
- Wrong handoff code → verify active delivery/customer; do not bypass code.

## Records / audit

- Pricing version.
- Quote snapshot.
- Delivery record/status.
- Courier eligibility/document state.
- Location while active.
- Completion/handoff event.
- Delivery financial allocation.

## Related controlled forms

- BL-120-PH-FORM-003 Platform Authorization Status Summary
- BL-120-PH-FORM-004 Compliance Requirement Checklist

## Related public Help Center guides

- `/help/article/delivery-fee-and-quote`
- `/help/article/delivery-quote-expired`
- `/help/article/merchant-delivery-dispatch`
- `/help/article/courier-approval-required`
- `/help/article/courier-active-delivery`
- `/help/article/courier-location-privacy`
- `/help/article/courier-completion-code`

## KPI / quality controls

- Quote-to-completion rate.
- Dispatch wait.
- Failed/cancelled delivery rate.
- Handoff-code failures.
- Safety incidents.
- Expired eligibility/availability blocks.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
