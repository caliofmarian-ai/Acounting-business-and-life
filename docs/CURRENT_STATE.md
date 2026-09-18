# Business & Life — Current State

GitHub `main` is the source of truth. This file is the compact fresh-agent handoff for the Philippines Edition.

## Current executable target

- merged baseline before this slice: **V0.11 Unified Notifications**;
- current implementation slice: **V0.12 Versioned Legal & Consent**;
- country edition: `PH`;
- currency: `PHP`;
- default business timezone: `Asia/Manila`.

The public runtime chain after V0.12 is:

`Accounting -> Account/Auth -> Orders -> Marketplace -> Local Services -> Suppliers -> Delivery -> Delivery Finance -> Incidents -> Auth Hardening -> Profile Governance -> Multi-business Accounting -> Scoped Admin + Support -> Notifications -> Legal & Consent`

Public entry: `server-legal.js`.

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
- optional browser-native translation to English where supported, with editable original/translated text retained;
- canonical notification events/recipients/deliveries/preferences/templates;
- in-app notification inbox with unread state and per-category preferences;
- `en-PH` / `fil-PH` notification locale selection;
- pluggable Resend email and Web Push/PWA channels;
- bounded retry/failure ledger that never rolls back canonical order/payment state.

## V0.9 — completed boundary: Issue #28

Accounting is no longer a single shared legacy ledger:
- legacy rows are backfilled to business 1 without changing monetary history;
- financial/inventory/product/report operations are scoped by `business_id`;
- Merchant and Supplier profiles resolve through explicit profile-to-business bindings;
- Supplier fulfilled revenue/receivables remain separate from actual collected Cash/GCash/Bank;
- Order and procurement money posts to the owning economic workspace.

## V0.10 — completed boundary: Issues #24 and #29

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

## V0.11 — completed boundary: Issue #33

Implemented in this slice:
- `notification_events`, `notification_recipients`, `notification_deliveries`;
- versioned notification templates and per-category preferences;
- in-app notification center and unread state;
- English/Filipino locale handling;
- Web Push subscription/service-worker adapter with optional VAPID configuration;
- shared email delivery ledger, including password reset/email verification with private transient links;
- idempotent event keys and bounded retry/dead-letter states;
- event wiring for Orders, Delivery, Supplier procurement, Local Services, Support, Incidents and Profile Governance;
- privacy filters that exclude tokens, passwords, live coordinates and evidence payloads from notification history.

## V0.12 — current boundary: Issue #35

Implemented in this slice:
- versioned legal-document registry with jurisdiction/locale/version/hash/status;
- exact acceptance evidence per account + role + document version/hash;
- contextual evidence for action, business, Admin assignment and territory;
- minimized HMAC-hashed IP/device metadata rather than raw tracking fields;
- role/action requirements for Customer, Merchant, Supplier, Courier, Service Provider and Admin;
- dedicated location-sharing and marketing-consent purposes rather than one blanket consent;
- re-consent when a reviewed version becomes active;
- authoritative-language fallback and explicit translation-review status;
- Legal & Privacy Center with acceptance history;
- scoped `legal.view` / `legal.manage` Admin governance;
- activation requires recorded legal review metadata; translated copy also requires translation review;
- repository agreements are seeded as controlled drafts only and **do not block users until a legally reviewed version is explicitly activated**.

### Issue #34 — Payments
Real Philippine payment-provider intents/webhooks, allocations, settlements and reconciliation.

### Issue #36 — Production gate
Backups/restore proof, staging, monitoring, private object storage, rate limits and disaster recovery.

## Canonical roadmap

Issue #37 — `PH PILOT ROADMAP — Minimum launch gates and post-pilot expansion order` remains the launch-order authority.

Continuation after V0.12:
1. #34 real payment provider + settlement/reconciliation;
2. end-to-end economic-loop revalidation;
3. #36 production-readiness gate;
4. controlled Philippines pilot in one explicitly configured operating territory.

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
