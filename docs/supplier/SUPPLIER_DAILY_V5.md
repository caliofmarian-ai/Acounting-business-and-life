# Supplier Daily Operations V5 — Today, Money, Availability, Backorders and Substitutions

Status: **IMPLEMENTATION SOURCE**
Issue: #347
PR: #348
Market: Philippines
Profiles: Supplier, Merchant
Depends on: Supplier V1–V4

## 1. Product goal

A Supplier opening Business & Life on a phone should immediately understand:

- what needs attention now;
- which orders need a response;
- what must be prepared;
- what is ready for pickup/delivery;
- what money is actually receivable;
- which RFQs or returns need action;
- which catalog items are limited/unavailable;
- which Merchant-approved backorders or substitutions still need Supplier action.

The default Supplier workspace is **Today**.

## 2. Canonical Supplier navigation

Top-level mobile Supplier destinations:

1. **Today**
2. **Catalog**
3. **Orders**
4. **Money**

Legacy technical sections remain supported for direct actions and backward compatibility:
- Procurement
- ETA
- Fulfilment

The simplified hub does not remove the underlying PO lifecycle.

## 3. Today order buckets

Today reuses existing purchase-order states.

### New orders
- `sent`
- `supplier_received`

### Prepare
- `accepted`
- `partially_accepted`
- `preparing`

### Ready / fulfilment
- `ready_for_pickup`
- `out_for_delivery`
- `delivered`
- `partially_received`

### Completed
- `received`

No duplicate V5 order-state system is introduced.

## 4. Factual attention signals

Today may derive factual signals:

- partial acceptance follow-up;
- promised ready time overdue;
- delivery ETA overdue;
- awaiting Merchant receipt;
- operational receivable overdue;
- RFQ awaiting Supplier response;
- return awaiting Supplier response;
- limited/unavailable catalog availability;
- expected-restock date passed;
- Merchant-accepted backorder waiting for Supplier fulfilment;
- Merchant-approved substitution waiting for a future physical-fulfilment implementation.

There is no hidden priority score.

## 5. Money due

Supplier Today/Money is intentionally conservative.

Operational Supplier receivable basis:

1. active Supplier invoice evidence, when present;
2. otherwise physically received value;
3. minus confirmed credits;
4. minus recorded payments.

An unreceived, uninvoiced PO commitment is **not** Money due.

This is a Supplier daily-operational view. It does not replace the wider V3 commercial-position model used elsewhere.

A due date is compared by calendar day:
- due today = not overdue;
- due before today = overdue.

## 6. Catalog availability

V5 quick availability supports:

- `available`
- `limited`
- `unavailable`
- lead days;
- availability note;
- expected restock date.

Availability is explicitly evidence only.

API response declares:

- `stock_claim = AVAILABILITY_EVIDENCE_ONLY`
- `exact_on_hand_quantity = null`

V5 does not pretend that catalog availability is exact Supplier warehouse inventory.

## 7. Backorder

Backorder addresses the unconfirmed remainder of a partially accepted PO item.

### Proposal
Supplier may propose:
- PO item;
- proposed packs;
- expected available date;
- note.

Rules:
- proposal must be greater than zero;
- proposal cannot exceed `ordered_packs - confirmed_packs`;
- proposal does not change ordered packs;
- proposal does not change confirmed packs;
- proposal does not change Inventory;
- proposal does not move money.

### Merchant decision
States:
- `proposed`
- `merchant_accepted`
- `merchant_declined`
- `fulfilled`
- `cancelled`

Merchant acceptance is explicit evidence only.

### Supplier fulfilment
Only a `merchant_accepted` backorder may be marked available/fulfilled.

At fulfilment:
- `confirmed_packs` increases by the accepted backorder amount;
- `ordered_packs` remains unchanged;
- Inventory is unchanged;
- money is unchanged.

If all PO items become fully confirmed, a PO may move from `partially_accepted` to `accepted`.

