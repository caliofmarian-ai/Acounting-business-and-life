---
document_id: BL-GROWTH-OWNER-ACTIVATION-BRIEF-001
title: Referral Growth Activation Decision Brief
document_type: owner_decision_brief
status: OWNER_DECISION_RECORDED
country_code: PH
runtime_activation: NONE
version: 1.1
---

# Business & Life — Referral Growth Activation Decision Brief

## Purpose

This brief records the Project Owner's approved pilot product-policy direction and separates it from privacy/controller/processor activation gates that remain incomplete.

Nothing in this document activates:
- converted referral attribution;
- PostHog delivery;
- qualification;
- referral rewards;
- direct marketing.

Current technical state remains fail-closed.

Related activation issue: #203.

## Current implemented foundation

Already implemented and production-protected:
- one opaque account-level referral identity;
- profile-specific source/campaign context;
- public referral landing;
- local personalized QR;
- Promotion Center;
- Marketing Kit;
- 90-day pending/unconverted attribution architecture;
- HMAC-pseudonymized durable correlation;
- signup conversion context;
- self-referral rejection;
- one converted attribution per referred account;
- conflict/idempotency controls;
- explicit converted-retention gate;
- explicit converted-attribution-model gate;
- explicit PostHog-project-verification gate;
- rewards disabled by default;
- user-facing copy says **Invite & Share**, not **Invite & Earn**.

## Decision 1 — converted attribution model

Canonical current value:

`attributionModel = registration_context_v1`

### Option A — registration context

Implementation key:

`registration_context_v1`

Meaning:
- the referral context present in the registration journey is the attribution used when a new account is successfully created;
- a valid pending attribution must already exist;
- the referral cannot be replaced after the new account is already attributed.

Advantages:
- already implemented and tested;
- smallest additional tracking surface;
- no need to maintain a multi-touch journey history;
- simple to explain to users;
- deterministic anti-abuse behavior;
- suitable for a first pilot.

Limitations:
- it does not answer which referral was the very first touch if a person later follows another referral before registering;
- it does not implement a marketing-style multi-touch model.

### Option B — first touch

Meaning:
- the first valid referral observed for a prospective signup receives attribution even if another valid referral is later opened before registration.

Additional work required:
- durable first-touch preservation rules;
- cross-session identity/correlation design;
- expiry/replacement policy;
- additional privacy analysis.

Risk:
- more data/history must be retained;
- attribution may feel unfair if the final referrer directly caused the signup.

### Option C — last touch

Meaning:
- the last valid referral before registration receives attribution.

Additional work required:
- update/replacement state;
- overwrite/fraud rules;
- additional anti-gaming tests;
- privacy analysis for the touch history.

Risk:
- easier to game near signup;
- may overwrite a meaningful earlier referral.

### Owner decision for pilot — APPROVED PRODUCT POLICY

**Use `registration_context_v1` for the first pilot.**

Reason:
- it is already implemented;
- it uses the referral context directly present in the actual signup journey;
- it minimizes stored history;
- it is easy to audit and explain;
- the project can change policy later under a new version without rewriting historical attribution.

Project Owner approved this model on 2026-09-18. Runtime converted binding remains HOLD until the separate privacy/controller and activation gates are satisfied.

## Decision 2 — converted-attribution retention

Canonical current value:

`convertedAttributionRetentionRule = 12_months_after_conversion`

Project Owner approved **12 months after conversion** as the product-policy target. It is not a statutory Philippine period and is not yet approved for runtime activation by the privacy/controller gate.

### Candidate A — 90 days after conversion

Pros:
- strongest minimization;
- aligns with the existing unconverted window;
- low privacy/storage burden.

Cons:
- short support/dispute/fraud-analysis history;
- weak year-over-year cohort analysis.

### Candidate B — 6 months after conversion

Pros:
- middle ground for pilot/support analytics;
- lower data duration than a full year.

Cons:
- still may not support annual cohort comparison.

### Candidate C — 12 months after conversion

Pros:
- supports annual cohort/referral effectiveness analysis;
- provides a longer support/fraud-dispute investigation window;
- already documented in the existing retention brief as the design candidate.

Cons:
- greater privacy/storage burden;
- requires stronger necessity justification and periodic review.

### Owner product target — APPROVED; privacy/controller activation still HOLD

