# Business & Life — Documentation & Governance System

Status: **CANONICAL ARCHITECTURE — V1**
Issue: #57

## 1. Mission

Business & Life needs one controlled documentation system for the whole business.

The same canonical knowledge base must serve two very different needs:

1. **Public documentation** — understandable by a person who has never seen Business & Life and needs to understand the product, profiles, workflows and how to use the application.
2. **Private business documentation** — controlled information used by owners, administrators, operators, business members and specialized functions to run the company safely, consistently and lawfully.

The system must not duplicate truth. A public article and an internal procedure may expose different levels of detail, but they must reference the same canonical policy, workflow or source where applicable.

## 2. Documentation layers

```text
Canonical Knowledge System
│
├── PUBLIC
│   ├── Product overview
│   ├── Profile guides
│   ├── Help Center
│   ├── Troubleshooting
│   ├── Public policies/notices
│   └── Public legal/compliance information
│
├── MEMBER / PROFILE
│   ├── Profile operating manuals
│   ├── User obligations
│   ├── Training
│   ├── Required authorizations/evidence
│   └── Role-specific SOPs
│
├── BUSINESS
│   ├── Merchant/Supplier business policies
│   ├── Accounting procedures
│   ├── Procurement rules
│   ├── Staff responsibilities
│   ├── Internal forms
│   └── Business records
│
├── OPERATIONS / ADMIN
│   ├── Approval playbooks
│   ├── Territory operations
│   ├── Support/incident procedures
│   ├── Verification guidance
│   ├── Audit procedures
│   └── Authority relationship packs
│
└── EXECUTIVE / CONFIDENTIAL
    ├── Masterplan
    ├── Business model
    ├── Financial strategy
    ├── Expansion plan
    ├── Investor/partner pitch
    ├── Negotiation strategy
    └── Sensitive governance records
```

## 3. Canonical documentation domains

### BL-00 — Product & ecosystem

- What is Business & Life?
- Product architecture
- Profile architecture
- Country-edition model
- Public/private boundaries
- Data and business-workspace boundaries
- Product glossary

### BL-10 — Business masterplan

- mission / vision;
- business model;
- operating model;
- revenue model;
- market-entry plan;
- Philippines pilot roadmap;
- expansion strategy;
- territory model;
- partner model;
- risk register;
- strategic KPIs;
- board/owner decisions;
- investor / strategic partner narrative.

### BL-20 — Governance

- company/platform governance;
- decision authority;
- role hierarchy;
- delegated authorities;
- separation of duties;
- approval thresholds;
- document approval matrix;
- conflict-of-interest rules;
- audit/evidence expectations;
- change management.

### BL-30 — Roles & job descriptions

For every operational or administrative function:

- role purpose;
- reporting line;
- scope of authority;
- responsibilities;
- daily / weekly / periodic duties;
- prohibited actions;
- access level;
- required training;
- required licence/permit/certificate where applicable;
- performance measures;
- escalation path;
- handover rules;
- acknowledgement/signature form.

This applies to public profiles and internal jobs separately.

### BL-40 — Standard Operating Procedures (SOPs)

Examples:

- Customer order handling;
- Merchant cash opening/closing;
- recording real payments;
- receivables follow-up;
- inventory corrections;
- procurement and receiving;
- Supplier fulfilment;
- delivery assignment;
- courier handoff;
- credential verification;
- incident triage;
- evidence handling;
- account recovery;
- business onboarding;
- territory launch;
- suspension/reactivation;
- audit and exception handling.

### BL-50 — Legal & compliance

Organized by country/territory and activity.

Each legal pack must separate:

- **LAW** — a binding legal source;
- **REGULATION** — delegated regulation/rule;
- **OFFICIAL GUIDANCE** — authority guidance;
- **PLATFORM POLICY** — a Business & Life rule;
- **OPERATIONAL INTERPRETATION** — internal implementation guidance;
- **TEMPLATE GUIDANCE** — model text, not legal fact.

No legal statement may be published as fact without a recorded source/evidence basis.

### BL-60 — Licences, registrations & authorizations

For each profile/function/activity:

- who requires authorization;
- issuing authority;
- jurisdiction;
- prerequisites;
- evidence required;
- application path;
- fees if verified/current;
- renewal/expiry;
- operating restrictions;
- platform evidence field;
- internal reviewer;
- suspension/revocation consequences;
- source citations;
- review date.

### BL-70 — Local authority relationship packs

These are operational packs for interaction with government/local authorities.

Possible contents:

- organization/product introduction letter;
- project brief;
- local pilot proposal;
- authority meeting brief;
- permit/registration checklist;
- request-for-information template;
- cover letter;
- declarations;
- evidence index;
- authorization matrix;
- contact log;
- meeting minutes template;
- follow-up letter;
- document-submission checklist.

Specific authority names/forms must be researched for the jurisdiction before being marked CURRENT.

### BL-80 — Finance & accounting governance

