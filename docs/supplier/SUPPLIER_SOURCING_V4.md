# Supplier Sourcing V4 — controlled discovery, RFQs and preferred sources

Status: **IMPLEMENTATION SOURCE**
Issue: #344
PR: #345
Market: Philippines
Profiles: Merchant, Supplier
Depends on: Supplier Domain V2 + Supplier Commercial Lifecycle V3

## 1. Purpose

V4 adds controlled sourcing for Philippine Merchant workflows such as:
- sari-sari store restocking;
- groceries and mini-markets;
- restaurants and food businesses;
- wholesalers and small retailers;
- packaging and operating supplies.

The goal is to help a Merchant find alternative sources, request comparable offers and choose a source deliberately.

V4 is **not** an open public supplier marketplace.

## 2. Privacy and discovery

Supplier sourcing visibility is private by default.

Supported states:

- `private` — existing relationships/invitations only;
- `directory` — authenticated approved Merchants may discover the Supplier business summary;
- `rfq_only` — Supplier can receive sourcing requests while catalog summary stays private.

Supplier must opt in explicitly.

Discovery never exposes:
- private email;
- private phone;
- precise/private address evidence;
- financial data;
- compliance documents;
- internal notes.

Directory-safe fields may include:
- Supplier/business display name;
- categories;
- coarse service area;
- fulfilment capability;
- normal lead days;
- minimum order value;
- RFQ availability;
- explicitly published catalog summary.

## 3. Sourcing categories

Initial sourcing categories:

- fresh produce;
- meat & poultry;
- fish & seafood;
- rice & grains;
- beverages;
- packaged foods;
- frozen foods;
- bakery;
- household/FMCG;
- personal care;
- packaging;
- cleaning supplies;
- LPG/fuel;
- equipment;
- services;
- other.

Categories are navigation metadata only. They are not licences or regulatory approvals.

## 4. Request for Quote (RFQ)

An RFQ is a sourcing request, not a purchase order.

Merchant may specify:
- item/specification;
- requested quantity;
- requested unit;
- needed-by date;
- delivery / pickup / either;
- service-area note;
- quality/brand requirements;
- substitution policy;
- optional target budget;
- note.

RFQ target cap: **1–5 Suppliers**.

A Supplier target is eligible when:
- there is an accepted Merchant↔Supplier relationship; or
- Supplier opted into eligible discovery and accepts RFQs.

Creating an RFQ must never:
- reserve stock automatically;
- create a PO;
- create accounting entries;
- move money.

## 5. Supplier quote

Quote is an offer, not an invoice and not a PO.

Connected Supplier quote may include:
- catalog item or manual offered item;
- pack name;
- base unit;
- base units per pack;
- quoted packs;
- MOQ/minimum packs;
- price per pack;
- delivery fee;
- lead days;
- earliest fulfilment date;
- valid-until date;
- availability;
- substitution/brand note;
- payment-term note;
- Supplier note.

Quote quantity cannot be below its own MOQ.

Expired or closed RFQs cannot receive new quotes.

## 6. External/local Supplier quote evidence

Merchant may record quote evidence from an external/local Supplier already represented by `merchant_supply_parties`.

External quote:
- is Merchant-recorded evidence;
- is not an in-app Supplier commitment;
- cannot create an in-app PO directly;
- remains separate from a connected Supplier quote.

This supports wet-market vendors, local distributors and other suppliers without Business & Life accounts.

## 7. Factual comparison

Comparison may calculate:

- quoted subtotal;
- delivery fee;
- landed total;
- normalized landed cost per comparable base unit;
- MOQ;
- lead time;
- earliest fulfilment date;
- validity;
- availability;
- relationship/source type.

Supported deterministic measurement conversions reuse the canonical inventory measurement engine:
- kg ↔ g;
- L ↔ ml;
- unit/piece within the same count family.

If units cannot be deterministically compared, result is:

`NOT_COMPARABLE`

Business & Life must never invent a conversion.

### Factual highlights

UI may identify factual minima such as:
- lowest normalized landed cost among comparable active quotes;
- earliest quoted fulfilment date.

