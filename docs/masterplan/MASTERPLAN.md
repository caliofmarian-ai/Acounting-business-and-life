---
document_id: BL-10-GLB-MASTERPLAN-001
title: Business & Life Masterplan
document_type: masterplan
status: DRAFT
access_class: EXECUTIVE_CONFIDENTIAL
applicable_profiles: []
applicable_functions: [Executive, Super Admin, Country Admin, Territory Admin]
country_code: GLB
territory_scope: global
owner_role: Executive
approver_role: Project Owner
version: 1.0
effective_date: null
review_due: null
supersedes: null
legal_classification: OPERATIONAL_INTERPRETATION
source_registry_ids: []
template_id: null
---

# Business & Life — Masterplan

## 1. Executive summary

Business & Life is a mobile-first economic operating system designed to connect local commerce, business accounting, procurement, delivery, skilled local services, controlled profile authorization and private operational support in one coherent platform.

The platform is designed around one human account that can hold several separate profiles:

- Customer;
- Merchant;
- Supplier;
- Delivery Provider / Courier;
- Service Provider / Local Services.

The core business idea is not to force all users into one generic marketplace role. Instead, the platform creates a coordinated local economic network where each participant has a dedicated workspace, permissions and responsibilities, while business financial data remains isolated by economic entity.

The current merged product already includes foundations for:
- multi-profile identity;
- email/password authentication and account recovery;
- governed profile/application concepts;
- multi-business Merchant/Supplier accounting;
- Marketplace storefronts and checkout;
- Customer orders;
- Merchant cash/presence rules;
- Supplier relationships, catalogs and procurement;
- Delivery pricing/dispatch/tracking foundations;
- Local Services profiles, jobs, credentials and reviews;
- private incident reporting;
- public product Help Center.

Several strategic layers remain DESIGN / PLANNED or are in open PRs, including:
- expanded Admin/Support RBAC;
- referral/growth campaigns;
- provider-neutral online payment/settlement engine;
- full compliance center;
- tax/compliance workspaces;
- private governance/documentation portal;
- formal monetization/commission rollout.

## 2. Mission

Enable people and small local businesses to conduct and understand real economic activity with clearer records, explicit responsibilities, better local trust and less fragmentation between selling, buying, supply, delivery, services and accounting.

## 3. Vision

Business & Life should become a trusted operating layer for local economic ecosystems where:

- Customers can discover and transact with local businesses and service providers;
- Merchants can sell, manage orders, understand money and stock, and procure supplies;
- Suppliers can serve local businesses through structured purchase orders;
- Delivery Providers can perform controlled, traceable last-mile work;
- Local Service Providers can present skills, quote jobs and build verified reputation;
- local operators/admins can govern territory-specific access and compliance;
- the business can expand into multiple countries without mixing jurisdictions or production data.

## 4. Problem the business addresses

Local economic activity is frequently fragmented across:

- notebooks;
- cash drawers;
- chat messages;
- informal Supplier arrangements;
- phone calls;
- spreadsheets;
- unrelated delivery services;
- social-media referrals;
- paper permits and certificates;
- memory-based stock control.

This fragmentation creates recurring problems:

- poor visibility into where money went;
- confusion between sales and actual cash received;
- difficulty tracking receivables and Supplier obligations;
- inconsistent stock management;
- weak auditability;
- unstructured Supplier relationships;
- unclear responsibility during delivery;
- weak proof of completed service work;
- inconsistent compliance/document handling;
- difficult onboarding of new staff/operators;
- difficulty scaling local operations into new territories.

## 5. Product thesis

The product creates value by connecting commercial and operational events to the records that explain them.

Examples:

### Customer commerce

```text
discover Merchant
→ order
→ payment/presence gate
→ preparation
→ stock consumption
→ pickup/delivery
→ completion
→ accounting evidence
```

### Procurement

```text
Merchant identifies need
→ accepted Supplier relationship
→ catalog
→ purchase order
→ Supplier confirmation
→ fulfilment
→ Merchant receipt
→ inventory update
→ payment
→ Merchant + Supplier accounting
```

