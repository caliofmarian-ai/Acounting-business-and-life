---
document_id: BL-00-PLAN-004
title: Philippines Reference Edition — Quality, Onboarding and Country Expansion Plan
document_type: canonical_execution_plan
status: ACTIVE
access_class: INTERNAL
country_code: GLOBAL_CORE_PH_REFERENCE
owner_role: Product Owner
approver_role: Product Owner
version: 1.0
last_updated: 2026-09-20
---

# Philippines Reference Edition — Quality, Onboarding and Country Expansion Plan

## 1. Product decision

The Philippines edition is the first complete reference implementation of Business & Life.
It is not a country-specific fork and must not become one.

The platform will use:

- one shared application and domain core;
- one canonical identity, profile, workspace, order, finance, notification, support and administration model;
- explicit country-edition configuration and jurisdiction adapters;
- separate country data and administrative scopes where required;
- the same behavioral acceptance suite for every edition, plus country-specific compliance tests.

The normal ecosystem logic should be identical across countries. A difference is permitted only
when it is caused by law, regulation, provider capability, language, currency, territory model or
an explicitly approved market rule. Country conditionals must not be scattered through UI and
domain code.

## 2. Reference-edition boundary

| Shared global core | Country-edition adapter or configuration |
| --- | --- |
| Person, account, sessions and security | Registration jurisdiction and required identity claims |
| Public profiles and lifecycle states | Country-specific eligibility and evidence |
| Account Home and profile workspaces | Local language, formats, currency and timezone |
| Marketplace, orders and procurement | Local product restrictions and consumer-law notices |
| Delivery and Local Services orchestration | Territory hierarchy, permits and operating rules |
| Ledgers, allocations and reconciliation | Tax, fiscal documents and statutory reporting |
| Provider-neutral payment intents | Approved local payment providers and payment methods |
| Notifications, support and incidents | Local templates, emergency routes and retention rules |
| Admin assignments, permissions and audit | Country authority, regulator evidence and legal retention |
| Privacy and legal-document versioning | Controller identity, local terms and consent wording |

Every country edition must declare a versioned manifest containing at least:

```text
country code and edition version
supported locales and authoritative legal language
currency, timezone and number/date/address formats
territory hierarchy
profile availability and onboarding requirements
identity/compliance evidence requirements
tax and fiscal-document adapter
payment-provider adapter and enabled methods
legal documents, privacy controller and retention policy
support, incident and emergency routing
feature flags and rollout state
```

Philippines-specific rules belong in the `PH` manifest/adapters. The shared core may consume a
country capability, but it must not silently assume `PH`, `PHP`, a Philippine address, PayMongo or
Philippine statutory evidence.

## 3. Quality and simplicity contract

### 3.1 Ordinary users

- One clear primary action per screen.
- Ask only for data required for the current action; use progressive disclosure for everything else.
- Show only navigation and tools relevant to the active profile.
- Use plain human language. Provider names, raw states, request IDs and internal errors stay out of
  normal user surfaces.
- Every screen has deliberate loading, empty, success, recoverable-error and blocked states.
- Back, refresh, expired-session and interrupted-onboarding behavior must be safe on Android.
- A company-managed test account is visibly identified as test data and is never forced to invent a
  personal phone or home address. Where an address is operationally necessary, use the controlled
  company address or an approved synthetic test fixture.
- Destructive or monetary actions always show the consequence before confirmation.

### 3.2 Administrators

- The default Admin view is a concise operational summary, not a raw log stream.
- Work is organized into actionable exception queues: owner, priority, age, next action and SLA.
- Repeated classification, routing, reminders and report aggregation should be automated.
- Detailed evidence and immutable audit history remain one level deeper for investigation.
- The interface must distinguish facts, warnings, blockers and recommendations.
- Every privileged action records actor, scope, reason, before/after state and outcome.
- No Admin page may imply authority outside the active assignment and territory.

### 3.3 Release-quality gates

- No known P0 or P1 defect may enter a controlled pilot.
- All affected automated tests, static checks and database invariants pass.
- The primary content of a role screen is usable within 2.5 seconds at p95 under the agreed
  production-like low-end Android profile.
- Simple read endpoints target p95 below 1 second; bootstrap endpoints must remain below 2.5 seconds.
- No hidden periodic polling outside a visible real-time operational screen.
- No duplicate ownership of the same business fact across services.
- Every release is traceable: issue -> implementation -> test -> deployment -> production evidence.
- The project assistant/orchestrator owns routine acceptance: automated checks, browser journeys,
  Android-focused UX review, authorization negatives, database invariants, email routing, logs and
  production evidence. The Product Owner may add experiential feedback but is not the primary tester.

