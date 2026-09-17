---
document_id: BL-30-GLB-ROLECAT-001
title: Organization and Role Catalogue
document_type: role_catalogue
status: DRAFT
access_class: OPERATIONS_PRIVATE
applicable_profiles: []
applicable_functions: []
country_code: GLB
territory_scope: global
owner_role: Executive
approver_role: Project Owner
version: 1.0
effective_date: null
review_due: null
supersedes: null
legal_classification: PLATFORM_POLICY
source_registry_ids: []
template_id: null
---

# Business & Life — Organization & Role Catalogue

## 1. Purpose

This catalogue defines the functions the business needs, even when one person temporarily performs several functions during the pilot.

A function is not the same thing as:
- a public profile;
- an employment contract;
- an application permission.

Each role requires a separate job description before being treated as a fully controlled internal position.

## 2. Role hierarchy

```text
Project Owner / Executive
├── Super Admin
│   ├── Country Admin
│   │   ├── Territory Admin
│   │   │   ├── Onboarding / Partner Operations
│   │   │   ├── Support Agent
│   │   │   ├── Incident / Trust & Safety
│   │   │   └── Compliance / Credential Reviewer
│   │   └── Country Partnerships / Authority Relations
│   └── Global Platform Operations
├── Product & Technology
│   ├── Product Management
│   ├── Engineering
│   ├── Infrastructure / Security
│   ├── Data / Analytics
│   └── Documentation Governance
├── Finance & Commercial
│   ├── Platform Finance
│   ├── Payment / Settlement Reconciliation
│   ├── Commercial / Fee Operations
│   └── Accounting / Compliance Coordination
└── Growth & Partnerships
    ├── Growth / Referral
    ├── Merchant / Supplier Acquisition
    ├── Courier / Service Provider Acquisition
    └── Strategic Partnerships
```

## 3. Public platform profiles

### Customer

Purpose:
- buy/request services;
- track fulfilment;
- confirm completed services;
- report problems.

Customer is a platform profile, not an internal company job.

### Merchant

Purpose:
- operate an approved business storefront/workspace;
- handle orders;
- maintain business records;
- procure supplies;
- dispatch delivery where applicable.

Merchant is an external/business profile unless separately employed by the platform.

### Supplier

Purpose:
- operate an approved supply business;
- maintain catalog;
- accept Merchant relationships;
- fulfil purchase orders.

Supplier is an external/business profile unless separately employed by the platform.

### Delivery Provider / Courier

Purpose:
- perform approved delivery assignments.

May be independent/partner/employee depending on future legal/business model; do not assume employment status.

### Service Provider / Local Services

Purpose:
- offer approved local skilled services through the platform.

May be independent/business/partner depending on future legal/business model; do not assume employment status.

## 4. Internal roles

### BL-R01 — Project Owner / Executive

Purpose:
Own the strategic direction and protected business decisions.

Primary responsibilities:
- mission/vision;
- product/business scope;
- executive strategy;
- major financial model decisions;
- country expansion;
- protected fee policies;
- major partnerships;
- final approval of confidential governance;
- high-risk legal/compliance decisions;
- appointment/delegation of senior authority.

Prohibited:
- delegating away ultimate owner decisions without a documented authority basis;
- representing unverified legal/compliance facts as confirmed.

Access:
- EXECUTIVE_CONFIDENTIAL.

### BL-R02 — Super Admin

Purpose:
Platform-wide operational administration within Owner policy.

Responsibilities:
- global operational oversight;
- country/territory admin assignment;
- privileged approval/suspension;
- audit;
- global incident/escalation oversight;
- protected configuration within delegated limits.

Escalates:
- strategy;
- high-risk legal;
- protected fee-policy;
- severe security/privacy;
- existential operational risk.

### BL-R03 — Country Admin

Purpose:
Operate one country edition within global policy.

Responsibilities:
- country operations;
- territory governance;
- country-specific compliance coordination;
- country participant approval where delegated;
- national partnerships/authority coordination;
- country support/escalation;
- country KPIs.

### BL-R04 — Territory Admin

Purpose:
Run an assigned local operating territory.

Responsibilities:
- local onboarding;
- delegated approvals;
- suspension/escalation;
- local participant support;
- local compliance evidence follow-up;
- local incident coordination;
- territory performance;
- local authority relationship support.

### BL-R05 — Support Agent

Purpose:
Resolve user/account/operational support issues without exceeding permissions.

Responsibilities:
- receive support requests;
- verify identity through approved procedures;
- classify issue;
- provide documented guidance;
- escalate money/security/compliance incidents;
- keep audit notes;
- avoid unauthorized data disclosure.

### BL-R06 — Incident / Trust & Safety Agent

Purpose:
Handle private incidents and safety/abuse cases.

Responsibilities:
- triage;
- evidence handling;
- case chronology;
- escalation;
- temporary safety actions where delegated;
- resolution documentation;
- privacy/data minimization.

### BL-R07 — Compliance / Credential Reviewer

Purpose:
Review profile/business evidence against current approved requirement checklists.

Responsibilities:
- confirm evidence type;
- check validity/expiry;
- record verification basis;
- distinguish platform verification from government authority;
- request missing evidence;
- escalate ambiguous legal cases;
- maintain source/version discipline.

### BL-R08 — Onboarding / Partner Operations

Purpose:
Bring approved ecosystem participants into the platform consistently.

Responsibilities:
- explain role requirements;
- collect application/evidence;
- training orientation;
- setup/checklist;
- handoff to Admin/compliance;
- maintain onboarding status.

### BL-R09 — Country / Territory Partnerships & Authority Relations

Purpose:
Coordinate external institutional relationships.

