---
document_id: BL-50-PH-COMPCTR-001
title: Philippines Compliance and Training Center — Product and Authorization Contract V1
document_type: implementation_design
status: DRAFT
access_class: OPERATIONS_PRIVATE
country_code: PH
territory_scope: country
owner_role: Compliance / Credential Reviewer
approver_role: Country Admin
version: 0.1
legal_classification: OPERATIONAL_INTERPRETATION
source_registry_ids:
  - PH-DTI-BNRS-001
  - PH-BIR-REG-001
  - PH-LGU-BPLS-001
---

# Philippines Compliance & Training Center — design contract V1

**Status: DRAFT DESIGN / NOT LIVE / NOT A LEGAL OPINION.** Refs #31, #30, #24, #29, #13, #759 and #85. Philippines is the **only initial edition**. This document specifies a possible integration contract; it does not change an authorization, permit requirement, personnel relationship, retention policy, legal text or live account. Approval of this document is not an approval of any individual legal requirement.

## 1. Existing canonical foundations (do not fork them)

- Role descriptions and profile playbooks: `docs/roles/JD_*.md` and `docs/roles/PLAYBOOK_*.md`. All currently DRAFT and not evidence of employment status, licence, or activation.
- Training/competence: `docs/training/TRAINING_STANDARD.md`, the eight existing curricula, and `docs/sop/SOP_COMPLIANCE_SOURCE_CONTROL.md`. Training completion and professional competence/authorisation are **separate states**.
- Legal source/applicability: `docs/compliance/ph/SOURCE_REGISTRY.md`, `AUTHORIZATION_MATRIX.md`, `BUSINESS_REGISTRATION_BASELINE.md`, and `DELIVERY_LOCAL_SERVICES_RESEARCH.md`. A verified source identity does **not** make every activity in the source legally subject to the same requirement.
- Operational approval: `docs/sop/SOP_PROFILE_AUTHORIZATION.md` and existing application/profile approvals; read permissions from merged Admin RBAC, not a new roles table.
- Controlled documents: `docs/governance/CONTROLLED_DOCUMENT_STANDARD.md`. The private Knowledge Center #85 is a read-only document viewer, **not** an authorization or training-completion system. Versioned legal acceptance and legal activation remain under #759.

Design goal: assemble those controlled inputs into a comprehensible role- and task-specific explanation, an evidence review queue and an immutable decision history **without granting privileges from reading a document**.

## 2. Applicability is a scoped decision, not a global checkbox

Every proposed requirement is keyed by an explicit evaluation context:

| Dimension | Canonical identity or input | Rule |
| --- | --- | --- |
| Edition | country `PH` | Never borrow an IE or future-country rule. |
| Place | verified PSGC region/province/city-or-municipality/barangay codes and effective LGU territory | Do not convert free-text addresses into legal jurisdiction or assume HUC city province inheritance. |
| Actor | authenticated account ID and enabled profile; independently resolved business and Admin assignment | A profile choice cannot confer an Admin permission or another business's rights. |
| Activity | role + approved business category + **specific service/product task** | Do not classify all electrical, food, transport or services tasks from one label. |
| Business form | sole proprietor / corporation / partnership / cooperative / unresolved | Do not infer a legal entity from a storefront title or Merchant profile. |
| Vehicle | bicycle / motorcycle / car / van / other or none, only where applicable | No blanket LTO or LTFRB requirement for all Courier vehicles. |
| Time | requirement version, official effective date, applicability decision and review date | No retrospective replacement of the rules used for a historic approval. |

Specific verified requirements may add conditions to general platform guidance, but **more specific unverified rules cannot override verified national requirements**. Conflicting effective rules go to manual applicability review; there is no automatic "permit not needed" result. An unknown location, activity, status or source is a **hold for the affected regulated action**, not a false assertion that every ordinary account action is prohibited.

## 3. Versioned requirement-record proposal (data contract, not a migration)

A requirement edition is immutable after publication to the evaluator. A changed law, authority interpretation, evidence type or applicability scope creates a **new version**; supersession never rewrites a past decision.