"Bug-free" is treated as a release discipline: zero known release-blocking defects, prevention by
invariants and tests, and fast detection/recovery for defects that appear in real use. It is not a
claim that software can never fail.

### 3.4 Verification ownership

The project assistant/orchestrator is responsible for discovering, reproducing, explaining,
prioritizing and verifying defects. The Product Owner is not expected to translate an impression
such as “this feels confusing” into a technical specification. The assistant converts that feedback
into a reproducible issue, an acceptance criterion and the smallest coherent shared-core fix.

Every completed slice must be checked through the applicable evidence layers:

1. code review, static checks and automated regression tests;
2. direct browser journeys and Android-focused layout/navigation inspection;
3. positive and negative authorization checks for the affected role;
4. database invariants and audit evidence;
5. Gmail/provider delivery evidence when communication is involved;
6. exact deployed revision, production health, logs and latency sample;
7. a simplicity review: necessary fields only, one clear next action and advanced detail disclosed
   only when requested.

The Owner retains authority over subjective product direction, pricing, legal identity, live-money
activation and other material business decisions. That authority must not be converted into a duty
to perform routine QA or diagnose technical defects. Owner feedback can reopen any accepted slice.

### 3.5 Tool and incremental-cost boundary

- All plugins, connectors and paid subscriptions already connected to the project — including Figma
  and Canva — are available and should be used whenever they materially improve the result.
- Choose the existing tool that produces the strongest evidence or design quality with the least
  duplication; existing paid tools must not be avoided merely because they are paid.
- Do not install, connect, subscribe to or activate a new plugin, service, API or infrastructure
  resource unless it is strictly necessary, adds clear value and the Owner explicitly approves any
  additional cost.
- Existing design tools support the GitHub-canonical product; they do not become separate application
  authorities or parallel applications.

## 4. Verified baseline — 2026-09-20

### 4.1 Production and repository

- GitHub `main` is canonical; production is deployed from the merged repository revision.
- Production health and database connectivity are healthy at the audited revision.
- The complete local automated suite passes: 627 tests.
- There are 74 open issues and no open pull request at the start of this reconciliation.
- The open issues have no workflow labels, and several describe behavior already substantially
  implemented. Issue state is therefore not a reliable implementation inventory yet.
- `docs/CURRENT_STATE.md` predates several merged reconciliation slices and requires refresh.

### 4.2 Gmail routing

- All 22 required Gmail labels exist: 13 Company Admin and 9 Test Roles.
- All 22 routing-test messages have the exact expected label.
- The Customer verification message was delivered to
  `dropi.deliveries+testcustomer@gmail.com`, remains in Inbox and has the Customer test label.
- The routing automation is operational and did not change read state or archive/delete messages.

### 4.3 Test identities

The Gmail aliases are ready, but a Gmail alias is not the same thing as an application account.
Database reconciliation found:

| Expected test role | Alias | Application account |
| --- | --- | --- |
| Customer | `dropi.deliveries+testcustomer@gmail.com` | Present; verified; company-managed test account |
| Merchant | `dropi.deliveries+testmerchant@gmail.com` | Missing |
| Supplier | `dropi.deliveries+testsupplier@gmail.com` | Missing |
| Courier Delivery | `dropi.deliveries+testcourier@gmail.com` | Missing |
| Service Provider | `dropi.deliveries+testservice@gmail.com` | Missing |
| Country Admin | `dropi.deliveries+testcountryadmin@gmail.com` | Missing |
| Territory Admin | `dropi.deliveries+testterritoryadmin@gmail.com` | Missing |
| Specialist Admin | `dropi.deliveries+testspecialist@gmail.com` | Missing |
| Super Admin | `dropi.deliveries+testsuperadmin@gmail.com` | Missing |

The missing accounts must be provisioned through a controlled QA path that exercises real
registration/invitation and authorization rules. Production authentication must not gain a hidden
back door. Secrets must not be stored in GitHub, logs or chat.

### 4.4 Current high-priority findings

| Priority | Finding | Consequence | Required action |
| --- | --- | --- | --- |
| P1 | Four disabled profiles on the Owner account still report `status=active` | Confusing UI and invalid state invariant | Normalize data and enforce `enabled=false => status!=active` |
| P1 | Owner Super Admin email is not recorded as verified | Security/readiness gate remains incomplete | Complete the normal verification path and preserve audit evidence |
| P1 | Eight of nine expected test-role application accounts are absent | Role onboarding cannot be accepted end to end | Add controlled provisioning and role-by-role fixtures |
| P1 | Several frequently used endpoints take about 1.3–3.1 seconds in the audited production sample | Slow and confusing on low-end Android | Profile queries, remove duplicate calls and apply budgets |
| P1 | The chained gateway runtime remains the production architecture | Latency, duplicated schema ownership and difficult diagnosis | Execute Issue #251 runtime consolidation |
| P1 | Current-state documentation and the open-issue ledger are stale | Work can be repeated or incorrectly considered complete | Reconcile evidence and label/close only after acceptance |
| P2 | PayMongo `service_job` source is intentionally fail-closed | Local Services cannot complete online checkout | Implement only after accounting and settlement ownership is accepted |
| P2 | Courier compensation and Service Provider settlement remain unconfigured | Revenue is visible but payee earnings are not authoritative | Approve and implement allocation policies before live money |

