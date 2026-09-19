---
document_id: BL-00-PLAN-003
title: Application Reconciliation Implementation Plan
document_type: implementation_plan
status: READY_FOR_OWNER_SEQUENCE_APPROVAL
access_class: INTERNAL
owner_role: Product Owner
version: 1.0
last_updated: 2026-09-19
---

# Application Reconciliation Implementation Plan

## 1. Goal and hold point

This plan turns the [Reconciled Application Architecture](../architecture/RECONCILED_APP_ARCHITECTURE.md) into independently reviewable releases.

No phase in this document is implemented merely because this plan is merged. Functional work begins only after the Owner accepts the architecture and implementation sequence.

The migration is incremental: secure the model, introduce the canonical shell, move each capability, verify parity, then retire legacy paths. A full visual rewrite before domain reconciliation is prohibited because it would preserve the current state conflicts behind a new interface.

## 2. Current problems to reconcile

| ID | Problem | Target outcome |
| --- | --- | --- |
| R-01 | Legacy Merchant app remains the runtime base and injects tools over the new Account UI | One canonical shell controls the active surface |
| R-02 | App launch defaults to Merchant through stored/backend role state | Every ordinary launch opens Account Home |
| R-03 | DB, local storage and separate modules disagree about active role/profile | One server-validated navigation state |
| R-04 | Admin entitlement appears late after asynchronous loading | Bootstrap resolves entitlements before interactive switcher |
| R-05 | Profile management labels inactive profiles as active or generally activatable | Explicit lifecycle and policy-specific actions |
| R-06 | Merchant cannot be deactivated because it is treated as required runtime identity | Merchant becomes an optional governed profile |
| R-07 | Account, security, monetization and profile settings share one drawer | Dedicated account/profile/Admin settings routes |
| R-08 | Country code in Personal ID is treated as human country identity | Opaque identity plus separate verified country facts |
| R-09 | Support notifications duplicate and route to Merchant Accounting | Aggregated typed notifications and validated deep links |
| R-10 | Support replies can look like the user's own messages | Immutable actor type and accessible presentation |
| R-11 | Evidence may be embedded as base64 in database records | Private object storage and controlled metadata |
| R-12 | Token storage, dynamic HTML and missing web controls increase security risk | Reviewed session, CSP, encoding, rate limits and audit |
| R-13 | Alternative servers still contain Merchant defaults | One production entry point and regression guards |
| R-14 | Source-regex tests miss real mobile behavior | Domain, integration, mobile E2E, visual and accessibility tests |

## 3. Delivery sequence

### Phase 0 — Freeze, inventory and measurement

Deliverables:

- enumerate runtime entry points, routes, overlays, storage keys and role/profile reads;
- map every Merchant capability to its owner domain and target route;
- record current database schema and safe rollback points;
- add telemetry for launch destination, profile switching, authorization denial and failed deep links;
- define a feature-flag and migration cohort strategy.

Exit criteria:

- no undocumented production entry point;
- no legacy capability lacks a target owner;
- baseline mobile journeys and error rates are measurable.

### Phase 1 — Domain schema and server authorization

Deliverables:

- canonical `persons`, `accounts`, `profiles`, `profile_authorizations`, `workspace_memberships`, `admin_assignments`, `country_claims` and audit-event contracts;
- migration aliases for existing IDs;
- explicit lifecycle states and invariants;
- centralized authorization evaluator;
- single session bootstrap endpoint;
- data migration scripts that are repeatable and idempotent.

Exit criteria:

- new registration creates only Person + Account;
- existing Merchant data remains reachable through mapped profile/workspace IDs;
- Admin cannot be synthesized from profile state;
- rollback and reconciliation reports show zero orphaned records.

### Phase 2 — Canonical AppShell and Account Home

Deliverables:

- one router/store implementing `guest | account | profile | admin`;
- Account Home as default authenticated destination;
- avatar/account switcher based only on bootstrap entitlements;
- bounded loading, errors and retry;
- removal of automatic Merchant toolbar mounting outside Merchant routes;
- Account settings cards/routes.

Exit criteria:

- launch, refresh and back navigation never open Merchant unintentionally;
- a person with no profiles has a complete usable Account Home;
- ordinary users never see Admin;
- no duplicate header, toolbar or conflicting navigation state.

### Phase 3 — Profile lifecycle and onboarding

Deliverables:

- policy-driven profile cards and actions;
- Customer explicit activation;
- Merchant/Supplier/Delivery invitation and governed onboarding;
- Local Services open application and review;
- country/versioned requirement engine;
- private evidence upload service;
- voluntary deactivation, suspension, expiry, renewal and reactivation flows.

Exit criteria:

- no governed profile can self-activate;
- every visible state has one valid next action;
- Merchant can be voluntarily deactivated when blockers are absent;
- IDs/history remain stable through lifecycle changes;
- Philippines requirements are sourced and do not overclaim unverified law.

