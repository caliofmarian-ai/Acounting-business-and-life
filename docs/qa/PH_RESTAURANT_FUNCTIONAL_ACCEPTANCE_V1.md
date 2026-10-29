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

## Read-only provisioning plan (source handoff; not a live seeder)

`qa/restaurant-bacoor-dry-run-853.js` exports `buildRestaurantBacoorDryRunPlan(manifest)`. It validates the 37 synthetic ingredients and 10 recipes and emits **67 non-executable, logical-key templates**: 37 Inventory items, 10 private recipe products, 10 separate draft Marketplace Catalog items and 10 recipe-batch references. The template deliberately contains **null business/account/product/inventory IDs**; no network client, database connection, credential, staff identity, payment method or executable seed loop is present. See `tests/qa-restaurant-dry-run-853.test.js`.

The current scoped application stores are distinct: `server-business-accounting.js` owns `/api/inventory`, `/api/products` and `/api/products/:id/recipe-batch`; `server-marketplace.js` owns private `/api/merchant/storefront/products`. The old unscoped standalone `server-v03.js` / `server.js` route examples must **not** be used as a company-test seeder. **Important idempotency hold:** the current scoped Inventory POST uses `ON CONFLICT(business_id,item) DO UPDATE` and resets stock/cost; replaying the same requests after QA sales is not a safe idempotent seed. A future authorized executor must first resolve and lock the **exact** company-test business and verify existing ingredient/product records read-only; on any drift it must fail instead of silently restoring quantities or changing another business. Create and reconcile the legacy recipe and private Catalog records separately; never infer their IDs from row order.

This plan is **not permission** to seed Preview/Production. Isolated QA provisioning, explicit authorized Merchant/business identity, shared Preview handoff and exact-head authenticated end-to-end acceptance remain unfulfilled. No business/account was created in this slice.