| Field group | Required fields or intentional unknowns |
| --- | --- |
| Identity | `requirement_id`, positive `version`, `country_code`, scoped `territory_psgc_codes`, `profile_type`, `category_code`, `task_code`, `vehicle_class`, `entity_type` (nullable where not relevant). |
| Classification | `origin_type` = LAW / REGULATION / OFFICIAL_GUIDANCE / PLATFORM_POLICY / OPERATIONAL_INTERPRETATION; `obligation_type` = registration / permit / licence / competency / inspection / safety / document / training / acknowledgement. |
| Source | stable `source_registry_id`, issuing authority, official URL, instrument section/version, observed publication/effective date and `source_checked_at` (null means not verified). |
| Legal applicability | `applicability_status` = RESEARCH_REQUIRED / APPLICABILITY_REVIEW_REQUIRED / REVIEWED_APPLICABLE / REVIEWED_NOT_APPLICABLE / SUPERSEDED; task/territory-specific reasoning; qualified reviewer identity/role, review timestamp/reference, future re-review if applicable. |
| Operating scope | `platform_requirement_status` = DRAFT / IN_REVIEW / APPROVED / EFFECTIVE / SUPERSEDED; independent platform approver, approval version/hash, effective time and affected privilege. **No status auto-advances.** |
| Evidence | permitted private evidence types, source-specific validity/renewal data if verified, verification method, named reviewer authority, review decision/reason; optional public **generic** badge semantics only after approval. |
| Dependency | required profile/approval rule version, SOP/curriculum IDs and versions, legal-set version when applicable, migration/transition policy for existing participants. |
| Retention | policy/reference and owner only after a lawful decision; never guess expiry or backup deletion. #759 and privacy governance remain the authority for unresolved controls. |

**Two independent gates:** (a) verified law/applicability for a *legal* claim; (b) approved platform policy for a *platform* condition. A platform may choose a documented, non-misleading platform-only risk control; it must **never label it a statute or government permit**. Neither gate is inferred from a `DRAFT` Markdown file, a code default, a checkbox, or a test fixture.

Recommended records for later implementation:
1. `requirement_version`: immutable scoped source/applicability decision plus content hash.
2. `requirement_evidence`: restricted references to private-storage objects and verifier decisions, not public URLs.
3. `training_attempt` and `role_acknowledgement`: canonical account/profile, curriculum/document **exact version/hash**, original locale, statement version, timestamps, outcome and revocation/supersession. Merely opening a page never records consent/competence.
4. `authorization_decision`: actor, assignment scope, reason, timestamp, subject business/profile/task, **resolved requirement IDs and versions**, evidence-verification IDs, exceptions with approver/expiry, and resulting permitted capability.
5. `requirement_transition`: old/new version, effective date, explicit re-review/renewal plan and individually audited affected approvals.

Identifiers are internal design examples, **not existing tables, production data or migration instructions**. A stored record's version/hash cannot be supplied as a trusted approval by the browser.

## 4. Resolver, review and authorization behavior

1. Authenticate and derive the account, enabled profile, business binding, territory and delegated Admin scope **server-side** from canonical controls. Treat client-selected category/task/vehicle as a request to validate, not an authority grant.
2. Compute the exact jurisdiction/activity context. If a required dimension is unknown, return a structured `NEEDS_REVIEW` reason; do not silently choose a default/neighboring barangay or infer a legal exemption.
3. Select only **effective and applicable, source-supported** requirement versions. Reject contradictory or superseded rules for new decisions until resolved. Draft/research rows may be displayed with a clear label but **cannot function as an official-law approval gate**.
4. Produce a **read-only checklist** divided into: platform onboarding; legally verified requirements; territory/activity checks pending review; optional training/recommendations. Explicitly show `Source last checked` and `Needs verification` where appropriate.
5. Submit evidence only through authorized private evidence storage, with malware/type/access gates. No private business IDs, licences, medical records, IDs, addresses or evidence URLs in public responses or event/analytics logs.
6. The reviewer must have a live, correct **delegated permission and territorial/business scope** on every read and decision; approval cannot be reached through stale session, switching profile or a UI-only role. Record reason, reviewer, evidence references and *exact* versions.
7. Promotion to an allowed regulated capability requires canonical profile approval **and** all specifically applicable approved requirements satisfied. Source validity, reviewer authority and expiry are checked again at commit. A verified Government document, completed training and platform profile approval remain three separate facts.
8. On material source change, create a new requirement version and re-review queue. Historical approvals retain their original snapshot. Suspend/re-review only according to a separately approved transition decision; no arbitrary mass suspension based solely on a scraped notice.
9. A revoked/suspended permission immediately fails server-side checks. Never use a local acknowledgement cache, an old role assignment or a rendered button as proof of authority.

**No runtime wiring is authorized by this document alone.** Exact legal acceptance and current permissions stay controlled by their existing modules, not by the proposed data model.

## 5. Initial profiles and source-dependent questions

