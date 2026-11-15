# QA PH Restaurant — Bacoor V1 · English (Philippines)

**State:** documentation + deterministic fixture + calculation tests ONLY; **not seeded**, not published, not a live merchant. Issue #853.

Owner-approved restaurant scenario in Bacoor, Cavite, Philippines; locale `en-PH`, currency PHP. This is the restaurant among four later test merchants (street-food vendor, sari-sari store, restaurant, wet-market vendor). Keep this restaurant isolated from the existing **Business & Life QA Fish Kitchen** and **QA COUNTER ORDERS V1 A/B** records; never rename or repurpose their accounts or history.

## Simulated four-portion recipes and food costs

All figures are **invented QA costing assumptions, NOT supplier quotations, current Bacoor market prices or verified retail prices**. Ingredients and recipe preparation steps are recorded in `qa/fixtures/ph-restaurant-bacoor-v1.json`. `computeRecipeBatch` produces the cost from the base inventory unit prices and recipe quantities. Selling prices are likewise invented for testing.

| Menu item | Four-portion batch ingredient cost | Ingredient cost / portion | Simulated selling price / portion | Difference / portion, before overhead |
|---|---:|---:|---:|---:|
| Chicken Adobo | ₱284.25 | ₱71.06 | ₱145.00 | ₱73.94 |
| Pork Sinigang | ₱348.00 | ₱87.00 | ₱175.00 | ₱88.00 |
| Beef Caldereta | ₱547.60 | ₱136.90 | ₱245.00 | ₱108.10 |
| Chicken Tinola | ₱324.10 | ₱81.03 | ₱155.00 | ₱73.97 |
| Pancit Bihon | ₱274.65 | ₱68.66 | ₱145.00 | ₱76.34 |
| Pork Menudo | ₱395.70 | ₱98.93 | ₱185.00 | ₱86.07 |
| Ginisang Monggo | ₱200.05 | ₱50.01 | ₱115.00 | ₱64.99 |
| Bicol Express | ₱384.20 | ₱96.05 | ₱185.00 | ₱88.95 |
| Tortang Talong | ₱190.29 | ₱47.57 | ₱100.00 | ₱52.43 |
| Chicken Inasal | ₱345.15 | ₱86.29 | ₱185.00 | ₱98.71 |

The difference is **not net profit**: it excludes labour, rent, energy, packaging, tax, spoilage, delivery, payment costs and other business expenses. All quantities are test inventory amounts, not actual stock on hand.

## Example ingredient-level breakdowns

### Chicken Adobo — one four-portion batch

| Ingredient | Batch quantity | Synthetic ingredient cost |
|---|---:|---:|
| Chicken meat | 900 g | ₱216.00 |
| Soy sauce | 100 ml | ₱10.00 |
| Cane vinegar | 80 ml | ₱4.80 |
| Garlic | 40 g | ₱8.80 |
| Onions | 100 g | ₱12.00 |
| Black pepper | 5 g | ₱9.00 |
| Bay leaves | 2 unit | ₱5.00 |
| Cooking oil | 25 ml | ₱3.25 |
| Water | 250 ml | ₱0.00 |
| Uncooked rice | 280 g | ₱15.40 |

**Batch:** ₱284.25 · **Per portion:** ₱71.06 · **Synthetic selling price:** ₱145.00.

### Tortang Talong — one four-portion batch

| Ingredient | Batch quantity | Synthetic ingredient cost |
|---|---:|---:|
| Eggplant | 850 g | ₱72.25 |
| Eggs | 8 unit | ₱72.00 |
| Onions | 100 g | ₱12.00 |
| Garlic | 20 g | ₱4.40 |
| Cooking oil | 80 ml | ₱10.40 |
| Salt | 8 g | ₱0.24 |
| Black pepper | 2 g | ₱3.60 |
| Uncooked rice | 280 g | ₱15.40 |

**Batch:** ₱190.29 · **Per portion:** ₱47.57 · **Synthetic selling price:** ₱100.00.


## Test and future seed contract

- Fixture key: `qa-ph-restaurant-bacoor`. Exact business name: `QA PH Restaurant — Bacoor`. Role `merchant`; domain `food`; city PSGC `0402103000`, barangay PSGC `0402103028` (Queens Row West). **No fabricated street address, GPS pin, private persons or evidence documents.**
- Draft storefront only. No public Marketplace listings, delivery activation, online/cash settlement, account or business approval, customer contact, notifications or public reputation. All dishes retain `allergenReviewRequired: true`; verify ingredient labels, allergen evidence and food-safety requirements before any real commerce.
- A future **separately authorized isolated QA seeder** must validate the exact environment/DB and `company_test` Merchant identity, look up business by a stable fixture key/approved mapping, then create **once** or perform explicit safe reconciliation. Never generate a new business for each test run, never reuse `QA Fish Kitchen` merely by matching the name, and never use a random marker as a business identity.
- Prior to any writes: read existing business memberships/bindings and snapshot, check for name/key collisions, enforce authorized business context for every product/inventory write, ensure inventory unit classification, and obtain owner-approved dry-run evidence. Avoid wholesale overwrites of stock values or prices on an existing business. Preserve all prior Orders/payments/stock/audit history.
- Canonical arithmetic is validated by `node --test tests/qa-ph-restaurant-bacoor-853.test.js`, including inventory capacity for one four-serving batch of every menu item. This is a **pure calculation test**: it does not start servers, connect to Postgres, create entities, call payment providers or modify Railway.
- After CI, arrange an isolated QA seed and manual Android Preview acceptance only when Preview reservation is free. Never claim the restaurant is visible on `caliof.com` from this branch. Production requires the Owner's explicit production acceptance.

## Example tests to do after safe QA activation

1. Switch from restaurant to a different test business and back; verify Orders, Catalog, Stock and Money are strictly business-scoped and do not retain stale responses.
2. View all ten food product drafts and ingredient quantities, validate recipe and stock low-level alerts; verify no published listings exist.
3. Use synthetic test data to simulate one order, ingredient reservation/consumption, cancellation/stock restore and receivable behavior **only** within isolated QA; verify no real payments or production changes.
4. Test mobile phone portrait/Back navigation, loading/error/retry, and draft Storefront status before allowing any future release.