- chart/meaning of transaction types;
- money account definitions;
- linked financial event rules;
- cash reconciliation;
- remittances;
- Customer receivables;
- Supplier payables;
- credit handling;
- accounting corrections;
- audit trail;
- CSV/export rules;
- record retention;
- tax/compliance preparation boundaries;
- accountant handoff pack;
- evidence-generation rules.

### BL-90 — Trust, safety, privacy & incidents

- incident classification;
- evidence handling;
- access restrictions;
- retention;
- escalation;
- public review vs private incident;
- account abuse;
- fraud signals;
- data minimization;
- privacy notices;
- consent records;
- safeguarding rules;
- security incident handling.

### BL-100 — HR, training & competency

- onboarding;
- role training;
- competency checklist;
- training acknowledgement;
- annual refresh;
- disciplinary process;
- access removal;
- role transfer;
- departure/handover;
- code of conduct;
- occupational requirements by role/jurisdiction.

### BL-110 — Agreements & declarations

- platform role agreements;
- Merchant/Supplier/Courier/Service Provider declarations;
- confidentiality;
- privacy consent;
- evidence declaration;
- conflict-of-interest declaration;
- equipment/property acknowledgement;
- authorization acknowledgement;
- training acknowledgement;
- operating-territory acknowledgement;
- partner/cooperation templates.

### BL-120 — Forms & automatically generated documents

Canonical templates that the app may generate from verified profile/business data.

Templates are version controlled. Filled documents containing private data are not stored as public repository content.

### BL-130 — Pitch & external presentation

Separate audiences:

- investor pitch;
- local-government pitch;
- strategic-partner pitch;
- Merchant/Supplier onboarding pitch;
- community/cooperative pitch;
- NGO/development partner pitch;
- employment/recruitment pack;
- press/media factsheet.

### BL-140 — Crisis, continuity & disaster recovery

- service outage;
- security incident;
- lost access;
- database recovery;
- payment discrepancy;
- fraud incident;
- public complaint;
- authority inquiry;
- emergency territory suspension;
- communication tree;
- post-incident review.

### BL-150 — Public Help Center

The merged public documentation layer.

Public docs must translate the canonical system into plain language and must never expose restricted internal content merely because a related public concept exists.

## 4. Access classification

Every canonical document has exactly one primary access class:

| Code | Meaning |
| --- | --- |
| `PUBLIC` | Anyone may read |
| `MEMBER` | Any authenticated platform member |
| `PROFILE_PRIVATE` | Only members with an applicable enabled/authorized profile |
| `BUSINESS_PRIVATE` | Only members authorized for the specific business workspace |
| `OPERATIONS_PRIVATE` | Internal platform operations personnel |
| `TERRITORY_ADMIN` | Authorized administration for the applicable territory |
| `COUNTRY_ADMIN` | Authorized country administration |
| `SUPER_ADMIN` | Platform-wide privileged administration |
| `EXECUTIVE_CONFIDENTIAL` | Owner/board/executive-authorized audience only |

Additional qualifiers may narrow the audience:

- profile;
- business;
- territory;
- country;
- department/function;
- assigned case;
- document owner;
- named approver.

Access classification is not equivalent to GitHub visibility. GitHub stores canonical source/templates. Runtime presentation must enforce application authorization.

## 5. Document lifecycle

Canonical states:

```text
DRAFT
  → IN_REVIEW
  → APPROVED
  → EFFECTIVE
  → SUPERSEDED
  → RETIRED
```

Additional legal-research states:

- `RESEARCH_REQUIRED`
- `SOURCE_VERIFIED`
- `LEGAL_REVIEW_RECOMMENDED`
- `STALE_REVIEW_DUE`

A DRAFT must never be presented to users as an effective binding platform policy.

## 6. Required metadata

Every controlled document must include:

```yaml
document_id: BL-XX-YYYY
title: ...
document_type: policy | sop | job_description | legal_note | checklist | template | form | pitch | guide
status: DRAFT | IN_REVIEW | APPROVED | EFFECTIVE | SUPERSEDED | RETIRED
access_class: PUBLIC | MEMBER | PROFILE_PRIVATE | BUSINESS_PRIVATE | OPERATIONS_PRIVATE | TERRITORY_ADMIN | COUNTRY_ADMIN | SUPER_ADMIN | EXECUTIVE_CONFIDENTIAL
applicable_profiles: []
applicable_functions: []
country_code: PH
territory_scope: national | region | province | city | municipality | barangay | specific
jurisdiction: ...
owner_role: ...
approver_role: ...
version: 1.0
effective_date: YYYY-MM-DD
review_due: YYYY-MM-DD
supersedes: null
legal_classification: null | LAW | REGULATION | OFFICIAL_GUIDANCE | PLATFORM_POLICY | OPERATIONAL_INTERPRETATION | TEMPLATE_GUIDANCE
source_registry_ids: []
template_id: null
```

## 7. Legal source discipline

Every legal/compliance record must answer:

