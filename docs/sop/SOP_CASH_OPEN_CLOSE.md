---
document_id: BL-40-PH-SOP-001
title: SOP — Business Cash Opening, Closing and Reconciliation
document_type: sop
status: DRAFT
access_class: BUSINESS_PRIVATE
applicable_profiles: [merchant, supplier]
applicable_functions: [Business Owner, Business Manager, Cashier / Counter Operator, Finance / Bookkeeping Operator]
country_code: PH
territory_scope: country
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: PLATFORM_POLICY
---

# SOP — Business Cash Opening, Closing and Reconciliation

## Purpose

Ensure physical cash and recorded business cash remain explainable at the beginning and end of each operating day.

## Scope

Applies to Merchant/Supplier business workspaces using the Cash money account and daily opening/closing functions.

## Roles

- Business Owner/Manager owns the control environment.
- Authorized Cashier records/counts cash according to delegated scope.
- Finance/Bookkeeping reviews unexplained variances.

## Prerequisites

- Correct business workspace is active.
- Authorized user is permitted to handle/reconcile cash.
- Previous unresolved material variance is known/escalated.

## Inputs / evidence

- Physical cash count.
- Recorded opening cash.
- Recorded transactions affecting Cash.
- End-of-day physical cash count.
- Variance explanation/supporting evidence when needed.

## Procedure

1. At start of day, physically count opening cash before normal transactions begin.
2. Record the opening cash in the active business workspace. Do not copy a previous day's number without counting.
3. During the day, record real Cash sales, business expenses, money received and personal withdrawals in the correct workflow/account.
4. For linked order/procurement/remittance events, use the source workflow rather than creating duplicate manual entries.
5. At close, count physical cash independently from the application's expected balance.
6. Enter Actual cash into the day-close workflow.
7. Review Expected cash, Actual cash and Variance.
8. Investigate any material or unexplained variance using transaction/order/payment records.
9. Document the reason/evidence for a known discrepancy and escalate unresolved or suspicious differences.
10. Do not alter unrelated historical records merely to force the variance to zero.

## Control points

- Opening cash must be zero or greater.
- Day close requires an opening record.
- Expected cash is system-derived from recorded Cash movements.
- Variance is Actual cash minus Expected cash.
- Cash reconciliation is business-workspace scoped.

## Prohibited shortcuts

- Inventing a cash count.
- Changing payment method/account after the fact solely to eliminate a variance.
- Deleting/duplicating linked financial events.
- Using another business workspace's cash records.

## Exceptions / escalation

- Suspected theft/fraud → private Incident + Business Owner/Admin escalation.
- System calculation discrepancy → Support/Finance investigation before manual correction.
- Large unexplained variance → Finance/Business Owner review.

## Records / audit

- Daily opening record.
- Daily closing record.
- Transaction ledger.
- Order/payment records.
- Correction audit events.
- Incident/case reference if escalated.

## Related controlled forms

- BL-120-PH-FORM-008 Accounting Evidence Cover Sheet

## Related public Help Center guides

- `/help/article/open-close-day`
- `/help/article/merchant-money-accounts`
- `/help/article/record-transaction`
- `/help/article/financial-corrections-audit`

## KPI / quality controls

- Unexplained cash variance count/value.
- Days closed with complete reconciliation.
- Duplicate/incorrect money-account corrections.
- Time to resolve material variance.

## Version control

This SOP is a controlled DRAFT until approved/effective. If product behavior, legal/compliance requirements or delegated authority changes, this SOP must be reviewed before being treated as current.
