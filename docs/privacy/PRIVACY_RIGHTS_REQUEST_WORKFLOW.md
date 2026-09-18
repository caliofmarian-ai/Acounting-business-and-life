---
document_id: BL-PH-PRIVACY-RIGHTS-WORKFLOW-001
title: Privacy Rights Request Workflow
document_type: operational_privacy_workflow
status: IMPLEMENTED_TECHNICAL_WORKFLOW
country_code: PH
legal_outcome_authority: PENDING_CONTROLLER_PRIVACY_GOVERNANCE
version: 1.0
---

# Business & Life — Privacy Rights Request Workflow

## Purpose

Provide one authenticated, auditable technical path for a Business & Life account holder to submit a privacy/data-subject request without creating a separate Growth-specific case system.

This workflow reuses the canonical Support infrastructure.

It does **not** decide whether a requested legal remedy must be granted. The applicable right, verification, lawful exceptions and final controller/privacy decision remain separate.

## User path

Authenticated application user:

`Help -> New issue -> Privacy & data rights -> choose request type`

Supported request categories:

- `privacy_objection` — object to data processing / referral analytics;
- `privacy_access` — request access to personal data;
- `privacy_correction` — request correction;
- `privacy_erasure_blocking` — request erasure/blocking review;
- `privacy_other_request` — other privacy request.

The user may then:
- provide a subject and description;
- use the existing supported language / voice-to-text tools;
- attach evidence only where useful;
- see the ticket in My tickets;
- open the ticket;
- add user-visible follow-up messages.

## Identity minimization

An authenticated session supplies the initial account identity.

The UI explicitly tells users not to upload identity documents unless the reviewing team specifically requests necessary verification.

Do not request:
- passwords;
- authentication secrets;
- unrelated identity evidence;
- additional personal data merely because the request is privacy-related.

Additional verification must be purpose-specific and proportionate.

## Routing

Privacy categories are enforced server-side.

For a privacy request:

- `territory_id = NULL`;
- `requested_destination = country_admin`;
- `related_type = privacy_rights`;
- `related_id = NULL`;
- automatic tag `privacy_rights`;
- automatic tag equal to the privacy request category.

This routing means a privacy ticket does not fall into a Territory Admin-only queue.

The existing Support RBAC makes NULL-territory tickets visible to country-wide/platform administrators with `support.manage`, while ordinary Territory Admin visibility remains constrained to assigned territory IDs.

**Important:** routing to country-level administration is a technical queue design. It does not state that a Country Admin is automatically the Philippine PIC, DPO, legal representative or final decision-maker.

## Privacy of the case

The request owner may read their own ticket.

When a requester opens their own ticket, Support messages marked `visibility='internal'` are excluded. Internal Support/Admin notes remain private.

Another ordinary user cannot access the request because user ticket access is bound to `requester_account_id`.

Administrative access still requires the existing `support.manage` authority and scope checks.

## Request outcome

Submitting a request does not automatically mean:
- processing is unlawful;
- data must always be deleted;
- an objection must always be accepted;
- every record can be erased immediately;
- accounting/legal records are subject to the same outcome as referral analytics.

The reviewing controller/privacy function must determine the applicable response under the relevant Philippine privacy framework, product purpose, legal obligations and verified facts.

## Growth referral integration

If referral attribution/analytics is later activated under an approved legitimate-interest basis:

- `privacy_objection` is the canonical user request type for an objection to that processing;
- Growth must not treat marketing opt-out as a privacy objection automatically;
- Growth must not treat a privacy objection as withdrawal of unrelated legal acceptance, security notifications or payment/accounting processing;
- any automated suppression/deletion effect requires a separately approved implementation and controller policy.

This workflow establishes an auditable request channel. It does not yet automate deletion or suppression.

## Transparency boundary

The DRAFT referral Privacy Notice and LIA may state that an authenticated privacy-request workflow is technically available only after this implementation is production-verified.

They must not publish an invented DPO/controller name, address, email or response-time guarantee.

## Audit / evidence

Canonical evidence:
- Support ticket id;
- requester account id;
- privacy category;
- created/updated timestamps;
- user-visible messages;
- Support/Admin status;
- routing and tags;
- existing Admin audit events for privileged handling actions.

Do not duplicate the entire request into analytics.

## Future extension

When the real Philippine PIC/controller/privacy role and operating process are known, a future controlled slice may add:
- a dedicated privacy/DPO assignment or permission;
- service-level workflow;
- identity-verification state;
- structured decision/outcome codes;
- export/access response package;
- approved suppression/deletion automation;
- regulatory/complaint escalation where applicable.

Those features are not implied by this V1 technical request channel.
