---
document_id: BL-OWNER-ADMIN-INDEX-001
title: Owner & Admin Internal Documentation Hub
document_type: internal_index
status: ACTIVE_INDEX
access_class: OPERATIONS_PRIVATE
country_code: GLB
owner_role: Project Owner / Executive
approver_role: Project Owner
version: 1.0
---

# Business & Life — Owner & Admin Documentation Hub

This folder is the **internal starting point for the Project Owner, Super Admin, Country Admin and authorized Territory/Admin operators**.

It is not a public Help Center.

It does not replace the canonical documents elsewhere in `docs/`.
It provides a controlled map to them so internal operators know:

- what is authoritative;
- what to read first;
- where operational procedures live;
- where Philippines-specific compliance research lives;
- what is draft vs approved;
- which documents are public, member-facing or operations-private;
- which issue/roadmap controls current implementation.

## 1. Core rule

**Do not duplicate canonical policy documents into this folder.**

This hub links to the source-of-truth files.

When a canonical document changes, update the source document first, then update this index only when the map itself changes.

---

# START HERE — OWNER

Read these first:

1. [Current State](../CURRENT_STATE.md)
   - current implemented/reconciled product state;
   - useful before any major decision.

2. [Reconciled App Architecture](../architecture/RECONCILED_APP_ARCHITECTURE.md)
   - canonical Account / Profile / Workspace / Admin architecture;
   - identity, role and isolation boundaries.

3. [Masterplan](../masterplan/MASTERPLAN.md)
   - strategic product and organizational direction.

4. [Philippines Pilot & Expansion Master Roadmap](../masterplan/PH_PILOT_EXPANSION_ROADMAP.md)
   - internal PH pilot/expansion reference.

5. GitHub Issue **#37 — PH PILOT ROADMAP**
   - active canonical launch gates and controlled expansion decisions.

6. GitHub Issue **#620 — MICROBUSINESS FORMALIZATION & COMMUNITY GROWTH V1**
   - Queens Row West readiness/formalization pilot;
   - food / non-food / Local Services path;
   - authority outreach research;
   - Bacoor/DTI source validation.

7. GitHub Issue **#350 — PRODUCT EXPERIENCE CONTROL TOWER V1**
   - canonical simplification and UX-quality doctrine.

---

# START HERE — ADMIN

Authorized Admins should begin with:

1. [Admin Workspace & Delegation](../architecture/ADMIN_WORKSPACE_AND_DELEGATION.md)
   - privilege separation;
   - Admin workspace rules;
   - delegation model.

2. [Admin Training Curriculum](../training/CURRICULUM_ADMIN.md)
   - minimum privileged-operations training.

3. [Country Admin Job Description](../roles/JD_COUNTRY_ADMIN.md)

4. [Territory Admin Job Description](../roles/JD_TERRITORY_ADMIN.md)

5. [Support Agent Job Description](../roles/JD_SUPPORT_AGENT.md)

6. [Compliance Reviewer Job Description](../roles/JD_COMPLIANCE_REVIEWER.md)

7. [Profile Authorization SOP](../sop/SOP_PROFILE_AUTHORIZATION.md)

8. [Support Triage SOP](../sop/SOP_SUPPORT_TRIAGE.md)

9. [Incident SOP](../sop/SOP_INCIDENTS.md)

10. [Compliance Source Control SOP](../sop/SOP_COMPLIANCE_SOURCE_CONTROL.md)

---

# DOCUMENT GOVERNANCE

Canonical rules for documentation:

- [Documentation System](../governance/DOCUMENTATION_SYSTEM.md)
- [Role Document Matrix](../governance/ROLE_DOCUMENT_MATRIX.md)
- [Template Registry](../forms/TEMPLATE_REGISTRY.md)

Use document metadata such as:

- `status`;
- `access_class`;
- `country_code`;
- `owner_role`;
- `approver_role`;
- `version`.

Never treat a `DRAFT` document as an approved legal or operational instruction merely because it exists in GitHub.

---

# PHILIPPINES — COMPLIANCE & OPERATIONS

Internal PH reference:

- [PH Authorization Matrix](../compliance/ph/AUTHORIZATION_MATRIX.md)
- [PH Privacy Baseline](../compliance/ph/PRIVACY_BASELINE.md)
- [PH Compliance Source Registry](../compliance/ph/SOURCE_REGISTRY.md)
- [Delivery & Local Services Research](../compliance/ph/DELIVERY_LOCAL_SERVICES_RESEARCH.md)
- [Controller Allocation Assessment](../privacy/CONTROLLER_ALLOCATION_ASSESSMENT.md)
- [NPC Registration Assessment Draft](../privacy/NPC_REGISTRATION_ASSESSMENT_DRAFT.md)

Important:

External law/regulation changes over time.
Before relying on a legal/compliance rule for a live decision, verify that the cited official source is still current.

---

# QUEENS ROW WEST / BACOOR PILOT

Canonical working record:

**GitHub Issue #620**

Use it for:
- microbusiness-readiness architecture;
- Bacoor SVS / home-operation / permit research;
- BMBE pathway;
- food / non-food / Local Services tracks;
- Stage A readiness pilot;
- Stage B controlled commercial pilot;
- Bacoor/Negosyo Center outreach map;
- pilot cohort and 60-day plan;
- authority-facing one-pager drafts;
- privacy/data-sharing boundaries.

Strategic expansion is controlled by:

