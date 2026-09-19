# Guest Exploration & Onboarding Architecture

Status: **OWNER APPROVED / architecture boundary for Issue #243**

## Purpose

Business & Life may be entered without registration through **Explore as Guest** so a prospective participant can understand the ecosystem before creating an account.

This feature is an experience layer. It is not a new role, profile, tenant or financial actor.

## Non-negotiable privacy rule

**Private by default, public by explicit choice.**

A public Merchant storefront may expose only information the Merchant intentionally publishes for customer discovery. Publication of a storefront never publishes accounting, financial or internal operational information.

Guest must never receive sales, revenue, profit, transaction history, budgets, balances, withdrawals, accounting reports, internal stock quantities, supplier commercial terms, internal margins, private contact/address data, private documents, Admin data, incident evidence or authorization evidence.

Registration also does not grant access to another participant's private information.

## Identity boundary

Guest is a browser/session experience state only.

Guest mode must not create:
- `accounts` rows;
- `profiles` rows;
- `business_memberships` rows;
- wallets/balances;
- orders;
- payment intents;
- relationships;
- authorization applications;
- Admin or finance records.

Canonical conversion remains:

`Guest -> Registered User -> Email Verified -> Activated Profile`

Only harmless navigation context may survive the Guest -> Registered boundary.

## API boundary

Guest reads use a dedicated namespace:

- `GET /api/public/marketplace/storefronts`
- `GET /api/public/marketplace/storefronts/:businessId`

Rules:

1. Public endpoints are GET/read-only.
2. They use explicit database field allow-lists.
3. Public queries must not use `SELECT *`.
4. Only `merchant_storefronts.publication_status='published'` may be returned.
5. Only products with `published=TRUE AND active=TRUE` may be returned.
6. Existing authenticated Marketplace endpoints remain unchanged for compatibility.
7. Checkout remains authenticated and continues to require a Customer profile.

## Onboarding boundary

Onboarding may:

- explain roles and services;
- highlight the public Marketplace and Help Center;
- explain what registration unlocks;
- direct a user to Sign in / Create account at the moment a protected action is requested.

Onboarding must not:

- decide authorization;
- synthesize financial/business records;
- bypass profile privacy;
- change money/accounting/payment state;
- activate regulated/governed profiles;
- duplicate Finance, Marketplace, Admin or Profile Governance business rules.

Server-side authorization/privacy always wins over onboarding/UI state.

## V1 public experience

Guest can browse public Food and Non-food storefronts and their explicitly published products. Guest can also read the ecosystem guide and privacy explanation.

Protected actions such as ordering route to account creation/sign-in. No guest checkout exists.

## Future extension rule

Local Services, public profiles, community content or other domains may join Guest exploration only after that domain provides its own explicit public projection. Never expose an authenticated/internal object directly and try to hide private fields in the browser.

## Regression contract

Automated tests must fail if:

- a write route appears under `/api/public/`;
- Guest UI calls checkout or private Finance/Admin endpoints;
- public product projection changes to `SELECT *`;
- the Guest UI is coupled to business authorization logic.
