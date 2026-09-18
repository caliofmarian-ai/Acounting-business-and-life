---
document_id: BL-GROWTH-OWNER-PILOT-POLICY-001
title: Owner Pilot Referral Policy Decision
document_type: owner_policy_decision
status: OWNER_APPROVED_PRODUCT_POLICY
country_code: PH
decision_date: 2026-09-18
runtime_activation: NONE
privacy_controller_approval: PENDING
version: 1.0
---

# Business & Life — Owner Pilot Referral Policy Decision

## Decision authority

Project Owner approved the recommended pilot referral policy set on 2026-09-18.

This record converts the prior decision brief into approved **product-policy direction**. It does not establish a Philippine lawful basis and does not activate production data processing that still requires privacy/controller/processor/runtime approval.

## 1. Converted attribution model — OWNER APPROVED

Selected model:

`registration_context_v1`

Meaning:
- a successful new account may be attributed only to the valid referral context carried in that actual registration journey;
- a valid unexpired pending attribution must already exist;
- self-referral remains rejected;
- a referred account may have only one converted attribution;
- same-referral retries remain idempotent;
- conflicting replacement attribution remains rejected.

Status:
- product-policy selection: **APPROVED**;
- runtime converted binding: **HOLD** pending remaining activation gates.

## 2. Converted-attribution retention — OWNER PRODUCT TARGET APPROVED

Selected product-policy target:

**12 months after conversion**

End-of-purpose behavior:
- delete the identifiable/pseudonymous converted-attribution record; or
- irreversibly aggregate/de-identify it where longer-term trend analysis remains justified;
- retain longer only where a documented lawful exception genuinely applies.

Important boundary:
- 12 months is a Business & Life product-policy target, not a statutory Philippine period;
- the runtime retention value remains unactivated until privacy/controller approval;
- no Railway retention variable is enabled by this decision.

Status:
- Owner product target: **APPROVED**;
- privacy/controller approval: **PENDING**;
- runtime activation: **HOLD**.

## 3. Lawful-basis path — OWNER DIRECTION APPROVED

Owner approved continuing the **legitimate-interest assessment path** for the Philippine privacy/controller review.

Canonical assessment:
`docs/growth/REFERRAL_LEGITIMATE_INTEREST_ASSESSMENT_DRAFT.md`

This means:
- prepare and complete the establishment/necessity/balancing analysis;
- identify the real Philippine PIC/controller;
- establish an objection/request workflow;
- integrate accurate wording into the EFFECTIVE privacy notice if legitimate interest is ultimately selected.

It does **not** mean:
- legitimate interest is already the lawful basis;
- `LAWFUL_BASIS_SELECTED=true`;
- converted attribution or external analytics may be activated now.

Canonical lawful-basis state remains:

`LAWFUL_BASIS_SELECTED = false`

until the actual controller/privacy approval is complete.

## 4. Referral rewards — OWNER APPROVED OFF FOR INITIAL PILOT

Initial pilot rewards:

`enabled = false`

No current pilot approval exists for:
- qualification rule;
- referrer reward;
- referred-user reward;
- reward amount/value;
- reward currency;
- reward cap;
- payout;
- reversal/dispute rule;
- reward accounting/tax classification;
- reward-evidence retention.

The live product must continue to say **Invite & Share**, not **Invite & Earn**.

A future reward program requires a separate explicit Owner decision and applicable legal/accounting/privacy review.

## 5. PostHog — OWNER APPROVED OFF UNTIL VERIFIED

External PostHog referral analytics remain OFF.

Activation requires all of:
- exact Business & Life PostHog account/organization;
- exact project;
- correct processing region and ingest host;
- verified project token;
- applicable processor/DPA/cross-border facts;
- real-event audit confirming no prohibited PII;
- privacy/controller gate completion.

The currently accessible unverified PostHog context must not be used as a substitute.

## 6. Existing unconverted decision remains

Unconverted identifiable/pseudonymous referral-event retention remains:

**90 days**

This prior Owner decision is unchanged.

## 7. Mechanical state after this decision

Approved product policy:
- `convertedAttribution.attributionModel = registration_context_v1`;
- converted retention target = `12_months_after_conversion`;
- initial-pilot rewards = OFF;
- lawful-basis workstream = legitimate-interest assessment;
- external PostHog = OFF pending exact project verification.

Still fail-closed:
- pending/durable referral persistence activation;
- converted account binding activation;
- external PostHog delivery;
- qualification;
- rewards;
- direct automated referral marketing.

## 8. Gates still required before converted attribution activation

All applicable gates must be complete:

1. complete factual controller allocation between the Project Owner and designated Philippine operator for the relevant processing, and verify the confirmed controller/controller-structure legal identity/contact for governance/publication;
2. treat any confirmed individual PIC as de facto DPO under current NPC guidance unless the operating structure changes;
3. controller/privacy approval of the processing purpose and lawful basis;
4. approved LIA if legitimate interest is selected;
5. EFFECTIVE privacy notice;
6. verified objection/data-subject request process;
7. exact calendar-month retention runtime matching the approved 12-month policy;
8. pending-attribution activation prerequisites;
9. dedicated HMAC secret;
10. explicit production activation variables;
11. regression/runtime evidence.

## 9. Gates still required before PostHog activation

In addition to applicable privacy/controller gates:

1. correct Business & Life PostHog organization/project;
2. correct region/host/token;
3. processor and cross-border facts;
4. event-property PII audit;
5. explicit `REFERRAL_ANALYTICS_PROJECT_VERIFIED=true`;
6. explicit analytics activation only after verification.

## 10. Non-activation statement

`OWNER_PRODUCT_POLICY_APPROVED = true`

`PRIVACY_CONTROLLER_ACTIVATION_APPROVED = false`

`POSTHOG_ACTIVATION_APPROVED = false`

`REWARD_ACTIVATION_APPROVED = false`

No broad activation is authorized by this record.

## 11. Technical retention preparation checkpoint

The runtime now has a fail-closed exact-calendar implementation for the Owner-approved target:
- required future config: `REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_MONTHS=12`;
- any different configured month count is rejected as a policy mismatch;
- expiry uses PostgreSQL calendar-month arithmetic (`INTERVAL '1 month'`);
- `retention_months` is stored as policy evidence;
- no production variable is enabled by this preparation.

Status remains: **prepared / privacy-controller activation HOLD**.

## 12. Initial Philippine operator/controller checkpoint

Owner designated a natural person in the Philippines as the initial Business & Life operator. Business & Life is not yet a formed Philippine legal entity. The operator is a provisional PIC candidate, but the Project Owner also has controller-level decision evidence in referral/growth processing. Final controller allocation must follow actual authority over purpose, data categories, retention, processors and material changes. Under current NPC guidance, any confirmed individual PIC is a de facto DPO. Legal name/contact and NPCRS applicability remain pre-launch verification items; do not publish placeholders.
