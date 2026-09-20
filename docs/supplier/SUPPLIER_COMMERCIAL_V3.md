# Supplier Commercial Lifecycle V3 — Philippines

Status: **IMPLEMENTATION SOURCE**
Issue: #341
PR: #342
Market: Philippines
Profiles: Merchant, Supplier
Depends on: Supplier Domain V2

## 1. Canonical commercial sequence

Business & Life keeps these concepts separate:

1. **Purchase Order (PO)** — the Merchant's commercial request/commitment.
2. **Receiving** — what physically arrived.
3. **Supplier invoice/evidence** — a seller-issued commercial/fiscal document.
4. **Payment** — actual money movement recorded by the Merchant.
5. **Return** — physical goods moving back upstream.
6. **Credit** — a Supplier-confirmed reduction of commercial liability.
7. **Refund** — actual money returned, recorded separately when it really occurs.
8. **Recall / withdrawal** — a traceability and safety action against identified goods/lots.

A PO is not automatically an invoice.
An invoice is not automatically proof of payment.
A credit is not automatically cash received.

## 2. Payment / credit terms

Supported relationship terms:
- prepaid;
- cash / COD;
- due on receipt;
- Net 7;
- Net 15;
- Net 30;
- Net 45;
- Net 60;
- custom 0–365 days.

Optional:
- currency;
- credit limit;
- note.

For a connected Supplier, the Supplier can confirm relationship terms.
For an external/local Supplier, the Merchant may record the terms as evidence of the real arrangement.

Business & Life does not represent recorded terms as bank credit approval.

## 3. Supplier invoice evidence

Invoice/evidence fields include:
- business;
- connected Supplier or external supply party;
- related PO and/or lot;
- document number;
- document kind;
- issue date;
- due date;
- currency;
- gross amount;
- source side;
- evidence reference;
- internal fiscal/evidence status.

Initial document kinds:
- invoice;
- sales invoice;
- charge invoice;
- billing invoice;
- other supplier document.

Default fiscal status is `internal_evidence`.

No record becomes BIR-valid simply because its label says “invoice”.

## 4. Due date

If no explicit due date is recorded, V3 may derive it from explicit relationship terms.

Examples:
- invoice 20 Sep + Net 30 → 20 Oct;
- due on receipt → physical received date when known;
- custom 21 → invoice date + 21 days.

The derived due date is operational evidence, not a legal opinion.

## 5. Commercial position

For a PO, V3 shows these values independently:
- PO expected total;
- received value;
- invoice/evidence total;
- recorded payment;
- confirmed Supplier credits;
- outstanding;
- supplier refund/credit due if recorded payment exceeds net liability;
- invoice-vs-received variance;
- earliest due date / overdue state.

Charge-basis priority:
1. active invoice evidence, when present;
2. physically received value;
3. PO expected total as the remaining fallback commitment.

Confirmed credit is subtracted before outstanding is calculated.

## 6. Physical returns

Lifecycle:
- `requested`;
- `authorized` or `rejected` for a connected Supplier;
- `returned` when stock physically leaves the Merchant;
- `resolved` after the Supplier's actual resolution is recorded.

A return request does **not** reduce stock.

At physical return:
- source lot quantity is reduced;
- linked Inventory quantity is reduced;
- both changes occur in one transaction;
- the same return cannot dispatch twice.

Initial reasons:
- damaged;
- expired;
- wrong item;
- quality;
- recall;
- over-delivery;
- other.

Derived/repacked child lots are not returned directly upstream in V3; upstream return starts from an appropriate original traceable lot.

## 7. Return resolution

Initial resolution types:
- credit;
- refund expected;
- replacement;
- no credit.

A Supplier-confirmed credit reduces the commercial payable/receivable.

`refund_expected` means a refund is expected or confirmed as a resolution type; it does not create a cash-in transaction by itself.

A real cash refund must be represented by a separate money event before accounting treats money as received.