| Audience | Existing controlled source | What the center can explain now as DRAFT | Required specific decision before treating as eligible |
| --- | --- | --- | --- |
| Country/Territory Admin | `JD_COUNTRY_ADMIN.md`, `JD_TERRITORY_ADMIN.md`, `CURRICULUM_ADMIN.md` | Delegated country/barangay scope, record-keeping, escalation, conflicts, confidential evidence | Actual RBAC assignment; active operator governance; correct country/territory and training/authority approval |
| Support Agent / Compliance Reviewer | Corresponding `JD_*.md`, curricula and `SOP_COMPLIANCE_SOURCE_CONTROL.md` | Data minimization, audit reasons, incident escalation, source-vs-applicability review | Named assignment, permitted private-data access and valid reviewer delegation |
| Merchant | `PLAYBOOK_MERCHANT.md`, `BUSINESS_REGISTRATION_BASELINE.md` | Separate DTI/SEC/CDA entity path, BIR registration, relevant LGU permit and activity-specific questions | Exact legal business form, LGU, sector/food/product permits, verified evidence and approved profile |
| Supplier | `PLAYBOOK_SUPPLIER.md`, source registry | Separate PO/accounting duties and product/business compliance questions | Product-specific evidence, legal/territory applicability and relationship approval |
| Courier | `PLAYBOOK_COURIER.md`, `DELIVERY_LOCAL_SERVICES_RESEARCH.md` | Road safety, assigned-only location and privacy, handoff evidence, no unapproved cash custody | Vehicle-specific LTO/licence/insurance and any LTFRB or LGU applicability **researched**, courier eligibility and approved duties |
| Service Provider | `PLAYBOOK_SERVICE_PROVIDER.md`, `DELIVERY_LOCAL_SERVICES_RESEARCH.md` | Specific task scope, quotes, private customer data, PRC vs TESDA distinction | Task-specific regulator review, evidence/skill/permit rule and approved activity |

The initial electrical scenario must not use TESDA National Certification as a substitute for a PRC professional licence when the **particular task/profession** is regulated. Conversely, a platform-recommended TESDA course must not be falsely presented as a compulsory PRC licence for all carpentry or repair work. Transport and local permit requirements similarly require task/vehicle/LGU research before production enforcement.

## 6. Application UX (future design, not an active screen)

Authenticated entry point may reference private Knowledge Center's approved documents but must remain a distinct **task/competence/workflow center**. Guest Help Center may link to generic public regulator resources only; it cannot expose a private applicant checklist or uploaded documents.

Suggested hierarchy:
- **My role:** what I may do, not do and escalate, linked to the correct role-version and active account/profile.
- **My readiness:** explicit `RESEARCH NEEDED` / `DOCUMENT REQUIRED` / `UNDER REVIEW` / `PLATFORM APPROVED` and separately `GOVERNMENT DOCUMENT VERIFIED` when supported; never one misleading overall "government approved" badge.
- **For this activity and place:** show which country/LGU/task/vehicle/entity inputs were used, what remains unknown, and when sources were checked.
- **Evidence and renewal:** private uploads, expiry and verifier status, without exposing other applicants' evidence.
- **Learn and practise:** controlled playbooks, training, scenario checks and revisions; completed reading does not equal demonstrated competence.
- **Decision history:** application/rejection/suspension reason; safe contest/correction route and appeal contact if actually staffed/approved.
- **Sources:** citations with external regulator links and clear distinction between official requirement, Business & Life policy and interpretation.

Localization: English (Philippines) and Filipino copy must preserve the same *legal meaning* and approval status. No machine translation can silently change enforceable policy; display controlled fallback/needs review. On Android, make critical states understandable without relying only on color. Do not use promotional badges to imply statutory accreditation.

### Communication examples (templates, not commitments)

**Merchant pending:** "Your Business & Life application is still being reviewed. Your registration and local-permit requirements depend on your business type and location. The checklist shows which items are missing; platform review is not government authorization."

**Evidence request:** "We need an updated document for the specific activity you selected. Upload it using the private application page; please do not send ID scans through ordinary chat or social media. We will record the review result there."

**Courier expiry:** "Your eligibility for this vehicle/activity needs review. You cannot accept affected jobs while the applicable approval is inactive. You can view the document status and the official reference in your private profile."

**Incident complaint:** "We have recorded your concern for review. We cannot confirm another person's private documents or account information. Please use the in-app case status for updates."

Do **not** invent response deadlines, regulatory certainty, reviewer identities, appeal success, or contact details. Only expose operator contact and complaint channels after those facts and responsibilities are verified.

## 7. Trust, privacy and audit boundaries