## 8. Substitution

Substitution also applies only to an unconfirmed PO remainder.

Supplier may propose:
- original PO item;
- different active Supplier catalog item;
- substitute pack/unit snapshot;
- substitute handling mode snapshot;
- proposed packs;
- explicit substitute price;
- reason;
- optional expected-available date;
- note.

Reasons:
- unavailable;
- quality;
- pack size;
- brand request;
- other.

### Merchant decision
States:
- `proposed`
- `merchant_accepted`
- `merchant_declined`
- `cancelled`

Merchant approval is evidence only.

Approval does **not**:
- rewrite the original PO item snapshot;
- increase confirmed packs;
- change receiving;
- change Merchant Inventory;
- create money movement.

Accepted substitution returns:
`MERCHANT_APPROVED_NOT_YET_FULFILLED`

Physical substitute fulfilment/receiving is intentionally deferred until the normal receiving/lot engine can attribute substitute goods safely.

## 9. Multi-business safety

Business & Life must not combine Supplier activity from multiple businesses merely because they share one account.

### Today / Money / availability

The current V1–V4 catalog and some direct PO history are account-scoped and do not always contain explicit Supplier-business attribution.

Therefore, when an account has more than one active Supplier-business binding:

- `Today` fails closed with `SUPPLIER_BUSINESS_ATTRIBUTION_REQUIRED`;
- quick catalog availability fails closed with `SUPPLIER_CATALOG_BUSINESS_ATTRIBUTION_REQUIRED`;
- UI shows the attribution problem explicitly instead of an empty dashboard.

Business & Life does not show an account-wide mixed Today dashboard and call it business-specific.

### Backorder

Supplier business attribution is explicit when the PO originated from a quote with `supplier_business_id`.

Backorder may use that attributable PO evidence because it does not introduce a new catalog item.

A direct PO without attributable Supplier business fails closed on a multi-business Supplier account.

### Substitution

Substitution introduces a new Supplier catalog item. The current catalog is account-scoped and does not yet have a general canonical catalog-item→Supplier-business binding.

Therefore multi-business substitution fails closed with:

`SUPPLIER_SUBSTITUTE_CATALOG_ATTRIBUTION_REQUIRED`

until explicit catalog-to-business attribution exists.

The system does not guess which Supplier business owns the substitute item.

## 10. Today exception surfaces

Today shows:

- accepted backorders with **Available now** action;
- approved substitutions with:
  **Merchant approved — physical fulfilment not recorded yet**.

Merchant Procurement shows proposed Supplier changes in one compact decision surface:
- Accept / Decline backorder;
- Accept / Decline substitution.

## 11. Mobile UX

Figma:
- file: `Business & Life — Supplier V2 Mobile`
- V5 Today frame: `Supplier V5 / Today`
- 390×844

The V5 Today frame uses progressive disclosure for secondary attention.

Final compact layout fits within the viewport; key daily actions remain above the fold.

## 12. QA wave

Wave: `supplier_daily_v5`

V4 is a prerequisite.

The acceptance wave verifies:

- V1–V4 baseline;
- source PO visible as new order;
- unreceived/uninvoiced PO Money due = 0;
- availability evidence-only semantics;
- limited availability attention;
- invoice becomes operational receivable;
- future-due invoice is not overdue;
- backorder proposal does not mutate PO;
- Merchant backorder acceptance is explicit;
- backorder fulfilment changes confirmed packs only;
- substitution proposal does not mutate PO/Inventory/money;
- Merchant substitution acceptance is explicit;
- accepted substitution is not represented as physically fulfilled;
- no opaque priority score.

## 13. Non-goals

V5 does not implement:

- exact Supplier warehouse on-hand stock;
- automatic backorders;
- automatic substitutions;
- automatic Merchant acceptance;
- automatic payment collection;
- hidden Merchant priority scoring;
- physical substitute receiving before lot-aware substitute attribution is implemented.
