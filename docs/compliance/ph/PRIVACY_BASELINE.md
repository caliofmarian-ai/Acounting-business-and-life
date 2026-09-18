---
document_id: BL-50-PH-PRIV-001
title: Philippines Privacy Compliance Baseline
document_type: legal_note
status: DRAFT
access_class: OPERATIONS_PRIVATE
country_code: PH
territory_scope: national
owner_role: Documentation Governance Owner
approver_role: Country Admin
version: 1.0
legal_classification: OPERATIONAL_INTERPRETATION
---

# Philippines Privacy Compliance Baseline

## Official basis

Primary source families:
- Republic Act No. 10173 / Data Privacy Act;
- DPA Implementing Rules and Regulations;
- NPC registration/compliance guidance;
- NPCRS FAQ / NPC Circular 2022-04.

## Platform design implications

Business & Life should preserve:
- specified legitimate purposes;
- data minimization;
- role/business access boundaries;
- private incident evidence;
- private CV/credential evidence;
- purpose-limited Courier location;
- no unnecessary PII in analytics;
- private generated documents outside public GitHub.

## PIC/PIP/DPO/DPS assessment

NPC's January 2026 FAQ explains mandatory-registration triggers under NPC Circular 2022-04.

Current operator facts:
- working/operating name: **Business & Life**;
- Philippine legal entity: **not yet formed**;
- initial Philippine operator: **natural person designated by the Project Owner**;
- operator legal name/contact: **pending verification**.

PIC treatment:
- the initial operator is the provisional PIC candidate only if that person actually controls the relevant Business & Life personal-data processing decisions;
- if confirmed as an individual PIC, NPC guidance treats the individual PIC as the de facto DPO;
- do not invent a separate DPO merely to fill a document field.

Business & Life must still perform an operator-specific NPCRS/DPS determination using:
- employee count;
- sensitive-personal-information volume;
- risk to data-subject rights/freedoms;
- automated decision-making/profiling applicability;
- PIC/PIP status for each processing system.

Current status:
`NPC_REGISTRATION_STATUS = ASSESSMENT_REQUIRED_BEFORE_PUBLIC_LAUNCH`.

Do not hard-code either "registration not required" or "registration mandatory" until this assessment is performed.

## Documents required before pilot

Develop:
- privacy notice;
- internal data-handling/privacy policy;
- processing/data inventory;
- access-control matrix;
- incident/breach procedure;
- retention/deletion standard;
- processor/vendor register;
- DPO/registration assessment;
- data-subject-rights procedure;
- consent/legal-basis map.

Only documents explicitly classified PUBLIC may appear in the public Help Center.

Canonical controller/DPO record: `docs/privacy/INITIAL_PIC_DPO_GOVERNANCE.md` and `privacy/controller-profile.json`.

## NPC registration assessment artifact

Controlled pre-launch assessment:
`docs/privacy/NPC_REGISTRATION_ASSESSMENT_DRAFT.md`

Machine-readable state:
`privacy/npc-registration-assessment.json`

The current result is **PENDING**. Development may continue, but public launch must not proceed with the applicability decision unresolved.
