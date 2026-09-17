# Business & Life — Public Product Catalog

Status: **PUBLIC DOCS V2 / CURRENT MERGED PRODUCT**

This catalog is the public, human-readable characterization of Business & Life — Philippines. It intentionally documents only behavior already merged to GitHub `main`.

Open/unmerged Admin/Support and Referral/Growth work is not described here as currently available.

## Product in one sentence

Business & Life is a mobile-first local economic ecosystem where one human account can participate through separate Customer, Merchant, Supplier, Delivery and Local Services profiles while business money, operational permissions and private evidence remain scoped to the correct context.

## One account, five public profiles

### Customer

**Purpose:** buy products, request local services and follow fulfilment.

Main journey:

```text
Discover
  → choose Merchant / Service Provider
  → order or request
  → review payment / fulfilment / quote
  → track progress
  → receive / confirm completion
  → review or report a problem
```

Important boundaries:
- Marketplace shows published Merchant storefronts/products.
- Fulfilment status and payment status are separate.
- New/untrusted cash pickup can require Customer presence.
- Remote cash preparation is Merchant-specific and becomes eligible only after 5 completed orders with that same Merchant, then requires Merchant opt-in.
- Delivery checkout currently requires a valid delivery quote and online/digital payment.
- Local Services reviews are available only after an in-app completed, Customer-confirmed service job.

### Merchant

**Purpose:** run the local storefront and its economic/operational workspace.

Main journey:

```text
Select business workspace
  → configure/publish storefront
  → receive Customer order
  → enforce payment/presence gates
  → prepare and consume stock
  → record real money received / receivable
  → restock through trusted Suppliers
  → dispatch Delivery when required
  → reconcile and review accounting
```

Accounting includes:
- Cash / GCash / Bank / Other balances;
- manual Sales / Business expenses / Money received / Personal withdrawals / Adjustments;
- opening cash and daily physical cash reconciliation;
- budget/safety warnings;
- inventory and unit costs;
- products, recipes and estimated ingredient profitability;
- remittance records;
- transaction correction audit history;
- CSV transaction export;
- Customer receivables and Supplier payables/commitments.

Important accounting rule: linked order, procurement, remittance or product-sale entries must not be duplicated or independently edited as if they were unrelated manual transactions.

### Supplier

**Purpose:** supply Merchant businesses through explicit relationships and purchase orders.

Main journey:

```text
Complete Supplier profile
  → create catalog
  → accept Merchant relationship
  → receive PO
  → confirm quantities / price / ETA
  → prepare / fulfil
  → Merchant records actual receipt
  → Merchant records actual payment
  → Supplier business accounting reflects the result
```

Important boundaries:
- A Merchant cannot silently trust an internet-discovered Supplier; an active Supplier account is invited and the Supplier explicitly accepts.
- Catalog items define pack, base-unit conversion, price, minimum packs, availability and lead time.
- Purchase orders snapshot catalog details so later catalog changes do not rewrite history.
- Supplier can partially accept quantities/prices.
- Merchant receiving records what physically arrived and can leave the PO Partially received.
- Money is recorded as a Supplier payment only when it actually moves.
- Supplier has a separate business-scoped accounting workspace.

### Delivery / Courier

**Purpose:** perform approved last-mile deliveries.

Main journey:

```text
Submit Delivery profile / documents
  → eligibility review
  → approved
  → available
  → assignment
  → pickup
  → active route / location
  → Customer handoff
  → verified completion
```

Important boundaries:
- Approval comes before Availability.
- An expired, suspended or unapproved Courier cannot turn Availability on.
- Merchant requests courier dispatch only after the Customer order is Ready and Paid.
- Delivery price uses a versioned active pricing rule and quote snapshot.
- Current delivery quotes expire after 15 minutes.
- Active live location is part of the delivery workflow, not continuous off-duty tracking.
- Completion requires the Customer handoff code.

### Local Services / Service Provider

**Purpose:** offer skills and manage request → quote → job → verified review workflow.

Main journey:

```text
Application / approved scope
  → public profile and services
  → qualifications / evidence
  → Customer request
  → quote
  → Customer acceptance
  → schedule / work
  → Provider completion
  → Customer confirmation
  → verified review eligibility
```

Public/private boundaries:
- Profile visibility can be Public, Relationships only or Private.
- Public reputation participation is a separate opt-in.
- Private CV/evidence is distinct from the public CV/experience summary.
- Credentials can be Submitted / Verified / Rejected / Expired.
- Job-linked portfolio work is returned publicly only when Customer publication consent is recorded.
- A review is tied to a completed, Customer-confirmed in-app job.

## Shared product layers

### Identity
One account identity can hold multiple profiles. Switching profile changes operational context without signing the user out.

### Business tenancy
Merchant and Supplier accounting resolves to authorized business workspaces. A profile does not automatically grant access to another business ledger.

### Money
Commercial amount, money actually received/paid and outstanding amount are kept separate. This makes partial payment, credit/receivables and Supplier payables visible instead of pretending an unpaid amount was collected.

### Trust and approvals
Operational profiles can be invitation/application governed. Platform approval is not presented as a substitute for legal permits, licences, insurance or government obligations.

### Safety
Incident reports are private operational records separate from public reviews/reputation. Evidence size/type limits are enforced server-side.

## Public Help Center structure

- `/help` — search and public product entry point
- `/help/profile/customer`
- `/help/profile/merchant`
- `/help/profile/supplier`
- `/help/profile/courier`
- `/help/profile/service_provider`
- `/help/article/:slug`
- `/help/error/:code`

The V2 catalog contains more than 60 task-oriented guides and separate workflow diagrams for all five public profiles.

## Contextual help

The application uses stable documentation identifiers such as:

- `ERR-AUTH-001` — sign-in/recovery;
- `ERR-ACC-009` — business workspace access;
- `ERR-ACC-010` — linked transaction correction;
- `ERR-ORD-003` — cash presence gate;
- `ERR-ORD-005` — payment / outstanding balance;
- `ERR-MKT-001` — Merchant marketplace capability/availability;
- `ERR-DEL-004` — expired/missing delivery quote;
- `ERR-DEL-006` — Courier eligibility;
- `ERR-DEL-007` — delivery dispatch readiness/payment gate;
- `ERR-SUP-002` — trusted Supplier relationship;
- `ERR-SUP-003` — Supplier receiving quantity/price problem;
- `ERR-SVC-002` — Local Services approval/credential gate;
- `ERR-SVC-003` — invalid service-job transition;
- `ERR-INC-001` — incident evidence limits.

These identifiers are intended to remain stable even when user-facing copy is translated or improved.

## Visual reference

Figma file: **Business & Life — Public Help Center**

The approved design system now includes:
1. Product architecture
2. Help Center home
3. Article / troubleshooting template
4. Customer catalog
5. Merchant catalog
6. Supplier catalog
7. Delivery catalog
8. Local Services catalog

## Documentation rule for future features

A user-visible feature is not fully documented until the public Help Center explains:
- what it is;
- who can use it;
- prerequisites;
- numbered usage steps;
- what happens next;
- common failure states;
- privacy/money/approval boundaries where relevant;
- the exact Help Center target for recoverable errors.