Audited production response samples that require performance work include session bootstrap,
governance state, territories, notifications and service categories. The sample is diagnostic, not
a formal load test; the release gate requires repeatable production-like measurements.

## 5. Controlled role-onboarding programme

### Wave 0 — make testing trustworthy

1. Correct state invariants and add regression coverage.
2. Refresh canonical current-state documentation and issue classification.
3. Restore a safe preview/review surface and a controlled test-account provisioning method.
4. Create all missing company-managed test accounts through real lifecycle paths.
5. Establish low-end Android performance traces and budgets.
6. Ensure test records, notifications, payments and documents are unmistakably synthetic.

### Wave 1 — Customer

Use the existing verified Customer test identity. Complete registration recovery, Account Home,
Customer activation, marketplace discovery, cart, order, address handling, delivery choice,
notifications, finance/history, support, privacy, logout and re-login. Record every unnecessary
field, unclear label, dead end, duplicate action and slow transition.

### Wave 2 — Merchant

Provision and verify the Merchant identity, complete business onboarding, location, catalog/menu,
inventory, pricing, incoming order, fulfilment, finance, reporting, settings and support.

### Wave 3 — Supplier

Provision and verify Supplier onboarding, authorization, catalog, Merchant relationship, purchase
order, fulfilment, receiving, receivable/payment attribution, finance and settings.

### Wave 4 — Courier Delivery

Provision and verify eligibility, vehicle/mode, territory, availability, dispatch, acceptance,
location consent, pickup, proof of handoff, incident flow and earnings boundary.

### Wave 5 — Service Provider

Provision and verify presentation, category, service area, credentials, discovery, booking/job,
evidence, review eligibility, cancellation, payment boundary and privacy.

### Waves 6–9 — delegated administration

Test in increasing authority order:

1. Specialist Admin;
2. Territory Admin;
3. Country Admin;
4. Super Admin.

Each Admin test must prove both allowed actions and denied out-of-scope actions. Super Admin is not
used as a shortcut to make narrower assignments pass.

### Cross-role ecosystem journeys

After individual onboarding passes, run the connected economic journeys:

- Customer -> Merchant order -> Courier delivery -> payment/document/refund/reconciliation;
- Merchant -> Supplier purchase order -> receipt -> payable/settlement/reconciliation;
- Customer -> Service Provider job -> evidence/review -> payment/settlement;
- user/support incident -> Territory/Country escalation -> resolution -> immutable audit;
- legal-document version change -> affected-role re-consent -> evidence and reporting.

## 6. Acceptance matrix used for every role

| Area | Required evidence |
| --- | --- |
| Identity | registration/invitation, verification, session expiry, reset, logout, re-login |
| Entry | correct Account Home and no accidental switch to an already-open account |
| Navigation | only permitted profile/Admin surfaces; Android Back is predictable |
| Onboarding | required-only fields, save/resume, validation, rejection and recovery |
| Authorization | positive actions plus direct-URL/API negative tests |
| Core work | one complete realistic role journey and its resulting state |
| Money | ownership, allocations, documents, idempotency and failure behavior |
| Notifications | recipient, wording, deep link, preference and retry behavior |
| Support/safety | ticket or incident path, evidence privacy and escalation |
| Settings | Account versus profile versus Admin scope is unambiguous |
| Accessibility | labels, focus, contrast, touch targets and keyboard behavior |
| Performance | low-end Android trace, request count, p95 and retry/offline behavior |
| Audit | actor, scope, reason, before/after state, result and correlation ID |

A role is not complete because a screen exists. It is complete only when the assistant has captured
the end-to-end evidence, fixed the blocking defects, protected the result with automated coverage
and passed the Android-focused acceptance matrix. Owner feedback remains able to reopen the result.

## 7. Open-issue reconciliation

These classifications are evidence-led working states, not automatic issue closures. An issue moves
to Done only after its issue-specific acceptance criteria are checked against the current build.

### Acceptance required — implementation substantially exists

