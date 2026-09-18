---
document_id: BL-GROWTH-PH-REFERRAL-PRIV-DRAFT-001
title: Referral and Growth Analytics Privacy Notice Supplement
document_type: privacy_notice_supplement
status: DRAFT
access_class: INTERNAL_REVIEW
country_code: PH
territory_scope: national
owner_role: Growth / Referral
legal_owner: Documentation Governance / Issue #35
approver_role: Project Owner
version: 1.0
legal_classification: PRODUCT_INPUT_TO_LEGAL_NOTICE
legal_review: REQUIRED
publication_status: NOT_FOR_PUBLICATION
---

# Business & Life — Referral and Growth Analytics Privacy Notice Supplement

> **Controlled draft — NOT FOR PUBLICATION.**
>
> This document is product/legal input for the controlled Business & Life Privacy Notice Framework. It does not replace `docs/agreements/PRIVACY_NOTICE_FRAMEWORK.md`, does not create a lawful basis, does not activate analytics, and must not be shown as an EFFECTIVE privacy notice until the actual Philippine operator/PIC/PIP facts, contact details, processor register, lawful-basis map and legal review are complete.

Verified product state: 2026-09-18.

## 1. Processing activity covered

This supplement describes the Business & Life referral/acquisition flow where a registered account holder:
- opens Promotion Center;
- creates or uses the account's opaque referral code;
- selects a permitted source profile;
- copies/shares a canonical referral URL or locally generated QR;
- a referred visitor may open the referral landing and start account creation.

Current instrumented event names:
- `referral_link_created`;
- `referral_shared`;
- `referral_qr_opened`;
- `referral_landing_viewed`;
- `referral_signup_started`.

The following are **not current runtime claims**:
- `referral_signup_completed` — HOLD until durable attribution is approved and implemented;
- `referral_qualified` — HOLD until qualification policy exists;
- `referral_rewarded` — HOLD until reward economics, accounting and retention are approved.

## 2. Information used in the current referral analytics contract

Permitted pseudonymous or bounded metadata:
- opaque referral code;
- campaign identifier;
- source;
- medium;
- source profile role;
- explicit share channel;
- creative variant;
- CTA variant;
- landing variant;
- random session-scoped correlation ID.

The analytics contract prohibits:
- raw email address;
- raw phone number;
- postal address;
- recipient name;
- contact/address-book contents;
- authentication token;
- reset token;
- referral secret.

The application uses operating-system/application share intents so the recipient can be chosen by the user without Business & Life silently uploading the user's address book.

## 3. Purpose

Product purpose proposed for legal review:

> Measure and understand the performance of the Business & Life referral acquisition journey, including which permitted referral channels and campaign/profile contexts lead visitors to referral landings and the start of account creation, while minimizing identifiable data.

A separate or amended declared purpose is required before durable converted attribution, qualification, rewards or direct automated marketing is activated.

Referral attribution is never an authorization mechanism and cannot:
- grant an operational profile;
- grant Admin authority;
- bypass territory approval;
- bypass credential/document requirements.

## 4. Lawful basis — unresolved publication gate

**LEGAL DECISION REQUIRED.**

The final controller/PIC must select and document the applicable lawful basis for this processing under Philippine law before an EFFECTIVE notice or external referral analytics activation.

This draft intentionally does **not** state:
- that consent is necessarily the lawful basis;
- that legitimate interest is automatically applicable;
- that contract necessity automatically applies.

If consent is required for a particular processing purpose, it must be specific, informed and appropriately separated from unrelated legal acceptance, operational notifications, security, location or payment processing.

Canonical state:

`referralAnalyticsLawfulBasis = TO_BE_CONFIRMED`

## 5. Retention

### Unconverted referral events

Project Owner decision:

**90 days** for unconverted identifiable/pseudonymous referral events.

At expiry, and absent a documented legal/business exception:
- delete identifiable/pseudonymous referral event records from active systems;
- do not retain them indefinitely for unspecified possible future use;
- where longer-term trend analysis is needed, prefer irreversible aggregation/de-identification.

### Converted attribution

**TO BE CONFIRMED — HOLD.**

No converted-attribution period is asserted by this draft. Durable converted attribution must remain gated until its retention/deletion rule and lawful purpose/basis are explicitly approved.

### Reward/payment/accounting evidence

**TO BE CONFIRMED — HOLD.**

Referral reward economics are disabled. Do not classify ordinary referral analytics as accounting/tax records merely to justify longer retention.

