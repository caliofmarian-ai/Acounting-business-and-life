# Financial Document Engine V1

Status: **OWNER-APPROVED ARCHITECTURE / IMPLEMENTATION IN REVIEW**

Canonical issue: #247.

## Purpose

Business & Life must be able to explain every financial operation without pretending that every internal financial record is legally a tax invoice.

The engine is a **derived evidence/document layer** over existing authoritative ledgers.

It does not replace:
- Merchant/Supplier `transactions`;
- Customer/Courier/Service Provider `profile_money_entries`;
- Payment Core intents/allocations/refunds/settlements;
- subscription invoices;
- operational Orders, Delivery, Procurement or Local Services source records.

## Canonical chain

`Source event → Financial document/evidence → source link → profile/business scope → periodic statement → consolidated own-account view → future jurisdiction/fiscal output`

## Scope model

### Account-owned scopes
- Customer;
- Delivery/Courier;
- Local Services / Service Provider.

### Business-owned scopes
- Merchant;
- Supplier.

A user may see only scopes already authorized through the normal profile and business-membership system.

The consolidated view is limited to the authenticated user's own scopes.

If the same business workspace is bound to both Merchant and Supplier, consolidation counts that shared business ledger once.

## Document types

V1 supports internal types including:
- sale invoice candidate;
- service invoice candidate;
- subscription invoice;
- payment receipt;
- refund credit;
- expense evidence;
- processor fee record;
- platform fee record;
- tax record;
- delivery settlement record;
- profile transfer record;
- owner distribution record;
- accounting adjustment record;
- generic financial evidence.

The suffix `_candidate` is deliberate: internal commercial evidence is not automatically a BIR-valid invoice.

## Fiscal boundary

`fiscal_status` is separate from `document_type`.

V1 values:
- `internal_evidence`;
- `fiscal_candidate`;
- `fiscal_validated`;
- `not_applicable`.

No runtime code may promote an internal record to `fiscal_validated` merely because its title contains the word Invoice.

## Fee ownership

Every fee remains separately identifiable.

PayMongo processor cost is visible as `processor_fee_record`.

It is **not** counted as a Merchant/Supplier expense unless an applicable versioned fee-policy rule explicitly charges it to that participant through `charged_to`.

The same principle applies to platform, operator, tax and withholding components.

## Corrections and reversals

Documents are not silently rewritten.

For corrected business transactions:
1. original source snapshot is preserved;
2. correction evidence reverses the prior economic effect;
3. replacement effect is applied;
4. source links connect the correction back to the original transaction.

For profile Money reversals:
- original evidence remains traceable;
- a reversal document provides the inverse impact;
- source records remain authoritative.

## Periodic statements

Supported V1 periods:
- day;
- ISO week (Monday start);
- calendar month;
- calendar year.

Calendar interpretation is `Asia/Manila`.

Statements show separate totals for:
- revenue;
- expense;
- purchases;
- cash in/out;
- refunds;
- transfers;
- fee expense;
- tax expense;
- neutral/context-only components.

Derived values do not replace underlying records.

## APIs

### Financial documents

`GET /api/financial-documents?profile_role=<role>&business_id=<optional>&from=<date>&to=<date>`

`GET /api/financial-documents/:publicId?profile_role=<role>&business_id=<optional>`

### Profile/business statement

`GET /api/financial-statements/:period?profile_role=<role>&business_id=<optional>&anchor=YYYY-MM-DD`

### Own-account consolidated statement

`GET /api/financial-statements/consolidated/:period?anchor=YYYY-MM-DD`

## V1 source coverage

Initial synchronization covers:
- Merchant/Supplier accounting transactions and transaction-correction audit;
- Customer/Courier/Service Provider profile-money entries and reversals;
- succeeded Customer Payment Core intents and refunds;
- PayMongo/platform/tax allocation context;
- completed Local Services commercial evidence;
- completed Delivery context and provider net allocations;
- subscription invoices when they exist.

Additional source adapters may be added without creating a second ledger.

## Figma source

File:
https://www.figma.com/design/sRwVQFpQchn9kv72vOoUbg

Page:
`Financial Documents V1` — `17:50`

Android frames:
- `Android / Statements & Documents` — `17:51`
- `Android / Consolidated Financial View` — `17:113`

The runtime Android workspace follows this same hierarchy: profile/consolidated mode, period selection, financial metrics, evidence boundary and document drill-down.

## Next slices

1. Android statement/document UI.
2. Explicit company/Admin finance scope.
3. automatic source-event hooks for all economic events rather than read-time synchronization alone.
4. statement export/PDF/CSV.
5. fiscal-rules layer for BIR document classification and statutory numbering.
6. monthly subscription invoice generation/payment flow.
7. historical statement finalization/snapshot policy where legally required.