## 8. Normal PO receiving and lots

Future PO items snapshot product handling mode so catalog edits do not reinterpret historical purchase evidence.

Normal PO receiving can record:
- supplier lot/batch;
- internal lot;
- catalog item;
- PO and PO item;
- receipt;
- inventory link;
- quantity;
- base unit;
- unit cost;
- package quantity;
- manufacture/packed date when known;
- expiry/best-before when known;
- lot state.

This closes the gap between ordinary procurement receiving and Supplier V2 traceability.

## 9. Recall and quarantine

A Supplier may create an exact lot/batch recall/withdrawal/advisory.

A Merchant may record an external notice for a local Supplier who does not have a Business & Life account.

Matching rules are intentionally conservative:
- exact Supplier lot/batch;
- Supplier identity/source;
- catalog item when supplied.

Matched lots can be marked `quarantined`.

### Current limitation

V3 does **not** claim that aggregate Inventory is fully blocked from sale after a lot recall.

Reason: not every downstream sale/recipe/consumption is allocated lot-by-lot yet.

Current V3 result:
- traceability evidence: yes;
- matched-lot quarantine: yes;
- automatic aggregate sell-blocking: no.

A later FEFO/lot-allocation layer may safely add full downstream blocking.

## 10. Finance reconciliation

Merchant Supplier payables and Supplier Merchant receivables use the same V3 commercial basis:
- invoice evidence when present;
- otherwise received value;
- minus confirmed credits;
- minus recorded payments.

This prevents Procurement and Finance from showing conflicting outstanding balances.

## 11. UX

The default experience stays compact.

Common actions remain prominent:
- order;
- receive;
- pay.

Advanced commercial features use progressive disclosure:
- terms;
- invoice evidence;
- return;
- return resolution;
- lot/expiry;
- recall.

A small sari-sari store or food vendor should not need to understand accounting terminology before recording a basic purchase.

## 12. Philippine official source guidance

### BIR — invoicing after EOPT
RMC 77-2024:
https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf

Digest:
https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf

Product use:
- invoice and payment evidence are separate;
- credit/charge invoice concepts support credit-sale workflows;
- statutory validity is never inferred automatically.

### FDA — recall / distribution traceability
Draft recall guidance:
https://www.fda.gov.ph/draft-for-comments-guidelines-on-the-recall-of-authorized-health-products-regulated-by-the-food-and-drug-administration/

FDA recall oversight statement:
https://www.fda.gov.ph/%F0%9D%90%92%F0%9D%90%93%F0%9D%90%80%F0%9D%90%93%F0%9D%90%84%F0%9D%90%8C%F0%9D%90%84%F0%9D%90%8D%F0%9D%90%93-%F0%9D%90%8E%F0%9D%90%8D-%F0%9D%90%91%F0%9D%90%84%F0%9D%90%82%F0%9D%90%80%F0%9D%90%8B/

Product use:
- exact batch/lot traceability;
- distribution records;
- retail-channel visibility;
- quarantine/recall evidence.

## 13. Active gateway parity

The runtime currently exposes procurement receiving/payment through both the dedicated Supplier service and the multi-business accounting gateway.

Until that architecture is consolidated, every change to these operations must preserve behavioral parity across both active routes:
- receiving creates the same `purchase_receipt_items` evidence;
- receiving creates the same traceable `supply_lots`;
- linked Inventory conversion and lot base units remain aligned;
- payment uses the same current commercial outstanding calculation;
- confirmed Supplier credits reduce the same payable/receivable basis.

A static test must protect both routes. A change is incomplete if only one gateway implements the rule.

## 14. Regression gates

Before V3 merge:
- Supplier V1 must remain valid;
- Supplier Domain V2 acceptance remains prerequisite;
- V3 tests pass;
- exact business isolation remains enforced;
- preview runs `supplier_commercial_v3` to PASS;
- production is not used as the QA environment.
