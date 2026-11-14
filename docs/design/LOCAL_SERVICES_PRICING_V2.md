# Local Services Pricing V2

Status: implementation candidate for Preview
Tracking: GitHub issue #568
Research checkpoint: 2026-09-27
Currency: PHP

## Outcome

Local Services Pricing V2 replaces a mutable amount/note pair with a versioned commercial agreement. Providers can explain how each service is normally priced, send an itemised quote, and request an approved change when scope changes. Customers approve an exact version and total before that value can become the job's payable commercial amount.

## Pricing model

Each public service offering may describe:

- pricing method: quotation, fixed, hourly, half-day, daily, per unit, per square metre, or inspection then quote;
- rate unit;
- optional guide-price range;
- optional minimum charge;
- optional call-out or inspection fee;
- whether materials are included, separate, customer-supplied, or mixed;
- whether work happens at the customer address, provider workshop, or either;
- a short public pricing note.

These fields are guide information, not a bill. A job amount is established only by an accepted quote.

## Quote contract

A quote is an immutable version with:

- kind and phase (`initial` or `change_order`);
- scope summary;
- labour, materials, call-out, travel and other line items;
- quantity, supported unit, unit price and server-calculated subtotal for each item;
- server-calculated category totals and grand total;
- estimated duration;
- validity deadline;
- inclusions, exclusions and terms;
- creator, timestamps, status and response evidence.

The Customer response targets both the quote identifier and expected version. Database row locks protect quote creation, response and job completion from conflicting concurrent writes.

## Lifecycle

1. Provider sends an initial quote from a requested, reviewing or quoted job.
2. A later initial version supersedes the previous unaccepted version.
3. Customer accepts, declines or requests changes to that exact version.
4. Acceptance stores `accepted_quote_id`, `agreed_total` and `pricing_locked_at` on the job.
5. During accepted, scheduled or in-progress work, Provider may send a complete revised change order.
6. The previous accepted quote remains authoritative while the change is pending.
7. Customer acceptance supersedes the earlier accepted version and replaces the job's agreed-price snapshot.
8. Completion is allowed only at the latest accepted total and only when no change order is pending.

## Server authority and failure boundaries

- Negative, non-finite or excessively large money values are rejected.
- Quantity must be positive and use a supported unit.
- Browser-supplied subtotals or totals must match the server calculation or the request fails.
- Expired and stale quote versions cannot be accepted.
- Provider cannot complete a job without an accepted quote.
- Provider cannot substitute an arbitrary final price; a different amount requires Customer-approved change order.
- Customer requests are restricted to a category actively offered by the selected Provider.
- Legacy accepted jobs are migrated to one marked legacy quote snapshot. Any historical final-price difference is retained separately as `legacy_final_adjustment`; it does not weaken V2 rules for new work.

## Payment authority

- For Pricing V2 work, Payment Core resolves the payable value from the exact `accepted_quote_id` and verifies that the immutable quote total matches `agreed_total`.
- A completed V2 job whose `final_price` differs from that approved snapshot fails closed with `SERVICE_JOB_PRICE_INTEGRITY_MISMATCH`; it cannot open checkout or be confirmed by a payment webhook.
- A migrated legacy job may preserve an historical difference only when its accepted quote is marked `legacy_record` and the difference is recorded in `legacy_final_adjustment`.
- PayMongo checkout, receivable summaries, monetization evidence and Service Provider Money use the same approved-price precedence.
- Customer payment evidence still does not create `service_provider_net`, payout or settlement evidence. Those remain separately governed and unconfigured until an approved settlement policy exists.

## Local market guidance policy

The research checkpoint reviewed Philippine service-platform patterns and CALABARZON wage context. The product intentionally does not publish or enforce a single “Bacoor market rate.” Public guide prices are Provider-authored because scope, trade, materials, access, travel, inspection and warranty terms materially change the retail price.

Any future territory price guide must be:

- evidence-linked and dated;
- versioned by territory and service category;
- shown as optional context, never an automatic mandatory rate;
- clearly separated from employment wage floors;
- activated only after product and policy approval.

## Acceptance evidence

Automated coverage must prove:

- supported methods and units;
- centavo-safe totals;
- forged total rejection;
- expiry and invalid-value rejection;
- immutable schema/routes and exact-version response;
- itemised Provider and Customer UI;
- unapproved final-price increase denial;
- accepted change order becoming the new agreed total;
- normal request → quote → acceptance → active work → completion → Customer confirmation flow.

Release order is branch CI, isolated Railway Preview, preview acceptance, then `main` and production. Production must not be used as the first integration environment.
