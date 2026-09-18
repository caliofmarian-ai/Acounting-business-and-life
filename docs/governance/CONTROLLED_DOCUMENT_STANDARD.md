---
document_id: BL-20-GLB-DOCSTD-001
title: Controlled Document Standard
document_type: governance_standard
status: DRAFT
access_class: OPERATIONS_PRIVATE
applicable_profiles: []
applicable_functions: [Documentation Governance Owner, Super Admin, Country Admin]
country_code: GLB
territory_scope: global
owner_role: Documentation Governance Owner
approver_role: Project Owner
version: 1.0
legal_classification: PLATFORM_POLICY
---

# Controlled Document Standard

Status: **CANONICAL V1**
Parent: `docs/governance/DOCUMENTATION_SYSTEM.md`

## Purpose

Define how Business & Life controlled documents are named, reviewed, approved, published, superseded and audited.

## Document IDs

Format:

```text
BL-<DOMAIN>-<COUNTRY/GLB>-<TYPE>-<NNN>
```

Examples:

- `BL-30-GLB-JD-001` — Job description
- `BL-40-PH-SOP-001` — Philippines SOP
- `BL-50-PH-LEGAL-001` — Philippines legal note
- `BL-120-PH-FORM-001` — Philippines form/template
- `BL-130-GLB-PITCH-001` — Global pitch

Do not recycle a retired ID for a different subject.

## Versioning

Use semantic document versioning:

- MAJOR — policy/procedure meaning changes;
- MINOR — meaningful additions/clarifications;
- PATCH — editorial/format correction without operational meaning change.

## Status rules

### DRAFT
Authoring only. Not binding.

### IN_REVIEW
Submitted to designated reviewer.

### APPROVED
Approval granted but future effective date may still apply.

### EFFECTIVE
Current authoritative version.

### SUPERSEDED
Replaced by another effective version.

### RETIRED
No longer applicable and has no direct replacement.

## Controlled-change record

Every effective controlled document must retain:

- version;
- change summary;
- author;
- reviewer;
- approver;
- approval date;
- effective date;
- next review date;
- superseded version;
- source changes if legal/compliance content changed.

## Review cadence

The document owner sets the review cadence.

High-change or legally sensitive documents should have shorter review intervals than stable explanatory material.

A review date is a control reminder; it does not automatically mean the underlying law/policy changed.

## Legal/compliance change

For legal/compliance documents:

- re-open source verification;
- confirm official authority/source;
- record effective date;
- compare previous interpretation;
- update impacted SOPs/forms/training;
- mark dependent documents for review.

## Publication

Public publication must be generated only from content approved for `PUBLIC`.

Internal documents must not become public because a file happens to be in the same repository.

## Acknowledgement

When a role is required to acknowledge a controlled document, record:

- account id;
- document id;
- version;
- effective version acknowledged;
- timestamp;
- acknowledgement statement/version;
- optional device/session evidence if policy permits.

A new MAJOR version may require renewed acknowledgement.

## Supersession

A superseded document remains auditable.

Public/private interfaces should default to the current EFFECTIVE version and clearly label archived versions.

## Emergency temporary instruction

A temporary emergency instruction must include:

- issuer;
- authority basis;
- scope;
- start;
- expiry;
- reason;
- affected SOP/policy;
- required follow-up.

Temporary instructions must not silently become permanent policy.