The Philippines Data Privacy Act (RA 10173) requires purpose-limited, proportionate processing, confidentiality and limited retention. The legal/controller identity, notice, access rights, retention/hold periods and backup deletion must follow the separately reviewed privacy plan; this document does not approve them. Sensitive credential evidence and incident details stay encrypted/private with purpose-scoped reads, access logging, redaction and authorized erasure/hold process where applicable.

No public bucket URLs for documents; no credentials in client logs, URL query parameters, analytics, print previews or unsupported email attachments. An expired/deactivated reviewer must lose access to previous case views. Business/profile/session switches invalidate pending API responses and prevent cross-tenant evidence leakage. A user may inspect *their own* case status without acquiring reviewer privileges. Public Help may describe the process, not another person's case.

## 8. Acceptance matrix for later implementation

| Scenario | Must pass | Must fail |
| --- | --- | --- |
| PH Territory Admin | sees assigned territory, relevant duties and training; reviewer decision saves actual identity/version/reason | reading another territory's application; approving outside delegated scope |
| Merchant with DTI certificate | recognizes DTI as business-name evidence and asks independently for applicable BIR/LGU/activity status | treating DTI certificate alone as a complete permit or tax payment |
| Electrical service tasks | task-specific PRC/TESDA requirements with reviewable source and separate statuses | TESDA auto-promoted to PRC licence; a generic all-electrician legal gate |
| Unregulated/basic task | approved platform-only checks, clear `NO SPECIAL LICENCE IDENTIFIED — REVIEWED` only with evidence | assuming no licence from an empty source registry |
| Courier bicycle vs motorbike | different vehicle-specific evidence and job capacity controls | requiring every bicycle rider to present a motor-vehicle registration or defaulting unknown vehicle |
| Rule version change | history retains exact original requirement/source/reviewer snapshot; controlled re-review on new rule | silently replacing old approval evidence, arbitrary retroactive licence claim |
| Staff profile/account switch | current scoped data only; audit and permission checks on every action | delayed cross-account/cross-territory response or stale approval |
| Reviewer unassigned/expired | read and write denied, private evidence not returned | old permissions from browser local state or a cached checklist |
| Training/acknowledgement | explicit statement/version, meaningful competence evidence and audit where needed | granting role on page view, self-asserted legal clearance or unreviewed curriculum |
| Source missing/stale | `NEEDS VERIFICATION` and unresolved regulated action held | a legal `not required` decision fabricated by default |
| Draft document | visible DRAFT badge with links to approved public content only | publishing draft legal terms as effective or leaking internal Markdown to guests |

Validation layers when built: pure versioned rule-resolution tests; database integrity and immutable-history checks; server RBAC/cross-business/cross-territory negatives; real isolated PH test data; mobile English/Filipino task journeys; then **exact-head Preview agent acceptance → same-head merge → Production SUCCESS → the agent's own caliof.com smoke**. No other agent's Preview slot, production identity, live money or private evidence may be used to fabricate a pass.

## 9. Scope intentionally left open

1. No PH operating controller, country reviewer or legal adviser approval is implied. #759 remains the legal activation gate.
2. Exact food, electrical, transport, LGU, BIR, licence, insurance and renewal decisions require **named authoritative evidence per activity and place**, not placeholder platform defaults.
3. No real data retention/backup expiry, employee-vs-contractor classification, insurance coverage, tax filing, legal review date or issuer signature is invented.
4. No DB migration/API/route, Training Center activation, profile authorization change, email, SMS, provider purchase or Railway service is part of this design slice.
5. #31 stays open until its entire design acceptance and controlled review are reconciled against existing playbooks, SOPs, curricula, jurisdiction logic and owner delivery criteria.

## Official verification pointers (not a substitute for applicability review)

- DTI's BNRS FAQ: https://bnrs.dti.gov.ph/faq ; DTI explains that business-name registration does not replace local authority to operate.
- PRC on TESDA and licensure boundaries (11 October 2025): https://www.prc.gov.ph/index.php/article/harmonization-professional-and-sub-professional-qualifications .
- PRC official licensing source: https://www.prc.gov.ph/ ; TESDA Training Regulations: https://www.tesda.gov.ph/Download/Training_Regulations .
- NPC Data Privacy Act, RA 10173: https://privacy.gov.ph/data-privacy-act/ .
- BIR portal: https://www.bir.gov.ph/ ; official LGU requirements must be checked for the **actual** city/municipality or HUC, not copied from another area.

Source pointers checked for this design on **2026-10-27**; there has been **no role/task/LGU-specific legal applicability decision or review sign-off**. Any future release must recheck official documents and record responsible reviewer, instrument version and decision evidence.