## 6. Recipients and processors

Current product truth:
- same-origin Business & Life referral analytics validation endpoints exist;
- external PostHog delivery is fail-closed and currently not approved for activation.

External PostHog delivery requires all of:
- `REFERRAL_ANALYTICS_ENABLED=true`;
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`;
- `REFERRAL_ANALYTICS_PROJECT_VERIFIED=true` only after exact project/organization/region revalidation;
- a verified Business & Life `POSTHOG_PROJECT_TOKEN`;
- the correct `POSTHOG_INGEST_HOST`.

Before PostHog or another processor is named in an EFFECTIVE notice, legal/privacy governance must verify:
- actual processor identity;
- purpose and data categories;
- hosting/processing region;
- contractual/DPA terms;
- cross-border data-flow facts;
- applicable security and subprocessor disclosures.

Do not use a PostHog project belonging to another organization or product.

## 7. Transparency wording candidate

The following wording is a product draft for incorporation into the final Privacy Notice after legal review:

> When you use Business & Life referral features, we may process an opaque referral code and limited campaign, profile-source, share-channel and session-correlation information to understand how the referral journey is used. We do not need to upload your address book to provide the initial referral sharing flow, and our referral analytics contract prohibits raw recipient email, phone number and contact-list contents. Unconverted referral event data is scheduled for a 90-day retention period under the approved product policy. Any different retention period for converted referral attribution or future reward records will be documented before those functions are activated. Details of the applicable lawful basis, responsible Philippine operator, processors and data-protection contact must appear in the final reviewed Privacy Notice.

This wording is **not publishable yet** because the lawful basis, operator/PIC/PIP facts, contact information and external processor facts remain incomplete.

## 8. Data-subject rights

The final EFFECTIVE notice must explain applicable rights and the verified request process, including as applicable:
- right to be informed;
- access;
- correction/rectification;
- objection;
- erasure/blocking where applicable;
- complaint process;
- other rights recognized by the Data Privacy Act, its IRR and applicable NPC rules.

The final notice must provide the actual controller/PIC or representative contact and privacy/DPO contact. Do not publish placeholders as facts.

## 9. Security/minimization controls already implemented

Current Growth guardrails include:
- opaque public referral identifier;
- strict analytics property allowlist;
- explicit analytics denylist for raw contact data/secrets;
- server-side referral/profile validation;
- canonical campaign derivation server-side;
- random session correlation ID rather than raw account/contact identity for analytics transport;
- `$process_person_profile=false` in the external PostHog transport design;
- rate limiting;
- bounded external-delivery timeout;
- fail-closed external delivery;
- QR generation local to Business & Life rather than a third-party QR web service.

These controls must be described accurately and must not be presented as a guarantee of absolute security.

## 10. Official Philippine sources used for this draft

- National Privacy Commission — Data Privacy Act of 2012:
  https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission — Implementing Rules and Regulations of the Data Privacy Act:
  https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- National Privacy Commission — Right to be informed:
  https://privacy.gov.ph/the-right-to-be-informed/
- National Privacy Commission — Data Subject Rights:
  https://privacy.gov.ph/data-subject-rights/
- National Privacy Commission — Advisory Opinion 2017-024:
  https://privacy.gov.ph/wp-content/uploads/2022/01/NPC_AdvisoryOpinionNo._2017-024.pdf

Key constraints reflected here:
- personal data processing must have a declared, specified and legitimate purpose;
- processing must be proportionate and limited to what is necessary;
- data subjects must be informed about relevant processing details, including purpose, basis where not consent, recipients, controller/contact, retention and rights;
- personal data should not be retained longer than necessary and must be securely disposed of;
- there is no single universal statutory retention period for every type of referral analytics data.

## 11. Gates before incorporation into the EFFECTIVE Privacy Notice

All of the following remain required:
1. actual Philippine operator/PIC/PIP identity;
2. privacy/DPO contact;
3. applicable NPC registration details, if any, after operator-specific assessment;
4. referral-analytics lawful-basis decision;
5. converted-attribution retention/deletion rule;
6. reward evidence rule only after reward economics/accounting classification exists;
7. correct Business & Life analytics processor/project/region;
8. processor/vendor register and applicable data-processing terms;
9. cross-border processing facts;
10. legal/privacy review and Project Owner approval.

Until those gates are satisfied, this document remains **DRAFT / NOT FOR PUBLICATION** and external referral analytics remains **HOLD**.
