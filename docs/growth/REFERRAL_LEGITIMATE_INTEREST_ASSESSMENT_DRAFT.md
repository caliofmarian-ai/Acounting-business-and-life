---
document_id: BL-GROWTH-PH-REFERRAL-LIA-DRAFT-001
title: Referral Attribution Legitimate Interest Assessment
document_type: legitimate_interest_assessment
status: DRAFT
publication_status: NOT_FOR_PUBLICATION
country_code: PH
scope: referral_attribution_and_growth_analytics
legal_basis_candidate: legitimate_interest
legal_basis_selected: false
controller_approval: REQUIRED
legal_privacy_review: REQUIRED
version: 1.0
---

# Business & Life — Referral Attribution Legitimate Interest Assessment (DRAFT)

> **Controlled draft — NOT FOR PUBLICATION / NOT AN APPROVED LAWFUL BASIS.**
>
> This document prepares the assessment required if the future Philippine Personal Information Controller (PIC) considers legitimate interest under Section 12(f) of Republic Act No. 10173 for pseudonymous referral attribution and acquisition analytics.
>
> It does not activate referral persistence, PostHog delivery, qualification, rewards, direct marketing, profiling, or any production environment variable.

Verified product state: 2026-09-18.

## 1. Processing activity being assessed

Candidate processing activity:

- recognize that a visitor arrived through an opaque Business & Life referral link or locally generated QR;
- record privacy-minimized referral journey signals;
- prevent obvious duplicate or self-referral attribution;
- associate a successful registration with the valid referral context that led into registration, **only if converted attribution is later approved**;
- measure referral acquisition effectiveness using pseudonymous identifiers and bounded campaign metadata.

This assessment does **not** cover:
- automated contact-list upload;
- direct automated marketing;
- sensitive personal information;
- operational-profile approval;
- Admin authority;
- qualification/reward economics;
- payment/accounting evidence;
- unrelated behavioral profiling.

## 2. Official legal framework

### Republic Act No. 10173 — Data Privacy Act of 2012

Official NPC source:
https://privacy.gov.ph/data-privacy-act/

Relevant requirements include:

- Section 11: transparency, legitimate purpose and proportionality;
- collection for specified and legitimate purposes;
- adequate and non-excessive processing;
- retention only for as long as necessary for the declared purpose, legitimate business purpose, legal claims, or applicable law;
- Section 12: at least one lawful criterion is required for processing personal information;
- Section 12(f): legitimate interests may be a lawful criterion where the controller/third-party interest is not overridden by the data subject's fundamental rights and freedoms;
- Section 14: outsourcing does not remove the controller's responsibility for safeguards.

### NPC Circular No. 2023-07 — Guidelines on Legitimate Interest

Official NPC source:
https://privacy.gov.ph/wp-content/uploads/2024/01/NPC-Circular-No.-2023-07_Guidelines-on-Legitimate-Interest_13-December-2023.pdf

The Circular requires:
1. establishment of an actual and real legitimate interest;
2. a necessity and lawfulness test;
3. a balancing test against data-subject rights and freedoms;
4. transparency;
5. documentation of the legitimate-interest assessment.

### Implementing Rules and Regulations

Official NPC source:
https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/

Relevant principles include:
- purpose specification;
- proportionality;
- clear/plain transparency;
- processor contracts;
- controller accountability for domestic or international transfers.

### NPC Circular No. 2023-06 — Security of Personal Data

Official NPC overview:
https://privacy.gov.ph/npc-issues-circulars-to-strengthen-personal-data-protection-in-ph/

Relevant controls include security governance, storage for the necessary duration, disposal/records management and appropriate organizational/technical safeguards.

## 3. Test A — establish the legitimate interest

### Candidate interest

Business & Life may have an actual business interest in:
- understanding whether user-initiated referrals result in account acquisition;
- preventing duplicate or obviously abusive attribution;
- measuring the effectiveness of referral channels/campaign contexts;
- supporting referral-attribution disputes if a reward program is later approved.

### Preliminary finding

**POTENTIALLY ESTABLISHED — CONTROLLER CONFIRMATION REQUIRED.**

The interest is concrete and related to operation/growth of the referral feature, but the actual Philippine PIC/controller must confirm the declared purpose before relying on it.

The interest must not be expanded into unrelated tracking merely because the data exists.

## 4. Test B — necessity and lawfulness

### Data minimization already designed

Current implementation minimizes data by using:
- opaque account-level referral code;
- bounded campaign/source/profile metadata;
- local QR generation;
- session-scoped correlation id for browser instrumentation;
- HMAC-SHA256 pseudonymous correlation for durable pending/converted attribution;
- no raw browser correlation id in attribution tables;
- no raw email/phone/recipient/contact-list data in referral analytics;
- no referral-derived operational permissions.

### Why aggregate-only analytics may be insufficient

Pure aggregate counts may answer high-level campaign performance, but they cannot by themselves:
- enforce one converted attribution per referred account;
- detect self-referral after a new account is created;
- resolve conflicting attribution;
- support idempotent signup conversion binding.

The current design therefore uses a narrowly scoped server-side association only for those functions, behind explicit activation gates.