### Local Services

```text
Customer request
→ Service Provider quote
→ Customer acceptance
→ job
→ Provider completion
→ Customer confirmation
→ verified review
```

### Delivery

```text
delivery quote
→ order paid and ready
→ Courier request
→ eligible Courier assignment
→ pickup
→ active location
→ handoff code
→ completion
```

## 6. Target users and stakeholders

### External/public users

- Customers;
- small Merchants;
- local Suppliers/producers/wholesalers;
- Couriers/Delivery Providers;
- skilled Service Providers;
- business employees acting through authorized business roles.

### Internal/operational stakeholders

- Project Owner / Executive;
- Super Admin;
- Country Admin;
- Territory Admin;
- Support Agent;
- Incident/Trust & Safety Agent;
- Compliance/Credential Reviewer;
- Finance/Accounting Operations;
- Partner/Business Development;
- Training/Onboarding;
- Technical/Platform Operations.

### External institutional stakeholders

- local government units / local authorities;
- national regulators;
- tax authorities;
- business registration authorities;
- training/certification bodies;
- payment providers;
- insurance partners;
- logistics partners;
- accountants/bookkeepers;
- legal advisers;
- investors/strategic partners;
- development/NGO/community partners.

## 7. Country-edition strategy

Business & Life is designed as a country-edition platform.

Current edition:
- country: Philippines;
- currency: PHP;
- default business timezone: Asia/Manila.

The country-edition boundary is not merely a language selector.

A future Ireland, Romania or other edition should have:
- jurisdiction-specific legal/compliance packs;
- payment configuration;
- operating-territory configuration;
- currency;
- business/tax rules;
- separate production data boundary where required by architecture/policy;
- localized public/private documentation.

Philippines requirements must never be silently reused as universal rules.

## 8. Pilot strategy

The canonical pilot roadmap defines a small controlled Philippines operating territory as the first proof of the complete economic loop.

The pilot should prioritize reliability over geographic breadth.

Minimum economic loop:

1. Customer account exists and can recover access.
2. Customer sees approved Merchant(s).
3. Customer places an order.
4. payment/cash rules are enforced.
5. Merchant prepares the order.
6. stock/accounting update correctly.
7. optional approved Courier delivers.
8. Customer/Merchant can see status/completion.
9. money and delivery allocations reconcile.
10. Merchant accounting explains money movement.
11. incident/support path exists.
12. Admin can approve/suspend participants and audit decisions.

Supplier and Local Services lanes should expand only when their own launch gates are ready.

## 9. Operating model

### Global platform layer

Responsible for:
- product architecture;
- global brand;
- technical platform;
- global policies;
- security baseline;
- canonical documentation;
- country-edition framework;
- core fee-policy architecture;
- executive governance.

### Country layer

Responsible for:
- country compliance model;
- country partnerships;
- payment/provider configuration;
- national training/operating standards;
- country-level admin governance;
- country-specific documentation;
- regulator/authority relationships.

### Territory layer

Responsible for:
- local onboarding;
- local participant approval where delegated;
- local Merchant/Supplier/Courier/Service Provider operations;
- support and incident escalation;
- local-authority coordination;
- territory health/performance;
- local compliance evidence.

### Business layer

Merchant/Supplier economic entities maintain:
- their business workspace;
- accounting;
- operational records;
- required business registrations/permits;
- staff/access responsibilities;
- product/catalog data;
- money and evidence accuracy.

## 10. Business model and monetization

### Current rule

Do not invent or hard-code commercial rates before Project Owner, legal/tax and payment-provider decisions are approved.

### Potential revenue families — DESIGN

The architecture supports future revenue from one or more of:

- marketplace platform/service fee;
- Delivery service allocation/fee participation;
- Local Services platform/service fee;
- country/territory operator commission model;
- premium business tooling or subscription;
- compliance/document-generation services where lawful;
- Platform Store commerce;
- partner services;
- advertising/promotion only if privacy and user-experience policy permits;
- referral/affiliate revenue in clearly separated business verticals.