### Phase 4 — Profile workspaces and scoped settings

Migrate one profile at a time, with Merchant first because it contains the legacy core:

1. Merchant;
2. Customer;
3. Supplier;
4. Delivery;
5. Local Services.

For each profile:

- build a route-owned workspace shell;
- move tools out of global injection;
- add the dedicated Settings card and routes;
- enforce workspace membership and object scope server-side;
- compare functional parity and financial/audit outcomes;
- disable the corresponding legacy mount behind a feature flag.

Exit criteria per profile:

- no data/tool appears in Account Home or another profile;
- mobile navigation, empty/loading/error states and accessibility pass;
- legacy and target reconciliation reports match for critical records;
- rollback remains available until the observation window closes.

### Phase 5 — Delegated Admin Workspace

Deliverables:

- Owner/Super Admin member selection and invitation flow;
- rank, scope, function-bundle, date and status assignment;
- acceptance and step-up authentication;
- function-filtered Admin modules;
- privileged mutation authorization and immutable audit trail;
- Admin-specific settings card/routes.

Exit criteria:

- a new or ordinary user has no Admin navigation or route access;
- an assignment cannot exceed the grantor's delegable authority;
- suspension/revocation removes access immediately;
- every privileged mutation identifies actor, assignment, scope and reason.

### Phase 6 — Notifications and Support reconciliation

Deliverables:

- typed notification schema and per-object aggregation;
- server-resolved deep links;
- support actor attribution and accessible message styling;
- Admin microphone/AI/translation parity with explicit send confirmation;
- contextual help routes and stable error codes.

Exit criteria:

- repeated replies on one ticket update one notification thread;
- opening the notification lands on the exact authorized ticket;
- user and Support messages remain distinguishable without color;
- AI output is editable and never sent automatically.

### Phase 7 — Security, resilience and legacy retirement

Deliverables:

- session-token migration, CSP/security headers, CSRF controls and rate limits;
- removal of unsafe HTML rendering paths;
- sensitive-action step-up authentication;
- deletion/archival plan for alternate servers and legacy state keys;
- production entry-point guardrails;
- final data reconciliation, performance and disaster-recovery exercise.

Exit criteria:

- security review has no unresolved critical/high issue;
- production uses one declared entry point;
- no runtime code reads retired `active_role`/legacy profile keys;
- legacy UI can be removed without capability or record loss.

## 4. Required test matrix

| Layer | Required coverage |
| --- | --- |
| Domain | lifecycle transitions, delegation constraints, country separation, ID invariants |
| Authorization | horizontal/vertical access, cross-profile, cross-workspace, cross-country and revoked access |
| Migration | idempotence, aliases, orphan detection, rollback and financial totals |
| API integration | bootstrap, onboarding, evidence, assignments, notification targets and support actors |
| Mobile E2E | new user, returning multi-profile user, no-profile user, Admin/non-Admin, suspend/reactivate, notification deep link |
| Visual | Android widths, keyboard visibility, overlays, loading states, long translations |
| Accessibility | automated checks plus manual keyboard/screen-reader/state distinction |
| Security | session, CSRF, XSS, object authorization, rate limits, upload abuse and audit redaction |

Source-text assertions may supplement these tests but cannot be the primary proof of behavior.

## 5. Release and reconciliation controls

Each phase uses a separate pull request series and must include:

- schema/API/UI changes kept small enough to review;
- forward migration and rollback/disable method;
- data reconciliation query/report;
- tests and Android evidence;
- affected Help Center and controlled-document updates;
- feature flag/cohort where the risk warrants it;
- Owner-visible acceptance checklist.

Rollout sequence is internal accounts, selected pilot users, percentage cohort, then general availability. Stop the rollout on authorization leakage, financial mismatch, orphaned data, broken account access or unresolvable deep links.

## 6. Definition of complete

Reconciliation is complete only when:

1. Account Home is the stable center of the signed-in experience.
2. All profile tools exist only in their correct workspaces.
3. Profile lifecycle and country requirements are explicit and auditable.
4. Admin is delegated, scoped, revocable and invisible to unauthorized people.
5. Account, profile and Admin settings are separated.
6. Notifications and Support preserve correct target and actor identity.
7. Private documents and sessions meet the target security baseline.
8. Legacy Merchant overlays, entry defaults, duplicated state and alternate production paths are retired.
9. Automated and manual Android acceptance tests pass.
10. Current-state and public-help documentation match deployed behavior.

## 7. First implementation package after approval

The first functional package should combine Phase 0 with the smallest safe portion of Phase 1:

- runtime/state inventory;
- canonical vocabulary and TypeScript/schema contracts;
- session bootstrap read model;
- regression tests proving Account Home defaults and Admin invisibility;
- no destructive data migration and no visual redesign yet.

This establishes the authority and navigation foundation on which all later UI work depends.
