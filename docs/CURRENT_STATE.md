# Business & Life — Current State

This file is the compact handoff checkpoint for fresh agents. GitHub `main` remains the source of truth; this document summarizes the executable state and the next implementation boundary.

## Product scope

Business & Life is the Philippines Edition of a local economic ecosystem. One human account can participate through separate profiles while private and financial data remain scoped to the correct profile/business/territory.

Current profile capabilities:
- Customer
- Merchant
- Supplier
- Courier / Delivery Provider
- Service Provider / Local Services

Privileged administration is not a normal public profile.

## Executable baseline entering V0.8.7

The baseline before this stabilization slice is V0.8.6, merged on `main` at `187b837f7922c1d71dc13abf00757fce4504f356`.

The production-facing runtime chain is:

`Accounting -> Account/Auth -> Orders -> Marketplace -> Local Services -> Suppliers -> Delivery -> Delivery Finance -> Incidents -> Auth Hardening -> Profile Governance`

The public entry process is `server-profile-governance.js`.

## Implemented product lanes

- business cash control, remittances, reconciliation and audit corrections;
- inventory, menu products, recipes, stock consumption and product profitability;
- one account with multiple profiles and a unified mobile/PWA shell;
- individual email/password accounts and revocable sessions;
- password-reset/email-verification foundation and optional Google identity adapter;
- Customer multi-item orders, preparation states, cash presence gating, credit/receivables and tracker;
- multi-Merchant Marketplace storefronts, Food/Non-food discovery, basket and checkout;
- Local Services provider profiles, credentials/CV evidence, jobs and verified-review eligibility;
- trusted Merchant-Supplier relationships, Supplier catalog, purchase orders, ETA, receiving and procurement payments;
- Courier eligibility, versioned delivery pricing, dispatch, live delivery tracking, handoff code and delivery-fee accounting separation;
- private incident reporting with protected evidence and bootstrap Admin triage;
- invite-only Merchant/Supplier/Courier governance, Service Provider applications, territory-scoped approval and suspension.

## Important production boundaries still open

### Multi-business accounting — Issue #28
The legacy V0.2/V0.3 accounting tables are not yet fully tenant-scoped. New Merchant accounts are intentionally blocked from the original ledger until every financial/inventory/report operation resolves to an authorized business/economic workspace. Supplier Accounting must use the same engine rather than a cloned ledger.

### Scoped administration — Issues #24 and #29
V0.8.6 uses account 1 as a temporary bootstrap Super Admin. Final authority must become explicit Super Admin / Country Admin / Territory Admin assignments with scoped permissions and audit history.

### Notifications — Issue #33
The platform still needs one canonical in-app/email/push notification layer shared by auth, orders, procurement, delivery, services, support and governance.

### Legal / payments / production readiness
- Issue #35: versioned Terms, privacy notices and role agreements;
- Issue #34: real Philippine payment-provider intents, allocations, settlements and reconciliation;
- Issue #36: backups, restore proof, staging, monitoring, private object storage and disaster-recovery release gates.

## Canonical roadmap

Issue #37 — `PH PILOT ROADMAP — Minimum launch gates and post-pilot expansion order` — is the current delivery roadmap.

V0.8.5 executed the first authentication-hardening slice from that roadmap.
V0.8.6 executed the first invitation/profile-governance slice.

The next major implementation boundary is **Issue #28 — Multi-business Accounting**.

Recommended continuation order after V0.8.7 stabilization:
1. Issue #28 — multi-business Accounting for Merchant + Supplier;
2. Issues #24/#29 — scoped Admin RBAC and support/admin operations;
3. Issue #33 — notifications;
4. Issue #35 — versioned legal acceptance;
5. Issue #34 — real payment provider, fee allocation and reconciliation;
6. end-to-end commerce revalidation;
7. Issue #36 — production-readiness gate;
8. controlled Philippines pilot in one explicitly configured operating territory.

## Country and commerce separation

- Current country edition is Philippines (`PH`, `PHP`, `Asia/Manila`).
- Country edition is a deployment/data boundary, not a user-selectable country switch.
- Merchant Marketplace storefronts, Supplier B2B catalogs and the future Philippines Shopify Platform Store are separate commerce domains.
- No other DROPi/Shopify/Ireland catalog is authority for this application's marketplace or Platform Store.

## Validation rule

Every implementation slice should be accepted only after:
- exact branch/head CI passes;
- database migrations are backward compatible;
- isolated Railway preview is healthy;
- `/health` passes;
- the preview URL is delivered to the Project Owner for Android inspection before/around promotion according to the active workflow.