1. Which jurisdiction?
2. Which authority issued the source?
3. What is the official source?
4. What is the source date/version?
5. Is it currently effective?
6. Which profile/activity does it affect?
7. Is the requirement legal, regulatory, authority guidance or platform policy?
8. What evidence proves compliance?
9. Who checks it?
10. When must the interpretation be reviewed again?

Secondary blogs/articles may help discovery but cannot be the final authority when a primary source is available.

## 8. Role-document relationship

A role can have several relationships with a document:

- **READ**
- **ACKNOWLEDGE**
- **EXECUTE**
- **CREATE**
- **EDIT**
- **REVIEW**
- **APPROVE**
- **AUDIT**
- **GENERATE**
- **SIGN**
- **SUBMIT_TO_AUTHORITY**

This is separate from access visibility.

Example:

```text
Courier SOP
Courier: READ + ACKNOWLEDGE + EXECUTE
Territory Admin: READ + REVIEW
Country Admin: READ + APPROVE
Super Admin: READ + AUDIT
```

## 9. Public vs private publication rule

A public document may contain:

- product explanation;
- user instructions;
- public eligibility requirements;
- public terms/notices;
- non-sensitive process descriptions;
- public legal information;
- generic public forms intended for users.

It must not expose:

- internal fraud thresholds;
- private investigation procedures;
- personal/business-private records;
- private evidence;
- confidential commercial strategy;
- privileged Admin controls;
- internal security procedures;
- executive negotiations;
- secret keys or infrastructure details.

## 10. Generated documents

The application may generate documents from canonical templates.

The system must distinguish:

### Template

Version-controlled source with placeholders.

Example:

```text
BL-FORM-PH-COUR-001
Courier Authorization Acknowledgement
version 1.2
```

### Generated instance

A runtime document filled with verified data.

Example fields:

- document instance id;
- template id + version;
- account/business id;
- jurisdiction;
- generated timestamp;
- issuing/approving role;
- values used;
- signature/acknowledgement state;
- verification code/QR if implemented;
- immutable hash if implemented;
- expiry;
- superseding instance.

Private generated documents belong in secured runtime storage.

## 11. Country packs

Legal/compliance content must be grouped under country packs.

Initial pack:

```text
PH — Philippines
├── national
├── region
├── province
├── city / municipality
└── barangay
```

A future Ireland/Romania/other pack must not reuse Philippines requirements as if they were universal.

## 12. Product/document integration

Eventually every controlled operational screen should be able to surface:

- **Help** — plain-language usage documentation;
- **Policy** — applicable platform policy;
- **Procedure** — applicable SOP;
- **Requirements** — licence/evidence checklist;
- **Forms** — forms/templates the user may generate;
- **Legal basis** — public/legal source summary where appropriate;
- **Acknowledge** — required policy/SOP acknowledgement;
- **History** — document version/effective status where required.

## 13. Masterplan principle

The business masterplan is not a marketing brochure.

It must become the canonical operational description of:

- what the company is building;
- why;
- target market;
- operating territories;
- economic model;
- profile ecosystem;
- organizational structure;
- revenue/cost model;
- governance;
- compliance architecture;
- rollout phases;
- technology architecture;
- partner model;
- risks;
- milestones;
- measurable success criteria.

Public pitch material is derived from the masterplan, not the other way around.

## 14. Implementation phases

### Phase A — Governance foundation

- documentation taxonomy;
- access classes;
- metadata standard;
- role/document matrix;
- source registry;
- template registry.

### Phase B — Existing-product documentation

- complete job/profile manuals;
- SOPs for currently merged workflows;
- accounting policies;
- operational checklists;
- incident/privacy procedures.

### Phase C — Philippines compliance pack

Research current official sources and build:

- business/entity registration map;
- Merchant activity requirements;
- Supplier requirements;
- Delivery/Courier requirements;
- Local Services category requirements;
- tax/accounting evidence requirements;
- data/privacy requirements;
- local-territory requirements;
- authority engagement packs.

### Phase D — Generated forms/documents

Define and then implement:

- acknowledgements;
- declarations;
- authorization certificates/letters where appropriate;
- profile/business summaries;
- authority cover letters;
- evidence indexes;
- compliance checklists;
- training records;
- business/accounting reports.

### Phase E — Private documentation portal

After RBAC capability is merged:

- access-controlled private knowledge center;
- role-aware navigation;
- search;
- acknowledgement tracking;
- version/effective-date display;
- generate/download permitted templates;
- audit trail.

## 15. Acceptance principle

A person responsible for a Business & Life function should be able to answer from the documentation:

- What am I responsible for?
- What am I allowed to do?
- What am I prohibited from doing?
- What procedure must I follow?
- What evidence do I need?
- What legal/policy basis applies?
- Which form/document must I use?
- Who approves it?
- Who can see it?
- When does it expire or require review?
- Where do I escalate an exception?

If the system cannot answer these questions, the documentation is incomplete.
