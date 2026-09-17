---
document_id: BL-60-PH-AUTHMAT-001
title: Philippines Profile / Function Authorization Matrix
document_type: authorization_matrix
status: DRAFT
access_class: OPERATIONS_PRIVATE
country_code: PH
territory_scope: national
owner_role: Compliance / Credential Reviewer
approver_role: Country Admin
version: 1.0
legal_classification: OPERATIONAL_INTERPRETATION
---

# Philippines Profile / Function Authorization Matrix

Legend:
- BASELINE — source-supported general requirement family.
- CONDITIONAL — depends on activity/entity/territory.
- PLATFORM — Business & Life policy/authorization.
- RESEARCH — do not enforce as legal requirement yet.

| Profile / function | Platform gate | Entity/business registration | BIR | LGU | Professional credential | Vehicle/driver | Privacy/evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer | self-service account | normally N/A for consumer use | N/A | N/A | N/A | N/A | BASELINE | activity-specific rules may still apply |
| Merchant | PLATFORM invite/approval | CONDITIONAL/BASELINE | CONDITIONAL/BASELINE | CONDITIONAL by LGU | CONDITIONAL by activity | normally N/A | BASELINE | sector permits RESEARCH |
| Supplier | PLATFORM invite/approval | CONDITIONAL/BASELINE | CONDITIONAL/BASELINE | CONDITIONAL by LGU | CONDITIONAL by activity/product | only if transport activity | BASELINE | product/sector permits RESEARCH |
| Courier — bicycle | PLATFORM eligibility | operating-model dependent | operating-model dependent | operating-model dependent | normally not PRC by default | LTO motor-vehicle docs not applicable; local rules RESEARCH | BASELINE + location privacy | delivery classification RESEARCH |
| Courier — motorbike/car/van | PLATFORM eligibility | operating-model dependent | operating-model dependent | operating-model dependent | normally not PRC by default | LTO source family BASELINE, exact class CONDITIONAL | BASELINE + location privacy | LTFRB applicability RESEARCH |
| Service Provider | PLATFORM/category approval | CONDITIONAL if operating business | CONDITIONAL | CONDITIONAL | PRC/TESDA CONDITIONAL by category | activity-specific | BASELINE + CV/evidence privacy | category regulator RESEARCH |
| Support Agent | PLATFORM staff/admin authorization | operator/entity | operator/entity | operator/entity | role training | N/A | PRIVILEGED | employment rules separate |
| Compliance Reviewer | PLATFORM privileged authorization | operator/entity | operator/entity | operator/entity | expertise/training | N/A | HIGH CONFIDENTIALITY | source-registry discipline |
| Territory Admin | PLATFORM privileged authorization | operator/entity | operator/entity | territory operations | admin training/delegation | N/A | HIGH CONFIDENTIALITY | local authority interaction |
| Country Admin | PLATFORM privileged authorization | operator/entity | operator/entity | country/LGU coordination | admin training/delegation | N/A | HIGH CONFIDENTIALITY | national compliance oversight |

## Executable-gate rule

A legal/compliance requirement may become an application gate only when:

1. profile/activity/territory is identified;
2. official source is recorded;
3. legal classification is clear;
4. evidence is defined;
5. effective/review date is recorded;
6. reviewer role is defined;
7. exception/escalation is defined.

## Separate checks

Merchant platform approval is not equivalent to:
- DTI / SEC / CDA registration;
- BIR registration;
- LGU Business/Mayor's Permit;
- sector-specific permit.

The UI must not collapse these into one green check mark.