### Fee architecture principles

Future fees must:
- be versioned;
- separate platform/country/territory/service components;
- preserve historical fee-policy snapshot;
- be disclosed where required;
- never convert client-side success into payment authority;
- keep processor fees, taxes/withholding and party settlement separate;
- never double-count money.

## 11. Value propositions by profile

### Customer
- local discovery;
- structured checkout;
- clearer order/delivery status;
- local service requests;
- private incident path;
- verified review eligibility for completed service jobs.

### Merchant
- storefront;
- Customer orders;
- business accounting;
- cash reconciliation;
- stock/product/recipe management;
- Supplier procurement;
- delivery dispatch;
- receivables/payables visibility;
- business documentation/compliance support over time.

### Supplier
- business profile/catalog;
- trusted Merchant relationships;
- purchase orders;
- fulfilment;
- receiving/payment traceability;
- Supplier accounting.

### Delivery Provider
- governed eligibility;
- availability;
- assignment;
- route/location workflow;
- verified handoff;
- future settlement/compliance/training support.

### Service Provider
- professional profile;
- services/qualifications;
- quote workflow;
- job lifecycle;
- portfolio;
- verified reviews;
- future compliance/training support.

## 12. Governance model

### Project Owner / Executive
Final authority over:
- mission/strategy;
- product/business scope;
- country expansion;
- protected fee policies;
- major partnerships;
- executive/confidential documents;
- high-risk legal/compliance decisions.

### Super Admin
Platform-wide operational authority within delegated policy.

### Country Admin
Country-scoped authority within global policy.

### Territory Admin
Territory-scoped authority within country/global policy.

### Separation principle
One person may temporarily hold several roles during early pilot stages, but the permission model should still preserve role boundaries for future delegation.

## 13. Organization model

Recommended functional structure:

```text
Project Owner / Executive
│
├── Product & Technology
│   ├── Product Management
│   ├── Engineering
│   ├── Infrastructure / Security
│   └── Data / Analytics
│
├── Country Operations
│   ├── Country Admin
│   ├── Territory Operations
│   ├── Onboarding
│   └── Partner Management
│
├── Trust / Compliance / Support
│   ├── Support
│   ├── Incident / Safety
│   ├── Credential / Compliance Review
│   └── Documentation Governance
│
├── Finance & Commercial
│   ├── Platform Finance
│   ├── Settlement / Reconciliation
│   ├── Business Accounting Guidance
│   └── Commercial / Revenue Operations
│
└── Growth & Partnerships
    ├── Merchant / Supplier acquisition
    ├── Courier / Service Provider acquisition
    ├── Referral / Growth
    ├── Authority / Institutional Relations
    └── Strategic Partnerships
```

In the pilot, several functions may be performed by the same human. Their responsibilities should still be documented separately.

## 14. Documentation as an operating system

The business documentation system is part of the operating model.

Every significant function should eventually have:
- job description;
- SOP;
- rules/prohibitions;
- escalation path;
- training;
- legal/compliance checklist;
- evidence requirements;
- forms/templates;
- acknowledgement/version history.

Public Help Center content should be derived from the same canonical truth at an appropriate public level.

## 15. Compliance model

### Principles

- requirements are jurisdiction-specific;
- official sources are preferred;
- law/regulation/official guidance/platform policy are not interchangeable;
- permit/licence requirements are tied to activity/territory/entity type;
- evidence is versioned and private where appropriate;
- the platform does not falsely claim government acceptance/filing/approval;
- professional legal/accounting advice may still be required for high-risk decisions.

### Philippines baseline authority families to research

DESIGN / RESEARCH TARGETS:
- DTI/BNRS where applicable;
- SEC where applicable;
- CDA where applicable;
- BIR;
- relevant LGU;
- barangay/local requirements where applicable;
- category-specific regulators;
- PRC/TESDA or other credential/training authorities where applicable;
- transport/vehicle/insurance authorities for Delivery where applicable;
- data/privacy authorities.

