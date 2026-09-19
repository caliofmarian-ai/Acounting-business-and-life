# Monetization V2 — Profile Revenue + Shared Company Cost Allocation

Status: **OWNER-APPROVED PRODUCT MODEL / LIVE RATES NOT YET ACTIVATED**

Canonical issue: #232.

## 1. Shared company costs across countries and zones

Business & Life central costs must be allocated fairly to operating scopes.

For each allocation level:

`allocated cost = 50% equal share + 50% activity-weighted share`

### Equal half

50% of the allocable shared cost is divided equally across every participating active country/zone.

This gives every operating scope a baseline responsibility for common infrastructure.

### Activity half

50% is distributed by a versioned activity driver.

Supported drivers may include:

- verified traffic/activity units;
- active members;
- completed economic events;
- gross eligible service value.

Raw unauthenticated page views should not automatically become the financial driver.

### Zero-activity fallback

If every scope has zero activity, the activity half is also divided equally.

This prevents shared company cost from becoming unallocated simply because every market is still new.

### Example

Shared monthly cost: **₱100,000**

Four countries/zones with activity weights:

- A = 50
- B = 30
- C = 20
- D = 0

Equal pool = ₱50,000 → ₱12,500 each.

Activity pool = ₱50,000:

- A = ₱25,000
- B = ₱15,000
- C = ₱10,000
- D = ₱0

Final allocation:

- A = ₱37,500
- B = ₱27,500
- C = ₱22,500
- D = ₱12,500

The new zero-traffic market still pays its baseline common-cost share but does not carry mature-market traffic cost.

## 2. Hierarchical allocation

Recommended global hierarchy:

1. central/platform shared cost → country editions;
2. country-shared cost → territories/zones within that country.

Never allocate the same source cost twice.

Each allocation run must preserve:

- source cost;
- policy version;
- allocation level;
- participating scopes;
- activity driver;
- driver values;
- equal component;
- activity component;
- total allocated amount;
- rounding evidence;
- period;
- audit actor.

## 3. Admin role is not economic ownership

Administrative authority and operating economics are separate.

A Country Admin or Territory Admin does not automatically receive a revenue share.

Only a verified operating entity/contract may receive:

- country operator share;
- territory operator share;
- other contractual operator economics.

A country/territory operator may therefore have:

`accrued operator revenue - direct local costs - allocated shared company cost +/- adjustments = evidenced operator contribution/settlement`

## 4. Profile monetization model

### Customer

- subscription: **FREE**
- platform profile transaction fee: none
- Customer still pays the actual commercial order/delivery/payment amount.

### Merchant

After applicable promotion:

- monthly profile subscription;
- platform fee on each eligible transaction.

### Supplier

After applicable promotion:

- monthly profile subscription;
- platform fee on each eligible B2B transaction.

### Artisan / Local Services Provider

Canonical runtime scope: `local_services`.

After applicable promotion:

- monthly profile subscription;
- platform fee on each eligible completed job/transaction.

### Delivery Provider / Courier

Owner-approved commercial rule:
- no monthly profile subscription;
- **10% production fee**;
- basis: **verified delivery price charged separately to the Customer**;
- 10% applies only after the applicable 90-day promotional entitlement;
- cancelled, failed or otherwise non-eligible delivery activity is not a fee base;
- the fee is not calculated from merchandise/order value;
- post-promo economic split before other legitimate adjustments: **10% Business & Life / 90% Courier gross delivery entitlement**.

The 10% rate is now an Owner-approved policy target, but live collection still requires the later versioned fee-policy activation and settlement evidence.

## 5. Per-profile billing

Subscription belongs to the monetized profile/service scope.

One human account may therefore have:

- free Customer profile;
- paid Merchant profile;
- paid Supplier profile;
- paid Local Services profile;
- Delivery profile with production fee only.

The same login does not collapse the commercial rules of different profiles.

## 6. 90-day promotion

The existing 90-day entitlement remains authoritative.

Default rollout:

- Customer remains free;
- Merchant/Supplier/Local Services subscription and transaction fee remain zero during their eligible promotional period;
- Delivery production fee remains zero during its promotional entitlement unless a later Owner-approved policy explicitly changes this.

Historical transactions are never re-priced.

## 7. Digital-payment incentive

Goal: encourage verified GCash/card/QR/Maya payment without an undocumented Cash penalty.

Preferred design:

- only server-confirmed provider payments qualify;
- Merchant/Supplier/Local Services may earn a **digital payment credit**;
- preferred targets:
  - next subscription invoice;
  - future platform fee;
- credit is capped and funded from an explicit Growth/Finance budget;
- Customer loyalty/voucher rewards may be a separate policy later.

No browser redirect, screenshot or client state creates credit.

## 8. Commission Planner interaction

Commission Planner must consider all platform revenue sources before calculating the remaining transaction fee required.

Monthly platform revenue may include:

- profile subscription revenue;
- Delivery production-fee revenue;
- transaction-fee revenue.

Therefore:

`required transaction-fee revenue = sustainable operating revenue need - subscription revenue - Delivery production-fee revenue`

If this result is below zero, minimum required transaction fee is zero for the modeled scenario.

The planner still remains simulation-only and cannot activate live fees.

## 9. Live activation gates

Before any live amount/rate is activated:

- Owner approves the rate/amount;
- fee/subscription policy is versioned;
- PayMongo/provider routing is verified where online collection is involved;
- 90-day promo boundary is respected;
- affected profiles see transparent pricing;
- accounting and settlement evidence reconcile;
- legal/tax treatment is reviewed for the operating country.

## 10. Current implementation

Implemented:

- `monetization-policy-v2.js`
  - profile monetization matrix;
  - digital payment incentive default;
  - deterministic cent-exact 50/50 allocator;
  - zero-activity fallback;
  - draft monetization policy helper.

- Admin Finance:
  - Profile Monetization card;
  - Shared company cost 50/50 simulator;
  - Commission Planner integration for subscription + Delivery production-fee revenue.

No live subscription price or operator split has been activated. Delivery has an Owner-approved **10% production-fee target on verified delivery price**, but live collection is not activated yet.