Responsibilities:
- authority contact;
- meeting preparation;
- document submission packs;
- follow-up;
- partner due diligence coordination;
- record commitments;
- never imply endorsement before approval.

### BL-R10 — Product Manager

Purpose:
Translate business needs into controlled product requirements.

Responsibilities:
- product roadmap;
- issue/spec quality;
- user workflows;
- acceptance criteria;
- dependency coordination;
- documentation impact;
- release readiness.

### BL-R11 — Software Engineer

Purpose:
Implement and maintain product behavior.

Responsibilities:
- code;
- tests;
- security/privacy controls;
- migration quality;
- incident fixes;
- documentation of user-visible behavior;
- review discipline.

### BL-R12 — Infrastructure / Security Operator

Purpose:
Maintain deployment, availability, secrets, monitoring and recovery.

Responsibilities:
- environments;
- access controls;
- backups;
- monitoring;
- incident response;
- secret management;
- disaster recovery;
- security evidence.

### BL-R13 — Data / Analytics Operator

Purpose:
Produce purpose-limited business/product analytics without becoming the authority for operational state.

Responsibilities:
- metrics definitions;
- event quality;
- dashboards;
- data minimization;
- anomaly detection;
- privacy-safe reporting.

### BL-R14 — Documentation Governance Owner

Purpose:
Maintain the canonical documentation system.

Responsibilities:
- document taxonomy;
- version/effective status;
- access classification;
- public/private publication;
- source registry;
- legal-review reminders;
- templates/forms;
- role-document matrix;
- stale-document detection.

### BL-R15 — Platform Finance Operator

Purpose:
Oversee platform-level financial records and controls.

Responsibilities:
- platform revenue/cost records;
- reconciliation;
- fee-policy evidence;
- processor/provider evidence;
- settlements;
- finance reporting;
- accountant/auditor handoff.

### BL-R16 — Payment / Settlement Reconciliation Operator

Purpose:
Reconcile confirmed payment/provider events and party allocations.

Responsibilities:
- provider evidence;
- exceptions;
- refunds;
- settlement status;
- allocation discrepancies;
- escalation.

This role is DESIGN until payment/settlement infrastructure is implemented.

### BL-R17 — Commercial / Fee Operations

Purpose:
Operate approved commercial policies without inventing rates.

Responsibilities:
- apply approved fee-policy versions;
- partner/operator commercial terms;
- fee disclosure;
- historical policy records;
- commercial performance.

### BL-R18 — Accounting / Compliance Coordinator

Purpose:
Coordinate platform/business accounting evidence with external accountants/compliance processes.

Responsibilities:
- evidence-pack preparation;
- accounting-record quality;
- filing/payment evidence tracking;
- external accountant coordination;
- no false government filing claims.

### BL-R19 — Growth / Referral Operator

Purpose:
Operate user acquisition/referral programs under privacy/anti-spam rules.

Responsibilities:
- campaigns;
- referral content;
- attribution;
- experiments;
- consent/marketing boundaries;
- reporting.

Open Growth PRs define technical details and are not assumed merged until accepted.

### BL-R20 — Merchant / Supplier Acquisition

Purpose:
Build local commerce/supply network.

Responsibilities:
- prospecting;
- qualification;
- onboarding handoff;
- territory fit;
- relationship development;
- no false promises about approval/revenue.

### BL-R21 — Courier / Service Provider Acquisition

Purpose:
Recruit suitable delivery/service participants.

Responsibilities:
- explain requirements;
- qualification;
- application handoff;
- training orientation;
- no promise of approval before review.

### BL-R22 — Strategic Partnerships Lead

Purpose:
Develop approved external commercial/institutional relationships.

Responsibilities:
- partner model;
- due diligence;
- negotiation preparation;
- agreement coordination;
- operational handoff;
- KPI/renewal review.

## 5. Business-level roles

These roles may belong to Merchant/Supplier entities rather than the platform company.

### Business Owner
- controls business workspace;
- accountable for business records;
- delegates staff access;
- responsible for business registrations/permits.

### Business Manager
- operates delegated business functions.

### Cashier / Counter Operator
- receives Customer presence/payments;
- follows cash rules;
- does not alter accounting outside delegated scope.

### Inventory / Production Operator
- stock;
- recipes/production;
- receiving;
- stock exceptions.

### Procurement Operator
- Supplier relationships;
- PO creation;
- receiving;
- procurement records.

### Finance / Bookkeeping Operator
- transaction review;
- reconciliation;
- receivables/payables;
- evidence export.

Exact runtime business staff roles are DESIGN until permission architecture implements them.

## 6. Role control requirements

Every internal or delegated business role should eventually define:

1. role ID;
2. role purpose;
3. reporting line;
4. authority;
5. allowed actions;
6. prohibited actions;
7. approval thresholds;
8. privacy duties;
9. money-handling rules;
10. required training;
11. required evidence/credentials;
12. escalation;
13. KPIs;
14. access class;
15. documents to acknowledge;
16. forms/templates used;
17. handover process.

## 7. Multi-role pilot rule

During the pilot, the Project Owner may temporarily act as:
- Executive;
- Super Admin;
- Country Admin;
- Territory Admin;
- selected operations roles.

This does not eliminate the role distinctions.

The system should record/document which authority is being exercised, even when the same human fills several roles.

## 8. Next step

Create individual controlled job descriptions beginning with:

1. Project Owner / Executive;
2. Super Admin;
3. Country Admin;
4. Territory Admin;
5. Support Agent;
6. Compliance/Credential Reviewer;
7. Merchant;
8. Supplier;
9. Courier;
10. Service Provider.

Each job description must connect to:
- applicable SOPs;
- legal/compliance pack;
- access class;
- training;
- required acknowledgements;
- escalation matrix.
