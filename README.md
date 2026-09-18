# Business & Life — Philippines

Business & Life is a mobile-first local economic ecosystem for the Philippines. It began as an accounting/cash-control application for a small fast-food business and now connects five operational profiles under one human account:

- Customer
- Merchant
- Supplier
- Courier / Delivery Provider
- Service Provider / Local Services

The current release target is **V0.10.0**; V0.9 multi-business accounting is already merged into `main`. GitHub `main` is the source of truth and `docs/CURRENT_STATE.md` is the compact fresh-agent handoff.

## What is implemented

### Accounting and stock
- Cash / GCash / Bank / Other balances;
- sales, business expenses, support/remittances and personal withdrawals kept distinct;
- opening cash and end-of-day physical reconciliation;
- inventory, reorder warnings and unit costs;
- products/menu, recipes, automatic ingredient consumption and gross-margin analysis;
- customer receivables and procurement/payment boundaries;
- audit trail for financial corrections.

### Identity and profile system
- one account identity with multiple profiles;
- unified Android/PWA shell, avatar and profile switcher;
- email/password registration and login;
- revocable sessions;
- password-reset and email-verification foundation;
- optional Google OAuth/OpenID Connect adapter when provider credentials are configured;
- Customer self-service registration;
- Merchant, Supplier and Courier invite-only governance;
- Service Provider application and category approval;
- territory-scoped profile authorization and suspension.

### Customer commerce
- Food and Non-food Merchant Marketplace;
- public Merchant storefronts and published products;
- basket and checkout;
- multi-item customer orders;
- separate fulfilment and payment states;
- cash pickup presence gate and Merchant-scoped trusted-returning-customer exception;
- credit/partial payment tracking;
- customer order tracker.

### Suppliers
- trusted Merchant ↔ Supplier relationships;
- Supplier catalog, pack conversion and price snapshots;
- purchase orders, amendments, ETA/readiness and pickup/delivery states;
- partial receiving and idempotent stock increase;
- procurement payment recorded only when money actually moves.

### Delivery
- Courier profile, vehicle/capacity/radius and approval boundary;
- versioned delivery-pricing rules;
- delivery quote snapshots;
- dispatch after paid/ready gates;
- live delivery status/location for the active delivery;
- secure customer handoff code;
- merchandise and delivery money separated in financial allocation records.

### Local Services and safety
- Service Provider public profiles, services, qualifications/CV evidence and portfolio;
- service request → quote → accepted → scheduled/in progress → completed lifecycle;
- verified-review eligibility from completed in-app jobs;
- private incident reporting with evidence limits and bootstrap Admin triage.

## Current architecture

The production-facing gateway chain is:

```text
Accounting
  -> Account/Auth
  -> Orders
  -> Marketplace
  -> Local Services
  -> Suppliers
  -> Delivery
  -> Delivery Finance
  -> Incidents
  -> Auth Hardening
  -> Profile Governance
  -> Multi-business Accounting
  -> Scoped Admin + Support (public entry)
```

The public process is `server-admin-operations.js` and the Railway health check is `/health`.

## Current country edition

This repository currently represents **Business & Life — Philippines**:

- country: `PH`;
- operating currency: `PHP` / `₱`;
- default business timezone: `Asia/Manila`;
- Philippine-local payment/configuration concepts where implemented.

A future Ireland/Romania/other edition must use an isolated deployment/database/configuration rather than mixing jurisdictions into one production data plane.

## Current platform boundaries

**V0.9 Multi-business Accounting is implemented.** Legacy accounting rows are tenant-scoped to the initial business and Merchant/Supplier profiles resolve through explicit economic workspaces.

**V0.10 Scoped Admin + Support is the current release target.** Admin authority is separate from public profiles and uses explicit Super Admin / Country Admin / Territory Admin assignments, delegated permissions, territory scope and audit events. Support is separate from safety Incidents and supports image/PDF/Word/Markdown/audio evidence, editable voice transcripts, and optional browser-assisted English translation.

The next major implementation lane after V0.10 is **Issue #33 — Notifications**.

The canonical delivery order is maintained in **Issue #37 — PH PILOT ROADMAP**.

## Stack

- Node.js 20+ / Express
- PostgreSQL (Neon)
- Progressive Web App / Android-first UI
- Railway deployment
- GitHub Actions CI
- Figma design-system work for application UI
- browser-native speech recognition / translation when supported, with editable fallbacks

## Environment

Core runtime variables include:

- `DATABASE_URL`
- `TOKEN_SECRET`
- `PORT` (Railway)
- `NODE_ENV`

Temporary/bootstrap migration support may still reference `APP_PIN`, but public V0.8.5+ authentication is email/password and the public PIN login route is blocked by the auth-hardening gateway. Email delivery and Google sign-in are enabled only when their provider-specific environment credentials are configured.

Secrets must remain in Railway/provider secret storage and must never be committed to GitHub.

## Development / validation

```bash
npm install
npm test
npm start
```

`npm test` runs syntax validation plus executable architecture/bootstrap tests. Each implementation PR must also pass an isolated Railway preview and `/health` before promotion.

## Accounting and legal boundary

Business & Life is an operational accounting/commerce platform. It does not by itself replace Philippine BIR registration, official invoices/receipts, tax filings, permits, professional licences, insurance, or legal/accounting obligations where those are required. Legal/compliance workflows are versioned separately and must not falsely claim government filing, licensing or approval.
