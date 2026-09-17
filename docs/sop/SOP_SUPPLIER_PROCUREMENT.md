---
document_id: BL-40-PH-SOP-004
title: SOP — Supplier Relationship, Purchase Order, Receiving and Payment
document_type: sop
status: DRAFT
access_class: BUSINESS_PRIVATE
applicable_profiles: [merchant, supplier]
applicable_functions: [Business Owner, Procurement Operator, Inventory / Production Operator, Finance / Bookkeeping Operator]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Supplier Relationship, Purchase Order, Receiving and Payment

## Purpose

Procure from known Suppliers using explicit relationships, auditable PO snapshots, actual receiving and real payment records.

## Scope

Applies to current Merchant↔Supplier procurement workflows.

## Roles

- Merchant creates relationship/PO and records receiving/payment.
- Supplier accepts relationship, maintains catalog and confirms/fulfils PO.
- Inventory operator records actual received quantities.
- Finance records real Supplier payments.

## Prerequisites

- Both profiles are enabled/authorized as required.
- Merchant has correct business workspace.
- Supplier account/catalog exists.

## Inputs / evidence

- Supplier email/relationship.
- Catalog item/pack data.
- PO quantities/fulfilment mode.
- Supplier confirmed quantities/prices/ETA.
- Actual received packs/actual price.
- Actual payment amount/account.

## Procedure

1. Merchant invites the known Supplier account by email.
2. Supplier reviews and explicitly accepts the relationship before normal catalog/PO exchange.
3. Merchant reviews active Supplier catalog and pack/base-unit/price/minimum/lead-time data.
4. Merchant creates PO with valid quantities. PO snapshots item/pack/price values.
5. Supplier reviews PO and either rejects or confirms quantities/prices; partial confirmation is recorded separately from original order.
6. Supplier progresses fulfilment using supported states such as Preparing, Ready for pickup, Out for delivery or Delivered.
7. When goods physically arrive, Merchant records actual received packs. Never record expected goods as received.
8. If only part arrived, keep PO Partially received and receive remaining confirmed quantities later.
9. Where inventory mapping exists, receiving increases inventory by actual base units and updates unit cost from actual price.
10. Merchant records Supplier payment only when money actually moves, from the correct money account.
11. Review PO payment status (partial/paid), Merchant linked business expense and Supplier linked receipt/accounting where available.
12. Investigate quantity/price/payment discrepancies before closing the commercial relationship.

## Control points

- Relationship must be Accepted before catalog/PO operations.
- PO needs 1–100 items and valid minimum quantities.
- Received packs cannot exceed remaining confirmed packs.
- Actual price must be valid/non-negative.
- Payment cannot exceed outstanding PO amount.
- Received status is separate from Supplier delivery status and payment status.

## Prohibited shortcuts

- Treating an unaccepted Supplier as trusted.
- Changing historical PO snapshot to hide later price change.
- Recording goods before physical receipt.
- Receiving more than confirmed remaining quantity.
- Recording payment before money moves.
- Duplicating linked Supplier financial entries manually.

## Exceptions / escalation

- Supplier unavailable/rejects → Merchant chooses alternative Supplier through proper relationship.
- Short/partial delivery → partial receiving and follow-up.
- Price dispute → stop/reconcile before recording false payment/receipt.
- Suspected fraud/false goods → Incident/Admin escalation.

## Records / audit

- Supplier relationship.
- Catalog snapshot/current catalog.
- PO/items.
- Supplier confirmation/status.
- Purchase receipts/items.
- Inventory updates.
- Supplier payments/accounting entries.

## Related controlled forms

- BL-120-PH-FORM-005 Evidence Submission Index
- BL-120-PH-FORM-008 Accounting Evidence Cover Sheet

## Related public Help Center guides

- `/help/article/trusted-supplier-relationship`
- `/help/article/supplier-relationship-invitations`
- `/help/article/purchase-order-snapshots`
- `/help/article/supplier-po-statuses`
- `/help/article/partial-supplier-receiving`
- `/help/article/supplier-payment-accounting`

## KPI / quality controls

- PO fulfilment rate.
- Partial/rejected orders.
- Receiving discrepancy rate.
- Supplier payment aging.
- Inventory receiving accuracy.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
