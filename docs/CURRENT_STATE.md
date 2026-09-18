# Business & Life — Current State

GitHub `main` is the source of truth. This file is the compact fresh-agent handoff for the Philippines Edition.

## Current executable target

- merged baseline before this slice: **V0.9 Multi-business Accounting**;
- current implementation slice: **V0.10 Scoped Admin RBAC + Support Operations**;
- country edition: `PH`;
- currency: `PHP`;
- default business timezone: `Asia/Manila`.

The public runtime chain after V0.10 is:

`Accounting -> Account/Auth -> Orders -> Marketplace -> Local Services -> Suppliers -> Delivery -> Delivery Finance -> Incidents -> Auth Hardening -> Profile Governance -> Multi-business Accounting -> Scoped Admin + Support`

Public entry: `server-admin-operations.js`.

## Public operational profiles

One human account may have:
- Customer;
- Merchant;
- Supplier;
- Courier / Delivery Provider;
- Service Provider / Local Services.

Admin authority is **not** a public profile.

## Implemented product lanes

- cash control, remittances, daily close/reconciliation and correction audit;
- business-scoped inventory, menu, recipes, automatic stock consumption and profitability;
- explicit Merchant/Supplier economic workspaces with per-business ledgers;
- one human identity with multi-profile switching;
- email/password sessions, password recovery/email-verification foundation, optional Google identity adapter;
- multi-item Customer orders, preparation states, receivables/credit and order tracker;
- Merchant Marketplace storefronts and checkout;
- trusted Supplier relationships, catalogs, POs, ETA, receiving and procurement payments;
- Courier/delivery pricing, dispatch, live active-delivery tracking and proof of handoff;
- Local Services profiles, jobs, credentials and verified-review eligibility;
- private Incident reporting and evidence handling;
- invite/application/authorization governance by operating territory;
- explicit Super Admin / Country Admin / Territory Admin assignments and delegated permission grants;
- immutable Admin audit events and scoped Admin queues;
- general Support tickets separate from Incidents;
- Support routing to Support / Territory Admin / Country Admin / Platform Admin;
- Support evidence: up to five images, Word/DOCX, PDF, Markdown/text and audio under enforced limits;
- voice recording + editable live transcript where Web Speech is available;
- optional browser-native translation to English where supported, with editable original/translated text retained.

## V0.9 — completed boundary: Issue #28

Accounting is no longer a single shared legacy ledger:
- legacy rows are backfilled to business 1 without changing monetary history;
- financial/inventory/product/report operations are scoped by `business_id`;
- Merchant and Supplier profiles resolve through explicit profile-to-business bindings;
- Supplier fulfilled revenue/receivables remain separate from actual collected Cash/GCash/Bank;
- Order and procurement money posts to the owning economic workspace.

## V0.10 — current boundary: Issues #24 and #29

Implemented in this slice:
- `platform_admin_assignments`;
- `admin_permission_grants`;
- Super Admin / Country Admin / Territory Admin hierarchy;
- country/territory-scoped permissions;
- signed internal Admin assertions between gateways;
- delegated Admin editor;
- Admin activity/audit events;
- scoped applications/support/incidents/audit views;
- Support ticket lifecycle and escalation to Incidents;
- operational metric snapshots as a reporting layer, not source of truth.

Protected invariant:
- the bootstrap Project Owner remains Super Admin and cannot be removed through normal delegated-admin flows.

## Open production boundaries

### Issue #33 — Notifications — NEXT
One canonical event/notification layer for in-app, email, Web Push and later external transports across:
- auth;
- orders;
- supplier procurement;
- delivery;
- Local Services;
- Support;
- Admin/governance.

### Issue #35 — Legal acceptance
Versioned Terms, Privacy and role-specific agreements/consents.

### Issue #34 — Payments
Real Philippine payment-provider intents/webhooks, allocations, settlements and reconciliation.

### Issue #36 — Production gate
Backups/restore proof, staging, monitoring, private object storage, rate limits and disaster recovery.

## Canonical roadmap

Issue #37 — `PH PILOT ROADMAP — Minimum launch gates and post-pilot expansion order` remains the launch-order authority.

Continuation after V0.10:
1. #33 Notifications;
2. #35 versioned legal acceptance;
3. #34 real payment provider + settlement/reconciliation;
4. end-to-end economic-loop revalidation;
5. #36 production-readiness gate;
6. controlled Philippines pilot in one explicitly configured operating territory.

## Country / commerce separation

- Philippines is its own operational deployment/data plane.
- Future country editions must use isolated deployment/database/configuration.
- Merchant storefronts, Supplier B2B catalogs and the future Philippines Shopify Platform Store are distinct commerce domains.
- GitHub remains canonical for application code/specification.

## Validation rule

Every implementation PR must pass:
- exact-head GitHub Actions CI;
- backward-compatible DB migration;
- isolated Railway preview;
- `/health`;
- Project Owner preview URL for Android inspection.