No checklist is CURRENT until verified from official sources.

## 16. Technology strategy

Current architecture:
- Node/Express service chain;
- PostgreSQL;
- Railway deployment;
- GitHub as canonical code/document source;
- Figma for visual documentation/design;
- public Help Center served from the product.

Future technical directions — DESIGN:
- private role-aware documentation portal;
- analytics/event plane;
- payment/settlement integrations;
- document generation/storage;
- acknowledgement tracking;
- compliance/expiry reminders;
- richer notification/event delivery;
- country-edition deployment templates.

## 17. Data and privacy principles

- business ledgers are business-scoped;
- public profiles expose purpose-limited data;
- private evidence remains private;
- incident evidence is not public reputation;
- unnecessary PII should not be copied into analytics;
- live location is purpose-limited to active delivery;
- generated private documents must not be stored publicly in GitHub;
- access decisions must be auditable.

## 18. Growth strategy

Growth should be based on functioning economic loops, not only traffic.

Potential channels:
- invite/referral system;
- Merchant onboarding;
- Supplier network expansion;
- Courier/Service Provider recruitment;
- local community partnerships;
- local authority/institutional partnerships;
- content/education;
- business tools;
- Platform Store cross-sell;
- country/territory operator partnerships.

Open Growth PRs remain separate from merged current capability until accepted/merged.

## 19. Partnership strategy

Priority partnership classes:
- local business communities;
- Supplier/producer networks;
- delivery/logistics partners;
- training/certification institutions;
- payment providers;
- insurers;
- accountants/bookkeepers;
- LGUs/local authorities;
- national agencies/regulators;
- development organizations;
- investors/strategic operators.

Every partnership type should eventually have:
- value proposition;
- eligibility;
- due diligence;
- agreement template;
- data/privacy boundary;
- operational owner;
- KPIs;
- termination/exit process.

## 20. Authority relationship strategy

Business & Life should be able to present authorities with:
- clear product/company explanation;
- pilot scope;
- operating model;
- role/responsibility map;
- compliance approach;
- data/privacy approach;
- incident/safety controls;
- requested guidance/approval;
- evidence/document index;
- contact and follow-up record.

The system should never imply formal authority endorsement before it exists.

## 21. Strategic phases

### Phase 1 — Controlled Philippines pilot foundation
- identity/recovery;
- profile governance;
- accounting tenancy;
- Marketplace/order flow;
- incident/support;
- admin baseline;
- operational documentation.

### Phase 2 — Reliable local economic loop
- payment/provider confirmation;
- delivery allocation/settlement;
- Merchant/Supplier accounting reconciliation;
- pilot acceptance metrics;
- local onboarding/operations.

### Phase 3 — Supplier + Local Services expansion
- controlled activation;
- compliance playbooks;
- training;
- category-specific launch gates;
- verified reviews/reputation.

### Phase 4 — Compliance/document platform
- role compliance center;
- legal source registry;
- authorization/expiry system;
- generated documents;
- private knowledge portal.

### Phase 5 — Monetization
- approved fee-policy rollout;
- settlement/reconciliation;
- operator commissions;
- premium tooling/store/partner revenue where approved.

### Phase 6 — Territory replication
- repeatable territory-launch pack;
- Territory Admin;
- onboarding capacity;
- local authority packs;
- performance dashboard.

### Phase 7 — Country expansion
- isolated country edition;
- new legal/payment pack;
- country operations leadership;
- localized documentation;
- country-specific partnerships.

## 22. Critical dependencies

- production-ready RBAC;
- official legal/compliance research;
- payment-provider integration/reconciliation;
- secure document/evidence storage;
- reliable backup/security/DR;
- notification infrastructure;
- operational staffing;
- pilot territory definition;
- Project Owner fee/commercial decisions;
- authority/partner engagement.

