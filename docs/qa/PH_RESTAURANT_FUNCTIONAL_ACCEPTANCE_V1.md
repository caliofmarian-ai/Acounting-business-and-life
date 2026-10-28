# QA PH Restaurant — functional acceptance checklist (Owner priority, 2026-10-28)

The Owner explicitly prioritizes **whether Business & Life works**, not calibrating food prices. Treat the 10 dishes and their synthetic PHP values solely as QA input. Restaurant business: **QA PH Restaurant — Bacoor**, locale **English (Philippines)**.

## Current verified gates

- V1A recipe fixture and canonical per-serving calculation: **PASS** on [PR #854](https://github.com/caliofmarian-ai/Acounting-business-and-life/pull/854) exact-head CI.
- New functional-model tests in `tests/qa-ph-restaurant-operational-853.test.js`: Merchant Today Food presentation, draft Catalog visibility, ten recipe ingredient demands, stock reservation/shortage, synthetic cancellation/release, per-business isolation model, and zero real-payment flags. These are **module-level simulations, not authenticated browser or database E2E**.
- Preview is still running the serialized [Orders #820](https://github.com/caliofmarian-ai/Acounting-business-and-life/pull/820) candidate, not the restaurant seeder. No actual QA restaurant/business record has been created yet; **in-app visibility remains NOT VERIFIED**.

## Required real in-app acceptance — do not mark complete from Node tests

- [ ] **Merchant business selection** — `QA PH Restaurant — Bacoor` appears once in `Current business` for the authorized company-test Merchant only; switching away/back never changes any other business.
- [ ] **Today** — correct restaurant name, Food tools and dashboard; no stale cards from an earlier business and no duplicate navigation.
- [ ] **Storefront** — restaurant is private/draft, not publicly discoverable to Guest or Customer; no live ordering/payment/delivery activation.
- [ ] **Catalog** — ten English Filipino menu dishes visible in Merchant private Catalog, with a clear Edit / unavailable / recipe path; no duplicates across repeated seed.
- [ ] **Recipes** — editing and viewing quantities works, stock-linked ingredients are bound exclusively to restaurant, recipe details load with no blank screen.
- [ ] **Inventory** — 37 ingredients available, low-stock and unavailable states visible; reserved/usable stock and alert thresholds are computed accurately.
- [ ] **Order lifecycle (test only)** — isolated QA Customer or controlled Counter creates one non-settling test order; Merchant accepts, prepares, marks Ready, cancels another pending order; lists/status/receivables update, no duplicate writes; no real cash or PayMongo.
- [ ] **Stock correctness** — reserving does not consume early, preparation consumes once, cancellation follows canonical restore rules for its status, and failed/insufficient stock cannot create a confirmed order.
- [ ] **Money** — Orders totals are not booked as received cash merely because an order exists; no real payment, payout, invoice or ledger anomaly.
- [ ] **Switching and stale responses** — with a different authorized QA business, old restaurant requests cannot overwrite newer Orders, Today, Catalog or Stock. Preserve the separate Orders #820 acceptance and issue #814.
- [ ] **Android usability** — portrait phone, `Desktop site` OFF, visible buttons, no vertical letter-by-letter card compression, sensible Back, Refresh and retry states. Refs #852.
- [ ] **Rerun/idempotency and isolation** — dedicated QA seeder inserts once, re-run does not add extra businesses/dishes or change existing orders/stocks; unrelated `QA Fish Kitchen` and historical `QA COUNTER ORDERS A/B` remain untouched.

**Result labels:** PASS = observed on a real authenticated QA environment; FAIL = reproducible incorrect behaviour; BLOCKED = safe live test cannot run; NOT RUN = no evidence. The owner will test the application on an Android phone. No production acceptance claims until actual caliof.com confirmation.

## Safety and execution boundary

Restaurant remains a separate company-test business, not a second application. Use existing Merchant profile and official Bacoor PSGC. No real payments, customer identities, public store, external delivery dispatch, approval bypass, or production writes. Do not overwrite shared Railway Preview while Orders #820 is being accepted. A future isolated QA seeder must validate credentials/environment/target account, be idempotent, and avoid changing global selected business or existing historical state.