### Less intrusive means considered

- raw email/phone matching: rejected as unnecessary for referral attribution;
- third-party QR generation: rejected; QR is local;
- browser fingerprinting: not part of the design;
- address-book ingestion: prohibited;
- indefinite identifiers: prohibited by retention gates;
- automatically creating PostHog person profiles: disabled in transport design.

### Preliminary finding

**POTENTIALLY NECESSARY / PROPORTIONATE — CONTROLLER CONFIRMATION REQUIRED.**

The PIC must still document why each enabled data field is necessary for the exact declared purpose at activation time.

## 5. Test C — balancing against rights and freedoms

### Factors reducing impact

- referral sharing is user-initiated;
- referral identity is opaque and account-level;
- referral does not grant privileged capability;
- raw contact-list data is excluded;
- public analytics properties are allowlisted;
- pending attribution is designed for a fixed 90-day period;
- converted attribution has no default retention period and remains disabled;
- PostHog delivery is fail-closed;
- PostHog person-profile creation is disabled in the transport contract;
- self-referral/duplicate controls avoid unnecessary duplicate records;
- expired records have deletion/aggregation boundaries.

### Residual risks

- a converted referral record links two internal account identifiers;
- campaign/profile source metadata may reveal user activity within the product;
- external analytics would introduce a processor and possibly cross-border processing;
- users may not reasonably expect durable attribution unless the privacy notice explains it;
- the ability to object must be operationally supported if legitimate interest is selected;
- future rewards may materially change purpose, retention and risk.

### Reasonable expectations

A user intentionally following a referral link may reasonably expect the link to identify the referral source. Durable converted attribution and external analytics require clearer notice because they continue beyond the initial page visit.

### Preliminary finding

**BALANCING NOT YET APPROVED.**

The current safeguards lower impact, but the final PIC must confirm user expectations, transparency wording, objection handling, retention and processor facts before activation.

## 6. Transparency and right to object

If legitimate interest is selected, the effective privacy notice must clearly disclose, as applicable:
- responsible Philippine PIC/controller;
- specific referral-attribution purpose;
- legitimate interest relied upon;
- data categories;
- recipients/processors;
- retention period/criteria;
- international/cross-border processing facts;
- rights and how to object;
- verified privacy/DPO contact.

NPC information on the right to object:
https://privacy.gov.ph/right-to-object/

The product must not claim that an objection can be handled if no verified operational process exists.

## 7. PostHog processor gate

External PostHog delivery remains separate from the lawful-basis assessment.

Before PostHog activation, verify:
- actual Business & Life PostHog account/organization/project;
- region and ingest host;
- processor identity and contractual/DPA terms;
- categories of data sent;
- hosting/subprocessor/cross-border facts;
- retention/deletion configuration;
- actual event properties through a PII audit.

The currently connected PostHog context is not accepted as verified Business & Life destination evidence.

## 8. Retention

### Unconverted referral events

Canonical Owner decision:
**90 days.**

This assessment does not change that value.

### Converted attribution

Canonical state:
**UNRESOLVED / HOLD.**

No duration is approved by this assessment.

A duration must be justified by the chosen purpose and periodically reviewed. At expiry, delete or irreversibly aggregate/de-identify unless a documented exception applies.

### Reward evidence

Canonical state:
**HOLD.**

Do not reuse ordinary referral-analytics retention for future financial/accounting reward records.

## 9. Direct marketing separation

This assessment is for referral attribution/acquisition analytics only.

It does not authorize:
- unsolicited direct marketing;
- automatic email/SMS sending;
- automated posting to groups;
- contact-list uploads.

Marketing preferences/consent remain separate where required.

## 10. Decision matrix

| Requirement | Current state |
| --- | --- |
| Actual legitimate interest articulated | DRAFT candidate |
| Necessity/proportionality analysis | DRAFT candidate |
| Balancing test | PENDING controller approval |
| PIC/controller identified | PENDING |
| Effective privacy notice | PENDING |
| Objection workflow | PENDING operational verification |
| 90-day unconverted retention | OWNER APPROVED |
| Converted retention | HOLD |
| Converted attribution model | HOLD / null |
| Correct PostHog project | HOLD / unverified |
| PostHog processor/cross-border facts | HOLD |
| Reward purpose/economics | HOLD |

## 11. Draft outcome

`LIA_OUTCOME = PENDING_CONTROLLER_APPROVAL`

`LAWFUL_BASIS_SELECTED = false`

No production flag may be enabled solely because this draft exists.

## 12. Activation checklist

Before legitimate interest can be recorded as the selected basis for this processing activity:

1. identify the actual Philippine PIC/controller;
2. confirm the exact declared referral-attribution purpose;
3. complete/approve the legitimate-interest, necessity and balancing tests;
4. decide converted-attribution model;
5. decide converted-attribution retention/deletion;
6. establish the objection/request workflow;
7. integrate accurate wording into the EFFECTIVE privacy notice;
8. verify any external processor/project/region and data-processing terms;
9. perform product/privacy/security review;
10. record Project Owner and privacy/controller approval;
11. only then configure the corresponding activation gates.

Until then, durable converted attribution and external analytics remain **HOLD**.