These are factual highlights, not recommendations.

Canonical result always keeps:

`auto_selected_quote_id = null`

Business & Life does not choose a Supplier for the Merchant.

## 8. Preferred and fallback sources

Merchant explicitly controls reorder source order per Inventory item.

Example:
1. Supplier A / catalog item X
2. Supplier B / catalog item Y

Rules:
- preference rank is explicit;
- duplicate ranks are rejected;
- source catalog item must be active;
- accepted Supplier relationship is required;
- unavailable source is skipped;
- next configured source is fallback;
- no source is inferred silently from lowest price.

## 9. Reorder suggestions

Reorder suggestions:
- work for any authorized Merchant business, not only the original business;
- use explicit preferred available source;
- convert Inventory and Supplier pack units before computing suggested packs;
- return `NOT_COMPARABLE` when units are incompatible;
- respect Supplier MOQ;
- do not create a PO automatically.

This logic is canonical in one helper and reused by both procurement gateways.

## 10. Quote → PO

Only an explicit Merchant action may convert an active connected-Supplier quote into a PO.

Requirements:
- connected Supplier quote;
- active/non-expired quote;
- accepted Supplier relationship;
- order packs satisfy MOQ and quoted maximum.

Created PO snapshots:
- Supplier;
- source quote id;
- offered/catalog item;
- pack/unit definition;
- handling mode;
- quote price;
- delivery fee;
- selected fulfilment mode.

Historical quote changes must not rewrite the PO.

External Supplier quote evidence cannot be converted directly into an in-app PO.

## 11. Accounting boundary

The V3 boundaries remain unchanged:

- RFQ ≠ PO;
- quote ≠ PO;
- PO ≠ invoice;
- receiving ≠ invoice;
- invoice ≠ payment;
- credit ≠ cash refund.

Sourcing activity does not change stock, money or accounting until the Merchant explicitly creates a PO and subsequent real commercial events occur.

## 12. UI principles

Merchant default actions:
1. **Find suppliers**
2. **Request quotes**
3. **Compare offers**
4. **Create PO** only after explicit selection.

Supplier default sourcing controls:
- Private / Directory / RFQ only;
- Accept RFQs on/off;
- categories;
- explicitly published catalog items;
- RFQ inbox;
- Quote / Decline.

Advanced sourcing stays under progressive disclosure.

## 13. Philippine product evidence

Relevant references used to guide the product model:

DTI — sari-sari store digitalization:
https://www.dti.gov.ph/dti-news-archived/dti-dti-pilots-tindahan-mo-e-level-up-mo-digitalize-sari-sari-stores-philippines

PSA PSIC retail:
https://psa.gov.ph/classification/psic/class/4711

PSA wholesale division:
https://psa.gov.ph/classification/psic/division/46

GrowSari:
https://business.growsari.com/about-growsari/

Packworks:
https://packworks.io/our-tech/

These examples support low-friction digital restocking and B2B sourcing needs. Business & Life does not copy or claim affiliation with those products.

## 14. QA acceptance

Wave: `supplier_sourcing_v4`

It requires V3 as prerequisite and verifies:
1. private Supplier is hidden;
2. directory opt-in makes only safe fields discoverable;
3. RFQ creation creates no PO;
4. Supplier receives RFQ;
5. connected Supplier quote;
6. external Supplier quote evidence;
7. compatible landed-cost normalization;
8. incompatible units → `NOT_COMPARABLE`;
9. no automatic quote selection;
10. explicit preferred source;
11. reorder works for non-initial Merchant business;
12. reorder creates no PO;
13. explicit quote → PO;
14. PO snapshots quote price/source/handling;
15. V1/V2/V3 regressions remain prerequisites.

## 15. Regression gates

Before merge:
- CI = PASS;
- Admin Runtime Contract = PASS;
- `supplier_sourcing_v4` = PASS on isolated preview;
- mobile Merchant sourcing and Supplier RFQ screens validated;
- no production testing before merge;
- post-merge preview re-validates the merged main commit.