**GitHub Issue #37**

Demand/waitlist implementation is controlled by:

**GitHub Issue #548**

Do not create parallel territory-demand or pilot-roadmap systems.

---

# OWNER / OPERATOR / ADMIN AUTHORITY

Canonical architecture:

- GitHub Issue **#24 — Global Superadmin, Country/Territory Administration, Operating Partners and Commission Hierarchy**
- [Admin Workspace & Delegation](../architecture/ADMIN_WORKSPACE_AND_DELEGATION.md)
- [Executive Job Description](../roles/JD_EXECUTIVE.md)
- [Country Admin Job Description](../roles/JD_COUNTRY_ADMIN.md)
- [Territory Admin Job Description](../roles/JD_TERRITORY_ADMIN.md)

Key separation:

**Authority ≠ employment/contract ≠ economic entitlement.**

An Admin assignment does not automatically create an operator-revenue share.

An economic operating partner does not automatically receive unrestricted Admin access.

---

# FINANCE / MONEY / MONETIZATION

Canonical decision sources include:

- GitHub Issue **#34 — Philippines payment providers, platform fees, settlements and reconciliation**
- GitHub Issue **#117 — Unit economics, cost attribution and profitability**
- GitHub Issue **#136 — Service-specific promotional entitlement**
- GitHub Issue **#198 — PayMongo Linked Accounts / platform architecture**
- GitHub Issue **#232 — Monetization V2**
- GitHub Issue **#241 — Delivery 30-day / Merchant 90-day promo**
- GitHub Issue **#245 — Pricing transparency**

Current Owner-approved commercial target:

- Customer: FREE;
- Merchant: 90-day promo, then ₱99/month + 0.50% eligible transaction fee;
- Supplier: 90-day promo, then ₱99/month + 0.50% eligible transaction fee;
- Local Services: 90-day promo, then ₱99/month + 0.50% eligible transaction fee;
- Courier/Delivery: 30-day promo, then 10% of verified Delivery price;
- processor/provider charges remain separate.

These values must not be silently changed by lower-level Admins.

---

# GROWTH

Canonical references:

- GitHub Issue **#45 — Referral Growth Engine**
- GitHub Issue **#74 — Merchant acquisition**
- GitHub Issue **#62 — Community Local Services**
- GitHub Issue **#548 — Territory Demand & Waitlist**
- GitHub Issue **#620 — Microbusiness Formalization & Community Growth**

Pilot doctrine:

**Growth must not outrun operations.**

Do not heavily promote into a territory that cannot serve the resulting demand.

---

# UX / PRODUCT QUALITY

Canonical control:

- GitHub Issue **#350 — PRODUCT EXPERIENCE CONTROL TOWER V1**

Doctrine:

**Simple at the surface, powerful underneath.**

Simplification means:
- clearer next action;
- progressive disclosure;
- human language;
- mobile-first;
- fewer simultaneous decisions.

It does not mean removing:
- financial truth;
- auditability;
- permissions;
- compliance;
- advanced capability.

---

# SUPPORT / INCIDENTS

Canonical internal documents:

- [Support Triage SOP](../sop/SOP_SUPPORT_TRIAGE.md)
- [Incident SOP](../sop/SOP_INCIDENTS.md)
- [Support Training](../training/CURRICULUM_SUPPORT.md)

Admin must distinguish:
- normal support;
- Trust & Safety;
- financial/payment exception;
- compliance review;
- system/security escalation.

Do not resolve serious incidents by inventing policy ad hoc.

---

# AUTHORITY / PARTNER MATERIALS

Internal authority-pack system already exists:

- [Authority Pack Standard](../forms/AUTHORITY_PACK_STANDARD.md)
- [Public Sector / LGU Pitch](../pitch/PUBLIC_SECTOR_LGU_PITCH.md)
- [PH Pilot Proposal](../pitch/PH_PILOT_PROPOSAL.md)
- [Master Pitch](../pitch/MASTER_PITCH.md)
- [Claim Evidence Register](../pitch/CLAIM_EVIDENCE_REGISTER.md)

Use these when a formal external discussion is authorized.

Never present a draft as an approved partnership or government endorsement.

---

# INTERNAL DOCUMENT QUALITY RULE

For any important decision, the Owner/Admin should be able to answer:

1. What is the canonical document or issue?
2. Is it DRAFT, active, approved or implementation-in-progress?
3. Who is allowed to see/use it?
4. Which country/territory does it apply to?
5. Which official source supports the rule?
6. When was that source last verified?
7. Is the rule implemented in Production or only designed?
8. Who may change it?

If those answers are unclear, the document is not yet operationally sufficient.

---

# SOURCE-OF-TRUTH HIERARCHY

When sources appear inconsistent, use this order:

1. current verified law/regulator/provider evidence;
2. explicit current Owner decision;
3. canonical architecture / policy document;
4. current GitHub implementation issue / accepted PR evidence;
5. SOP / training document;
6. design/pitch material;
7. old issue comments / historical drafts.

Production behavior must still be verified separately.

---

# MAINTENANCE

This index should be reviewed when:

- a country edition is added;
- a major Admin role changes;
- a legal/compliance pack materially changes;
- a new canonical roadmap replaces an old one;
- a core money/fee policy changes;
- a new authority/partner workflow becomes active.

Do not turn this hub into another giant policy document.

Its job is to answer:

**“I am the Owner/Admin. Where do I go for the authoritative information I need right now?”**