## 23. Risk register

### R1 — Product scope becomes too broad
Mitigation: pilot one small territory and prove the economic loop before broad expansion.

### R2 — Financial records diverge from real money
Mitigation: separate payment/fulfilment, record money only on confirmed events, reconcile provider evidence.

### R3 — Cross-business data leakage
Mitigation: business tenancy, RBAC, tests and audit.

### R4 — Incorrect legal guidance
Mitigation: official-source registry, jurisdiction/version metadata, review dates and explicit classification.

### R5 — Operational profiles activated without proper checks
Mitigation: invitation/application/approval gates and expiry/suspension logic.

### R6 — Fraud/abuse
Mitigation: incident system, audit logs, trust controls, account/profile suspension, evidence retention.

### R7 — Too many local responsibilities for one person in pilot
Mitigation: document functions separately, use temporary multi-role assignment and plan delegation.

### R8 — Growth before operational quality
Mitigation: gate expansion on reliability metrics, not registrations alone.

### R9 — Privacy/evidence misuse
Mitigation: purpose limitation, access classes, separate private evidence, audit and retention policy.

### R10 — Monetization damages adoption or compliance
Mitigation: versioned configurable fee policy, staged rollout, clear disclosure and legal/tax review.

## 24. KPI framework

Do not invent targets until Owner/operator decisions and baseline data exist.

### Product reliability
- successful signup/recovery;
- order completion;
- payment reconciliation;
- stock consistency;
- delivery completion;
- service-job completion;
- incident resolution;
- app uptime/error rate.

### Marketplace health
- active Merchants;
- published products;
- orders per active Merchant;
- repeat Customers;
- fulfilment time;
- cancellation rate;
- unpaid/credit exposure.

### Supplier health
- accepted Supplier relationships;
- PO completion;
- partial/failed fulfilment;
- receiving accuracy;
- Supplier payment timeliness.

### Delivery health
- approved Couriers;
- assignment acceptance;
- delivery completion;
- failed/cancelled deliveries;
- handoff verification;
- Courier availability.

### Local Services health
- approved Service Providers;
- requests;
- quote acceptance;
- completed jobs;
- Customer confirmation;
- verified reviews;
- disputes.

### Operational governance
- pending applications;
- credential expiries;
- compliance overdue items;
- support resolution time;
- incident backlog;
- audit exceptions.

### Commercial health
- GMV / service value where defined;
- platform fee revenue when activated;
- processor costs;
- operator commissions;
- contribution by territory;
- acquisition cost if marketing spend exists.

## 25. Pilot launch gates

Before public pilot launch, required systems should be explicitly marked:

- READY;
- HOLD;
- UNKNOWN.

No launch decision should infer READY from missing evidence.

At minimum, verify:
- auth/recovery;
- governed profiles;
- business accounting tenancy;
- Customer/Merchant order loop;
- payment rules;
- incident/support;
- admin approval/suspension;
- operational documentation;
- privacy/security baseline;
- backup/DR baseline;
- legal/compliance launch checklist.

## 26. Definition of success

Business & Life is not successful merely because users register.

The business succeeds when a local territory can repeatedly complete real economic activity where:
- Customers can transact confidently;
- businesses can understand their money;
- stock and Supplier flows remain explainable;
- Delivery works predictably;
- Service Providers can complete accountable jobs;
- admins can govern without arbitrary hidden decisions;
- incidents are handled;
- compliance/documentation is organized;
- the operating model can be replicated into the next territory without rebuilding the company from memory.

## 27. Masterplan maintenance

This document is EXECUTIVE_CONFIDENTIAL.

It should be updated when:
- Project Owner changes strategic direction;
- a new country/territory model is approved;
- business model/fee policy changes;
- major product architecture changes;
- new legal/compliance obligations affect strategy;
- organizational authority changes;
- pilot/expansion gates change.

Public pitch decks, partner briefs and authority presentations should be derived from approved portions of this masterplan, not maintain independent strategic truth.