| Issues | Reconciliation action |
| --- | --- |
| #3, #5, #6, #7, #8 | Verify accounting, orders, Supplier and Marketplace journeys against current runtime |
| #12, #14, #15 | Verify Local Services, unified shell and Service Provider onboarding on Android |
| #28, #29, #30 | Verify multi-business accounting, Admin dashboard and governed profile lifecycle |
| #33, #53 | Verify notification delivery/failure behavior and public documentation accuracy |
| #57, #59, #61, #64 | Verify governance, roles and PH compliance document evidence |
| #68, #70, #72, #75, #80 | Review form/SOP/pitch/agreement/training artifacts against the live product |
| #103, #117, #120, #136, #150 | Re-run mobile, KPI, Android and Owner-audit acceptance on the current revision |
| #164, #165 | Simplify and accept profile finance and settings rather than only checking route presence |
| #176, #181, #210, #219 | Verify Supplier, Customer, Local Services and Admin finance attribution |
| #230, #239 | Verify commission-planner and delivery-pricing evidence without inventing policy |

### Partial — foundation exists but the outcome is not complete

| Issue | Remaining boundary |
| --- | --- |
| #9 | Delivery runtime exists; orchestration acceptance and policy ownership remain |
| #13 | PH exists, but the versioned country manifest/adapter boundary must be completed |
| #23 | Auth foundation exists; Owner verification, migration gates and optional Google path remain |
| #24, #25 | Admin hierarchy exists; multi-country scope and full UI localization remain |
| #31, #32 | Compliance/document foundations exist; statutory PH decisions and evidence remain |
| #34, #35, #36, #37 | Payments/legal/production foundations exist; live pilot gates remain open |
| #45, #49 | Growth/analytics foundations remain fail-closed pending approved activation and privacy |
| #169 | Profile Finance V2 foundation exists; real payout/settlement authority remains |
| #178, #180, #186 | Local Services/Courier finance exists without final compensation/settlement policy |
| #185, #187, #211 | `service_job` PayMongo dispatch remains intentionally unsupported |
| #200 | Internal safe-token registry exists; provider-vault capability is not yet proven |
| #203 | Growth activation needs current production, consent and analytics evidence |
| #232, #234, #236 | Monetization planners exist; approved policy, billing and incentive operation remain |
| #250 | Resend is configured; PayMongo/OpenAI production-readiness evidence remains |
| #251 | Runtime consolidation remains a current architecture and performance blocker |

### Not started as an accepted product capability

| Issues | Boundary |
| --- | --- |
| #11 | Shopify Platform Store |
| #16 | Price comparison |
| #85 | Private document portal runtime |
| #166, #170 | AI photo/catalog assistant |

### Explicit hold or future scope

| Issue | Reason |
| --- | --- |
| #86 | Standalone external courier booking follows core delivery acceptance |
| #156 | Community/volunteering/donations is intentionally future research |
| #183 | Live money movement depends on provider/commercial and payout decisions |
| #188 | Crypto remains optional, regulated-provider-dependent future scope |
| #190 | First live PayMongo pilot remains HOLD until all evidence gates pass |
| #198 | PayMongo platform/linked-account capability requires provider confirmation |
| #228 | Privacy-controller allocation needs an authoritative legal/entity decision |

## 8. Execution rhythm

Each wave uses the same controlled loop:

1. **Observe:** reproduce against the current merged revision and capture facts.
2. **Reconcile:** compare issue, code, database, Gmail, provider and production evidence.
3. **Design:** choose the smallest shared-core fix; add a country adapter only for a real country fact.
4. **Implement:** one coherent branch and pull request, with migration/rollback notes where relevant.
5. **Verify:** automated tests, preview E2E, authorization negatives, database invariants and logs.
6. **Deploy:** merge canonical GitHub code, deploy the exact revision and run production smoke checks.
7. **Accept:** the assistant verifies the completed live and Android-focused flow; the Owner receives
   the result for optional experiential feedback and material product decisions.
8. **Close:** update documentation and the linked issues with exact evidence.

Work-in-progress limits:

- one architecture/infrastructure blocker at a time;
- one role-onboarding wave at a time;
- one cross-role economic journey at a time;
- external-provider HOLD work does not block local quality and simplification work.

## 9. Immediate action order

1. Merge this plan and make it the reconciliation authority linked from current-state docs.
2. Fix the disabled-profile status invariant and verify the production data correction.
3. Complete Owner email verification through the normal audited path.
4. Restore safe preview E2E and provision the eight missing company test identities.
5. Finish Customer onboarding end to end and eliminate its P0/P1 defects.
6. Address bootstrap/notification/governance latency and begin Issue #251 consolidation.
7. Continue Merchant -> Supplier -> Courier -> Service Provider -> delegated Admin roles.
8. Run the cross-role journeys, then reconcile and close only issues with complete evidence.
9. Extract the validated `PH` country manifest as the template for the second country edition.