Retain **12 months after conversion** as the Owner-approved product-policy target, then delete or irreversibly aggregate/de-identify the converted attribution when the purpose ends, subject to the final controller/privacy assessment.

This remains a product-policy target, not a statutory Philippine retention period and not an activation instruction.

## Decision 3 — lawful-basis path

Canonical state:

`referralAnalyticsLawfulBasis = TO_BE_CONFIRMED`

The repository now includes:

`docs/growth/REFERRAL_LEGITIMATE_INTEREST_ASSESSMENT_DRAFT.md`

Current draft result:

`PENDING_CONTROLLER_APPROVAL`

### Path A — assess legitimate interest

Potential product fit:
- pseudonymous referral attribution;
- acquisition measurement;
- duplicate/self-referral prevention;
- no raw contact-list analytics;
- explicit minimization and retention controls.

Required before selection:
- identify the actual Philippine PIC/controller;
- approve the establishment/necessity/balancing tests;
- verify reasonable user expectations;
- establish objection handling;
- integrate the basis and purpose into the effective privacy notice.

### Path B — consent where required/selected

Would require:
- explicit consent UX and evidence;
- purpose-specific language;
- withdrawal/objection consequences;
- ensuring referral attribution does not accidentally become mandatory for unrelated account creation.

### Decision boundary

The Project Owner approved **pursuing** the legitimate-interest path for controller/privacy review.

That does not by itself establish the legal basis. The final controller/privacy approval and effective notice remain mandatory.

## Decision 4 — reward launch

Canonical state:

`status = disabled_for_initial_pilot_owner_approved`

There is currently:
- no qualification rule;
- no referrer reward;
- no referred-user reward;
- no reward value;
- no reward currency;
- no reward cap.

### Option A — keep rewards OFF during the first pilot

Benefits:
- measures organic referral behavior first;
- avoids reward fraud and accounting complexity;
- avoids promising benefits before payout/accounting/tax treatment is known;
- lets the platform collect baseline sharing/conversion evidence.

### Option B — activate a non-cash benefit later

Examples already allowed as candidates in policy design:
- feature credit;
- platform-fee credit;
- promotion boost;
- non-cash ambassador status.

Still requires explicit value/rules/caps and legal/accounting review.

### Option C — monetary reward later

Requires:
- explicit reward amount/currency;
- qualification criteria;
- caps;
- reversal/dispute rules;
- payment/payout integration;
- accounting/tax classification;
- reward-evidence retention.

### Owner decision for pilot — APPROVED OFF

**Rewards are OFF for the initial pilot by Owner decision.**

The live product now correctly says **Invite & Share**, so referral behavior can be tested without an implied payment promise.

## Decision 5 — PostHog project

Current state:

**HOLD / project not verified**

Do not enable external referral analytics until the actual Business & Life PostHog destination is verified.

Required:
- correct account/organization;
- correct project;
- correct US/EU region and ingest host;
- project token;
- processor/DPA/cross-border facts;
- real-event property audit confirming no prohibited PII.

The current connected PostHog context must not be used merely because it is technically accessible.

## Approved pilot product-policy set

Project Owner approved the following product-policy direction for the first pilot:

1. attribution model: `registration_context_v1`;
2. converted retention: **12 months after conversion** as the Owner product target, pending privacy/controller activation approval;
3. lawful-basis workstream: continue the legitimate-interest assessment, without declaring it approved;
4. rewards: OFF;
5. PostHog: OFF until the correct Business & Life project is connected and verified.

This set minimizes new implementation and prevents reward/analytics dependencies from blocking basic referral-flow testing.

## What Owner approval would and would not do

Owner approval has selected the product-policy direction for:
- attribution model;
- retention candidate;
- reward launch strategy.

Owner approval alone does **not** substitute for:
- the actual PIC/controller lawful-basis determination;
- effective privacy notice publication;
- processor/cross-border verification;
- technical verification of the correct PostHog project.

## Activation rule

Even after an Owner product decision is recorded, production variables remain OFF until every required legal/privacy/processor/runtime gate for that function is satisfied and verified.

No broad "turn everything on" action is permitted.

## Decision record

Canonical approval record: `docs/growth/OWNER_PILOT_POLICY_DECISION.md`.

Owner product policy is recorded, but runtime activation remains fail-closed until the separate privacy/controller/processor/runtime gates are verified.
