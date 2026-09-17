---
document_id: BL-120-PH-REG-001
title: Business & Life Form / Generated Document Registry
document_type: template_registry
status: DRAFT
access_class: OPERATIONS_PRIVATE
country_code: PH
territory_scope: national
owner_role: Documentation Governance Owner
approver_role: Project Owner
version: 1.0
legal_classification: TEMPLATE_GUIDANCE
---

# Business & Life — Form / Generated Document Registry

## Purpose

Register every controlled template the application may later generate from verified profile/business data.

Templates are source-controlled. Filled private instances are not public GitHub content.

## Template families

| Template ID | Title | Access | Intended user | Generation source | Signature/ack | Government-issued? |
| --- | --- | --- | --- | --- | --- | --- |
| BL-120-PH-FORM-001 | Role / Profile Acknowledgement | PROFILE_PRIVATE | profile or internal role holder | account + role + document version | acknowledgement | No |
| BL-120-PH-FORM-002 | Internal Role Assignment Letter | OPERATIONS_PRIVATE | internal role holder | role assignment + authority scope | issuer + holder | No |
| BL-120-PH-FORM-003 | Platform Authorization Status Summary | PROFILE_PRIVATE | approved profile holder | authorization/evidence state | issuer optional | No |
| BL-120-PH-FORM-004 | Compliance Requirement Checklist | PROFILE_PRIVATE | profile/business | requirement engine | acknowledgement optional | No |
| BL-120-PH-FORM-005 | Evidence Submission Index | PROFILE_PRIVATE | profile/business | uploaded evidence metadata | submitter | No |
| BL-120-PH-FORM-006 | Training Completion Record | PROFILE_PRIVATE | role/profile holder | training records | trainer + participant | No |
| BL-120-PH-FORM-007 | Business Profile Sheet | BUSINESS_PRIVATE | Merchant/Supplier business | business workspace data | business owner | No |
| BL-120-PH-FORM-008 | Accounting Evidence Cover Sheet | BUSINESS_PRIVATE | authorized finance user | accounting/report period | preparer/reviewer | No |
| BL-120-PH-FORM-009 | Authority Cover Letter | OPERATIONS_PRIVATE | Admin/authorized entity | authority pack | authorized signatory | No |
| BL-120-PH-FORM-010 | Pilot / Project Brief | OPERATIONS_PRIVATE | authority/partner meeting | canonical product/masterplan extracts | issuer | No |
| BL-120-PH-FORM-011 | Document Submission Index | OPERATIONS_PRIVATE | authority submission | selected docs/evidence | submitter | No |
| BL-120-PH-FORM-012 | Authority Meeting Brief | OPERATIONS_PRIVATE | internal meeting team | authority/contact/context | owner | No |
| BL-120-PH-FORM-013 | Meeting Minutes | OPERATIONS_PRIVATE | meeting participants | meeting record | recorder/reviewer | No |
| BL-120-PH-FORM-014 | Authority Follow-up Letter | OPERATIONS_PRIVATE | authorized Admin | meeting/submission record | signatory | No |
| BL-120-PH-FORM-015 | Internal Compliance Review Report | OPERATIONS_PRIVATE | reviewer/Admin | evidence + source registry | reviewer | No |
| BL-120-PH-FORM-016 | Incident Case Summary | OPERATIONS_PRIVATE | authorized incident/admin | incident timeline | reviewer | No |

## Internal "certificate"/attestation naming rule

Business & Life may generate an internal status certificate/attestation only when its title clearly identifies the issuer.

Allowed:
- "Business & Life Platform Authorization Status Summary"
- "Business & Life Training Completion Record"
- "Business & Life Internal Compliance Review"

Do not use wording/layout that falsely implies:
- DTI certificate;
- BIR certificate;
- LGU permit;
- PRC licence;
- TESDA National Certificate;
- LTO/LTFRB authority;
- notarization;
- government seal/signature.

## Instance metadata

Every generated instance should support:

- document_instance_id;
- template_id;
- template_version;
- generated_at;
- generated_by_role/account;
- subject account/business/profile;
- country/territory;
- source data snapshot identifiers;
- status;
- expiry if applicable;
- acknowledgement/signature state;
- superseding instance;
- verification token/QR only if implemented;
- content hash only if implemented.

## Storage rule

Template source:
- GitHub.

Generated public instance:
- public storage only if template classification explicitly permits.

Generated private instance:
- secured runtime storage with access/audit controls.

## Official authority-form rule

If a government authority provides a mandatory official form:
1. register the official form/source/version;
2. preserve mandatory legal wording/layout;
3. map app data only where appropriate;
4. label the resulting document as the authority's form, not a Business & Life-created substitute;
5. retain source/version evidence;
6. do not invent an official-form field or approval.
