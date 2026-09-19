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
version: 1.1
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
- Pricing-version inputs, including vehicle-class rule snapshot.
- Estimated weight/volume if available.
- Required vehicle class selected by the quote engine.
- Delivery quote.
- Order readiness/payment.
- Courier eligibility/vehicle class.
- Active status/location.
- Customer handoff code.

## Procedure

1. Customer requests a Delivery quote for a Delivery-enabled Merchant.
2. System validates coordinates, active pricing and configured maximum service distance.
3. System totals estimated shipment weight and volume.
4. For Delivery Pricing V2, the quote engine selects the smallest configured eligible vehicle class:
   - Bicycle: base fee + distance; weight/volume are capacity gates only.
   - Car: base fee + distance + weight + volume.
   - Van: base fee + distance + weight + volume.
5. System snapshots required vehicle class, pricing formula and pricing-rule version into the quote.
6. Review quote fee/distance and use it before its current 15-minute expiry.
7. Delivery checkout currently requires online/digital payment; cash delivery remains disabled.
8. Merchant prepares order and confirms payment.
9. When order is Ready and Paid, Merchant requests Courier dispatch.
10. Assign only an approved/available Courier whose approved vehicle class, weight/volume capacity and radius satisfy the quoted Delivery requirement.
11. Courier follows allowed delivery statuses from assignment toward Merchant pickup and Customer arrival.
12. Courier may share location only while active tracking is open for that assigned delivery.
13. At Customer destination, Courier reaches customer-arrival state before completion.
14. Customer provides the active completion/handoff code at actual handoff.
15. Courier enters code; system marks Delivery delivered, clears live location and completes linked order.
16. Delivery monetization evidence uses the separate verified Delivery price. After promo and only after live policy activation, Business & Life's target is 10% of that Delivery price; Courier gross Delivery entitlement is 90% before other legitimate adjustments.

## Control points

- Quote status must be quoted/unexpired when used.
- Current quote expiry is 15 minutes.
- Dispatch blocked unless order Ready + Paid.
- Courier availability blocked unless eligibility approved and unexpired.
- V2 assignment blocked when Courier vehicle class/capacity/radius does not satisfy the quote.
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
