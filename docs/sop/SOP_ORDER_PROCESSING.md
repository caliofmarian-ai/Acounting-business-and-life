---
document_id: BL-40-PH-SOP-002
title: SOP — Customer Order Processing, Payment and Presence Gates
document_type: sop
status: DRAFT
access_class: BUSINESS_PRIVATE
applicable_profiles: [customer, merchant]
applicable_functions: [Business Owner, Business Manager, Cashier / Counter Operator]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Customer Order Processing, Payment and Presence Gates

## Purpose

Process Customer orders in the allowed sequence while keeping fulfilment status and actual payment status separate.

## Scope

Applies to Customer/Merchant orders for pickup or delivery in current merged order/marketplace workflows.

## Roles

- Customer places/monitors own order and checks in when required.
- Merchant staff verifies payment/presence and fulfils the order.
- Business Owner/Manager controls Merchant trust exceptions.

## Prerequisites

- Published/available Merchant products and supported checkout options.
- Correct business workspace/storefront.
- Customer order exists.

## Inputs / evidence

- Order items/quantities.
- Fulfilment method.
- Payment method.
- Customer check-in/presence evidence when required.
- Actual payment amount/account.
- Cancellation/credit reason where applicable.

## Procedure

1. Review the order status and payment status separately before taking action.
2. If status is Awaiting payment, do not start preparation until confirmed payment moves the workflow to an allowed state.
3. For cash pickup with a Customer not allowed remote cash preparation, wait for Customer check-in/presence.
4. When the Customer arrives, Customer selects I'm here; Merchant confirms presence. Manual presence confirmation may be used only when the Merchant physically verified the Customer.
5. Start preparation only from an allowed status. Starting preparation may consume tracked marketplace stock and/or recipe ingredients.
6. When preparation is complete, mark the order Ready.
7. For pickup: record real money received if not already paid. A ready pickup with outstanding balance may be completed only with explicit credit/receivable acknowledgement.
8. For delivery: use Delivery handoff/dispatch flow only when appropriate; order payment and readiness gates still apply.
9. Complete the pickup/delivery through the correct workflow.
10. If cancellation is needed before terminal state, record a reason. Where stock was consumed, cancellation reverses eligible stock/inventory consumption once.
11. Review order history/status events for disputes or exceptions.

## Control points

- Allowed fulfilment statuses: awaiting_payment, awaiting_customer_presence, accepted, preparing, ready, handoff_to_delivery, completed, cancelled.
- Payment status is independent: unpaid, partial, paid.
- Remote cash preparation eligibility requires at least 5 completed orders with the same Merchant, Merchant opt-in and no trust suspension.
- Payment entered cannot exceed outstanding amount.
- Completed/cancelled orders are terminal for cancellation/start actions.

## Prohibited shortcuts

- Marking unpaid money as paid.
- Starting a gated cash order without required presence/trust permission.
- Enabling remote preparation before Customer eligibility.
- Completing a delivery through pickup-only completion.
- Creating duplicate manual sale for an order payment already linked.
- Cancelling a terminal order.

## Exceptions / escalation

- Customer disputes presence/payment → Support/Incident as appropriate.
- Stock shortage → stop preparation and correct operationally; do not fabricate stock.
- Credit exception → explicit Merchant decision and receivable remains outstanding.
- Suspected abuse/trust issue → suspend Merchant-specific remote-cash trust and escalate.

## Records / audit

- Order record/items.
- Order status events.
- Payment records.
- Stock consumption/reversal events.
- Merchant-Customer trust setting.
- Cancellation reason.
- Receivable/outstanding balance.

## Related controlled forms

- BL-120-PH-FORM-008 Accounting Evidence Cover Sheet

## Related public Help Center guides

- `/help/article/order-statuses-explained`
- `/help/article/cash-pickup-presence`
- `/help/article/remote-cash-trust`
- `/help/article/merchant-order-workflow`
- `/help/article/customer-credit-receivables`
- `/help/article/cancel-order-stock-reversal`

## KPI / quality controls

- Order completion/cancellation rate.
- Presence-gate exceptions.
- Payment/fulfilment mismatch rate.
- Stock-reversal errors.
- Receivable aging/exposure.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
