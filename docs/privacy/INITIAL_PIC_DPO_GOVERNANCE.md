---
document_id: BL-PH-PRIVACY-CONTROLLER-001
title: Initial Philippine PIC and DPO Governance
document_type: privacy_governance_record
status: CONTROLLED_PRE_LAUNCH_RECORD
country_code: PH
public_notice_status: NOT_READY
version: 1.0
---

# Business & Life — Initial Philippine PIC and DPO Governance

## 1. Operating identity

Current product/operating name:

**Business & Life**

Current Philippine legal-entity state:

**NOT YET FORMED**

The initial Philippine operator is a natural person designated by the Project Owner.

This repository intentionally does not invent or publish:
- the operator's legal name;
- home/business address;
- public privacy email;
- registration number;
- DPO registration number.

Those facts must be supplied and verified before they are used in an EFFECTIVE public Privacy Notice or regulatory registration.

## 2. Provisional PIC structure

The initial operator is the provisional PIC candidate only if that person actually controls the relevant personal-data processing decisions for Business & Life.

The controller conclusion must follow the real operating facts.

If another person/entity actually determines or jointly determines the relevant processing decisions, do not keep the initial-operator PIC assumption merely because it was convenient during development.

Current machine-readable status:

`pic.status = provisional_candidate_pending_actual_control_confirmation`

`pic.activationApproved = false`

## 3. Individual PIC and DPO

National Privacy Commission guidance states that an individual PIC or PIP is a **de facto Data Protection Officer (DPO)**.

Official NPC guidance:
https://privacy.gov.ph/appointing-a-data-protection-officer/

Therefore, if the initial natural-person operator is confirmed as the individual PIC:
- that same person is the de facto DPO at that stage;
- this project must not invent a second DPO merely to fill a document field;
- an official/dedicated privacy or DPO contact still needs to be established where required for public notice, NPC registration and operational handling;
- DPO responsibilities must actually be performed, not only named.

This corrects any earlier project wording that suggested the individual PIC necessarily needed a separate person to be DPO.

## 4. DPO responsibilities relevant to Business & Life

The NPC identifies DPO responsibilities that include:
- monitoring privacy-law and NPC compliance;
- maintaining awareness of processing activities;
- supporting/ensuring Privacy Impact Assessments where appropriate;
- advising on data-subject complaints and rights requests;
- data-breach/security-incident governance;
- privacy-awareness and policy development;
- acting as privacy contact with data subjects/NPC/other authorities.

The current product has a production-verified privacy-rights request channel through canonical Support, but the final controller/DPO operating process is still pending.

Technical workflow:
`docs/privacy/PRIVACY_RIGHTS_REQUEST_WORKFLOW.md`

## 5. NPC registration assessment

Current canonical status:

`NPC_REGISTRATION_STATUS = ASSESSMENT_REQUIRED_BEFORE_PUBLIC_LAUNCH`

Do not label registration "mandatory" or "not required" merely because Business & Life is small at the beginning.

NPC Circular No. 2022-04 provides mandatory-registration conditions including:
- 250 or more persons employed by the PIC/PIP;
- processing sensitive personal information of 1,000 or more individuals;
- processing likely to pose a risk to the rights and freedoms of data subjects;
- Data Processing Systems involving automated decision-making or profiling, which have a specific all-instances registration rule.

Official NPC source:
https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf

The current Business & Life product has multiple processing domains, so the launch assessment must use the actual final data inventory and feature set rather than only expected user count.

## 6. Registration timing / process boundary

If Business & Life is determined to be covered by mandatory NPC registration, the project must follow the then-current NPCRS requirements and timing.

Current NPC registration information:
https://privacy.gov.ph/pips-and-pics/register/

Current NPC registration FAQ:
https://privacy.gov.ph/pips-and-pics/faqs/

Do not hardcode an NPCRS registration id, certificate number or official DPO contact before they exist.

## 7. Transition to a future Business & Life legal entity

If a Philippine legal entity named/using Business & Life is later formed and becomes the entity controlling the relevant personal-data processing:

1. record the entity's exact registered legal name and registration details;
2. determine whether controller responsibility transfers from the natural person to the entity;
3. update the controller/DPO record;
4. update the Privacy Notice and processor/vendor contracts as necessary;
5. update NPC registration information where required;
6. version the transition so historical processing responsibility remains auditable.

Do not silently rewrite history as though the company existed before incorporation.

## 8. Public Privacy Notice gate

The EFFECTIVE Privacy Notice is **not ready** to publish controller identity until all required facts are verified.

At minimum, before controller/DPO details are presented as facts:
- actual controller decision-making structure is confirmed;
- legal name of the responsible natural person or future entity is verified;
- official privacy/DPO contact is established;
- applicable NPC registration assessment is complete;
- any required registration facts are available;
- privacy/controller approval has occurred.

Placeholders such as "[DPO name]" or fake addresses/emails must not be published as if real.

## 9. Current decision state

`BUSINESS_NAME = Business & Life`

`LEGAL_ENTITY_FORMED = false`

`INITIAL_OPERATOR_TYPE = natural_person`

`INITIAL_OPERATOR_LEGAL_NAME = null`

`PIC = provisional_initial_operator_candidate`

`INDIVIDUAL_PIC_DPO_RULE = de_facto_DPO`

`NPC_REGISTRATION_STATUS = assessment_required_before_public_launch`

`PUBLIC_CONTROLLER_IDENTITY_READY = false`

## 10. Registration-assessment checkpoint

A dedicated trigger-by-trigger assessment is maintained at:
- `docs/privacy/NPC_REGISTRATION_ASSESSMENT_DRAFT.md`;
- `privacy/npc-registration-assessment.json`.

Current final registration decision: **PENDING**.

This does not block continued development, but it is a public-launch gate if unresolved when live Philippine personal-data processing is ready to begin.
