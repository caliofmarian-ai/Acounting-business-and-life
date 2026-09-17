---
document_id: BL-40-PH-SOP-003
title: SOP — Accounting Transaction Correction and Audit Trail
document_type: sop
status: DRAFT
access_class: BUSINESS_PRIVATE
applicable_profiles: [merchant, supplier]
applicable_functions: [Business Owner, Finance / Bookkeeping Operator]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Accounting Transaction Correction and Audit Trail

## Purpose

Correct eligible accounting mistakes without erasing the history or breaking linked commercial records.

## Scope

Applies to transaction correction in an authorized Merchant/Supplier business workspace.

## Roles

- Authorized finance/business user proposes correction.
- Business Owner/Manager reviews sensitive corrections.
- Support/technical escalation investigates system-generated inconsistencies.

## Prerequisites

- Correct business workspace.
- Existing transaction identified.
- Correction reason/evidence available.

## Inputs / evidence

- Current transaction.
- Correct values.
- Reason for correction.
- Supporting source record if relevant.

## Procedure

1. Confirm the transaction belongs to the intended business workspace.
2. Identify whether it is a manual eligible transaction or a protected linked entry.
3. If source is remittance, product_sale, order_payment, supplier_payment or supplier_receipt, do not correct it independently; resolve the source workflow.
4. For an eligible manual transaction, verify the correct type, category, amount, money account, note and date.
5. Enter a clear correction reason.
6. Save the correction.
7. Review the generated audit event containing before/after data and reason.
8. If correction changes a material business report/reconciliation, re-run the relevant review and document follow-up.

## Control points

- Correction cannot use an invalid transaction type/account/amount.
- Linked entries are protected from independent correction.
- Audit event records before/after data and reason.
- All operations are business-scoped.

## Prohibited shortcuts

- Deleting history to hide a mistake.
- Editing a protected linked transaction instead of its source.
- Changing another business's records.
- Using Adjustments or corrections to fabricate revenue/cash.

## Exceptions / escalation

- System-generated linked entry is wrong → technical/finance investigation.
- Potential fraud → Incident + privileged review.
- Historical period already externally reported → accountant/compliance coordination before correction consequences are represented.

## Records / audit

- Transaction.
- Audit event.
- Correction reason.
- Related source record/case.

## Related controlled forms

- BL-120-PH-FORM-008 Accounting Evidence Cover Sheet
- BL-120-PH-FORM-015 Internal Compliance Review Report

## Related public Help Center guides

- `/help/article/financial-corrections-audit`
- `/help/article/record-transaction`
- `/help/article/export-transactions-csv`

## KPI / quality controls

- Corrections by cause.
- Protected-entry correction attempts.
- Unexplained adjustments.
- Audit completeness.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
