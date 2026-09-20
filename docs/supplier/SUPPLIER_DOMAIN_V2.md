# Supplier Domain V2 — Philippines launch model

Status: **IMPLEMENTATION SOURCE**
Issue: #337
Market: Philippines
Profiles affected: Supplier, Merchant
Primary rule: **Supplier is a commercial relationship, not a rigid company type.**

## 1. Purpose

Business & Life must support procurement and resale patterns used by:
- street-food vendors and fast-food businesses;
- restaurants and catering;
- sari-sari stores;
- groceries and mini-markets;
- supermarkets and convenience-style stores;
- local producers and growers;
- processors/manufacturers;
- packers/repackers;
- traders/private-label brand owners;
- importers/exporters;
- distributors/wholesalers;
- mixed food and non-food retailers.

A company or person can be a Supplier to one business, a Merchant to end customers, and a Customer of an upstream business without duplicate identity records.

## 2. Canonical concepts

### Relationship role
A Supplier relationship answers: **who supplies this business?**

Relationship state is separate from what the supplying entity does operationally.

### Business activities
Initial canonical activities:
- producer;
- processor;
- manufacturer;
- packer;
- repacker;
- trader;
- importer;
- exporter;
- distributor;
- wholesaler;
- retailer;
- service provider.

One business may have several activities.

### Product handling modes

`sealed_resale`
: Product remains in the manufacturer/packer-sealed consumer unit.

`break_pack`
: An outer case/carton/tray is opened but each inner unit remains its original sealed/labelled unit.

`bulk`
: Product is handled by mass, volume or count without a merchant-created consumer pack definition.

`repacked`
: Product is transferred to a new/smaller package or relabelled as a merchant-controlled pack. This requires transformation lineage.

`produced`
: Ingredients/materials are transformed into a distinct finished product. This belongs to production/recipe logic, not ordinary break-pack.

**Opening a case of 24 individually sealed cans and selling one can is not repacking.**

## 3. Package hierarchy

The legacy Supplier catalog fields `unit_name`, `base_unit` and `base_units_per_pack` remain valid and historical PO snapshots must never be reinterpreted.

V2 extends the model so package relationships can express:
- 1 case = 24 bottles;
- 1 tray = 30 eggs;
- 1 sack = 50 kg;
- 1 box = N inner packs.

Each transformation must be deterministic and scoped to an item/version.

## 4. External Supplier

A Merchant must be able to record procurement from a Supplier that does not yet have a Business & Life account.

Minimum external Supplier:
- name;
- optional contact method;
- optional location/note;
- supplied item/description.

Later connection/claim:
- links the external Supplier record to an approved Business & Life Supplier;
- preserves purchase, lot, price and payment history;
- does not rewrite historical supplier evidence.

## 5. Lots and traceability

Where applicable, receiving can record:
- source Supplier;
- source PO/receipt;
- supplier lot/batch;
- internal lot;
- received date;
- packed/manufactured date if known;
- expiry/best-before if applicable;
- quantity received;
- quantity remaining.

Downstream break-pack/repack/production records reference source lots.

Derived lots must not silently receive an expiry later than the earliest applicable source expiry.

## 6. Repacking

A repack event records:
- source lot(s);
- input quantity and base unit;
- output item;
- package size;
- number of output packages;
- packaging material/cost;
- explicit waste/shrinkage;
- operator and timestamp;
- derived unit cost;
- child lot;
- expiry lineage.

Quantity conservation rule:

`input = packed output + explicit waste + explicit retained remainder`

The first implementation may require retained remainder to be zero; later versions may model it explicitly.

Cost rule:
- source product cost consumed by the operation is allocated to sellable output;
- packaging cost is added;
- cost is evidence, not retail price.

## 7. Tiered B2B pricing

Supplier catalog can have quantity thresholds, e.g.:
- base pack price;
- 6+;
- 25+;
- 100+.

PO creation chooses a qualifying price only when the rules are explicit, then snapshots that selected price in the PO.

Historical PO prices never change when current catalog tiers change.

## 8. Regulatory/compliance boundary

Business & Life records business activity and evidence; it does **not** declare a business legally licensed merely because a checkbox is set.

Official evidence guiding the product model:
- PSA PSIC Revision 5, including groceries, supermarkets, sari-sari stores, convenience stores and hypermarkets:
  https://psa.gov.ph/classification/psic/class/4711
- FDA CFRR Citizen Charter 2025, including LTO workflows for Food Manufacturers and Food Traders/Distributors (Importer/Exporter/Wholesaler):
  https://www.fda.gov.ph/citizen-charter-cfrr-2025/
- FDA eServices License to Operate:
  https://eservices.fda.gov.ph/applications/license_to_operate
- FDA Administrative Order 2014-0030-A on prepackaged-food labelling:
  https://www.fda.gov.ph/administrative-order-no-2014-0030-a/
- FDA AO 2024-0015 licensing framework:
  https://www.fda.gov.ph/administrative-order-no-2024-0015-prescribing-the-rules-requirements-and-procedures-in-the-application-for-license-to-operate-of-covered-health-product-establishments-with-the-food-and-drug-adm/
- BIR RMC 77-2024 invoicing guidance under EOPT:
  https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf

Compliance gates must be driven by jurisdiction + activity + product class and reviewed when rules change.

## 9. UX rules

The engine may be sophisticated; the Merchant experience must not be.

Default simple path:
1. Supplier
2. Item
3. Package
4. Price
5. Quantity
6. Receive

Advanced details are progressively disclosed:
- activity;
- package hierarchy;
- lot/expiry;
- tier pricing;
- compliance evidence;
- repacking.

Do not require the Merchant to understand terms such as PSIC, LTO or lineage to record an ordinary purchase.

## 10. Regression baseline

Before Supplier V2 merge:
- existing `supplier_experience_v1` must remain PASS;
- existing PO snapshots and receiving behavior must remain compatible;
- no cross-business data leakage;
- Supplier Finance remains shared-ledger/evidence based;
- non-food Supplier UI must not inherit restaurant/menu assumptions.

## 11. V2 QA target

A deterministic acceptance wave must eventually cover:
- external supplier;
- connected supplier;
- sealed resale;
- case break-pack;
- bulk receiving;
- repacking;
- lot/expiry lineage;
- tier price snapshot;
- inventory cost;
- accounting regression;
- mobile/Android-safe UI.
