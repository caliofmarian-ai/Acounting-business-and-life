---
document_id: BL-130-GLB-CLAIM-001
title: Pitch Claim / Evidence Register
document_type: claim_registry
status: DRAFT
access_class: OPERATIONS_PRIVATE
country_code: GLB
territory_scope: global
owner_role: Documentation Governance Owner
approver_role: Executive
version: 1.0
legal_classification: OPERATIONAL_INTERPRETATION
---

# Pitch Claim / Evidence Register

Before external publication, every material claim should map to evidence.

| Claim family | Example allowed wording | Evidence source | Forbidden shortcut |
| --- | --- | --- | --- |
| Product | "The current product includes Merchant/Supplier business-scoped accounting foundations." | merged repo/runtime/tests | calling a DESIGN feature live |
| Pilot | "We intend to run a controlled local Philippines pilot." | Masterplan/roadmap | claiming an LGU-approved pilot without approval |
| Compliance | "We maintain an official-source compliance registry." | SOURCE_REGISTRY.md | claiming full legal compliance |
| Authority | "We are seeking guidance/coordination." | authority pack/contact log | implying endorsement |
| Revenue | "The architecture supports configurable fee families." | Masterplan/design docs | claiming activated revenue without evidence |
| Traction | measured figure only | analytics/finance evidence | invented users/GMV/growth |
| Partnership | "In discussion with..." only when true/authorized | CRM/agreement/contact record | displaying partner logo/name as active without consent |
| Security/privacy | describe implemented controls precisely | code/policy/audit | blanket "100% secure" |
| Legal | quote/paraphrase verified source with jurisdiction/date | compliance source registry | unsupported legal conclusion |

## Publication gate

External pitch material should pass:
1. current-versus-planned check;
2. claim/evidence review;
3. confidentiality review;
4. legal/compliance review where needed;
5. commercial-terms approval;
6. audience-specific approval.
