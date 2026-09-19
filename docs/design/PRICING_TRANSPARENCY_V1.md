# Pricing Transparency V1

Status: **OWNER APPROVED / IMPLEMENTATION IN REVIEW**

Canonical issue: #245.

## Product message

> **Low, transparent platform fee — 0.50%.**
> Business & Life is designed to be sustainable, not extractive.

This message is a verifiable pricing principle, not a comparison attack against other platforms.

## Canonical fee boundary

### Customer
- Business & Life Customer platform fee: 0%.

### Merchant
- Business & Life transaction fee during 90-day promo: 0%;
- Owner-approved post-promo rate: 0.50% of eligible transaction;
- monthly subscription: **₱99/month after promo**; live billing activation remains gated.

### Supplier
- Business & Life transaction fee during 90-day promo: 0%;
- Owner-approved post-promo rate: 0.50% of eligible B2B transaction;
- monthly subscription: **₱99/month after promo**; live billing activation remains gated.

### Local Services
- Business & Life transaction fee during 90-day promo: 0%;
- Owner-approved post-promo rate: 0.50% of eligible completed job/transaction;
- monthly subscription: **₱99/month after promo**; live billing activation remains gated.

### Delivery / Courier
- no monthly subscription;
- first 30 days: 0% Business & Life production fee;
- after promo: 10% of verified delivery price.

## Third-party payment processing

Business & Life promotion does **not** waive third-party processor fees.

PayMongo benchmark values come from the versioned runtime registry in `digital-payment-incentive-core.js` and are exposed through `GET /api/public/pricing`.

Public UI must:
- display benchmark date;
- state that published PayMongo fees exclude VAT when applicable;
- state that actual provider evidence overrides the benchmark;
- never relabel processor fees as Business & Life fees.

## UI surfaces

The shared `public/pricing-transparency.js` component powers:
- Guest / Pricing & Benefits;
- unauthenticated/public pricing surfaces;
- Merchant storefront settings;
- Customer checkout;
- Supplier workspaces;
- Local Services public/provider workspaces;
- profile Money/Banking settings;
- Payment Center;
- public referral landing pages.

## Figma source

Figma file:
`sRwVQFpQchn9kv72vOoUbg`

Page:
`Pricing Transparency V1`

Frames:
- Android / Guest Pricing & Benefits — `15:54`
- Role Fee Disclosure / Compact — `15:85`
- Checkout / Fee Transparency — `15:92`

The Figma treatment uses the same current Business & Life visual direction as the runtime implementation.

## Copy guardrails

Do not use:
- “90 days completely free”;
- one generic “service fee” that hides multiple owners;
- claims that competitors are greedy or more expensive unless a separately sourced factual comparison is intentionally published.

Prefer:
- “90 days with 0% Business & Life transaction fee”;
- “third-party payment-processing charges may still apply”;
- “every fee has an owner, a reason and a separate line”.

## Activation boundary

Owner approval of **₱99/month + 0.50%** establishes the canonical post-promo commercial target for Merchant, Supplier and Local Services.

Live collection remains HOLD until:
- active versioned fee policy exists;
- promo entitlement is enforced;
- PayMongo/provider routing is verified;
- accounting and settlement reconcile;
- affected users receive accurate disclosure;
- Philippines legal/tax readiness is reviewed.
