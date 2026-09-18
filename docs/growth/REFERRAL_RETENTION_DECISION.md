# Referral Retention Decision Brief — Philippines

Status: **PARTIAL OWNER DECISION RECORDED — NOT ACTIVE**

Verified: 2026-09-18

Scope: referral-growth analytics and attribution for Business & Life Philippines. This document records the legal/privacy boundary and decision inputs. It does **not** activate retention, PostHog delivery, reward economics, or durable referral attribution.

## 1. Why a decision is required

Philippine privacy rules require a documented, purpose-limited retention policy, but they do not prescribe one universal number of days for ordinary referral analytics.

The Data Privacy Act of 2012 requires personal information to be retained only for as long as necessary for the declared purpose, legal claims, legitimate business purposes, or as otherwise provided by law.

The DPA Implementing Rules and Regulations repeat that principle, require secure disposal, and prohibit keeping personal data indefinitely for a merely possible future use.

NPC Circular 2023-06 requires a Personal Information Controller / Personal Information Processor to:
- keep identifiable personal information only for as long as necessary for the specific purpose;
- establish and document retention periods in a policy;
- periodically review and amend that policy as necessary;
- inform data subjects about the retention policy and changes.

The National Privacy Commission also states that data subjects should be informed of the period for which personal information will be stored or retained.

NPC Advisory Opinion 2017-024 expressly explains that the DPA/IRR does not establish a single specific retention period; organizations must define a justified records-management policy based on purpose, legal requirements, prescription periods, industry standards and applicable regulation.

## 2. Official sources

- National Privacy Commission — Data Privacy Act of 2012:
  https://privacy.gov.ph/data-privacy-act/
- National Privacy Commission — Implementing Rules and Regulations of the Data Privacy Act:
  https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- National Privacy Commission — Circular 2023-06 overview, Security of Personal Data in the Government and Private Sector:
  https://privacy.gov.ph/npc-issues-circulars-to-strengthen-personal-data-protection-in-ph/
- National Privacy Commission — Right to be informed:
  https://privacy.gov.ph/the-right-to-be-informed/
- National Privacy Commission — Advisory Opinion 2017-024:
  https://privacy.gov.ph/wp-content/uploads/2022/01/NPC_AdvisoryOpinionNo._2017-024.pdf
- Bureau of Internal Revenue — Revenue Regulations No. 7-2024:
  https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf

## 3. Data classes that need separate rules

### A. Unconverted referral analytics

Examples:
- referral link created;
- explicit share channel;
- referral landing viewed;
- referral signup started;
- random analytics correlation id.

These events are acquisition analytics, not accounting records. The retention period should therefore be the shortest period that supports the declared acquisition-analysis purpose.

Owner decision confirmed on 2026-09-18:
- `unconvertedReferralEventDays = 90`.
- This is the canonical project-wide retention standard for unconverted referral events.

No current Philippine source found in this research imposes a fixed number of days for this ordinary referral-analytics class.

### B. Converted referral attribution

This class would exist only after durable signup/referral attribution is implemented.

Possible purposes may include:
- preventing duplicate attribution;
- referral-program integrity;
- customer/support disputes;
- measuring conversion effectiveness.

Decision required:
- how long converted attribution remains identifiable;
- what event terminates the purpose;
- whether data can be aggregated/anonymized earlier;
- how erasure/closure requests interact with legitimate legal/business exceptions.

Current runtime does not persist this attribution end-to-end.

### C. Reward evidence

Reward economics are currently disabled.

Do not select a reward-evidence retention period before the reward type, accounting treatment, tax treatment, dispute process and payout evidence are known.

If a future referral reward becomes an accounting/tax source record, applicable BIR record-retention requirements may become relevant. Revenue Regulations No. 7-2024 currently provides a five-year preservation rule for Books of Accounts and other accounting records under Tax Code Section 235, subject to longer retention where another rule or a pending case requires it.

This does **not** mean every referral analytics event is a five-year accounting record.

Decision required later:
- `rewardEvidenceRetentionRule` after reward economics and accounting classification are approved.

## 4. Candidate product policy — for Owner/legal approval, not a legal mandate

The following values are design candidates based on data minimization. They are **not** asserted as statutory Philippine periods:

| Data class | Candidate | Rationale | Current status |
| --- | ---: | --- | --- |
| Unconverted identifiable referral events | 90 days | Owner-approved project-standard acquisition-analysis window; delete or irreversibly aggregate after expiry unless a documented exception applies | OWNER APPROVED — NOT YET ACTIVATED |
| Converted referral attribution, when no financial reward is involved | 12 months after conversion | Supports attribution/support analysis, then should be deleted or irreversibly aggregated unless another documented basis applies | OWNER / LEGAL DECISION |
| Aggregated/de-identified growth statistics | Longer, subject to genuine de-identification | DPA/IRR allows longer storage where data no longer permits identification, with safeguards | DESIGN |
| Reward/payment/accounting evidence | No value yet | Depends on future reward economics, accounting/tax classification and dispute obligations | HOLD |

The Owner-approved 90-day unconverted value is recorded in the canonical machine-readable guardrails. That partial approval does not make referral analytics production-ready; the remaining retention/legal gates below must still be resolved before external analytics or durable attribution is activated.

## 5. Required disposal behavior

When a retention period expires and no documented exception applies:
- delete identifiable event/attribution records from active systems;
- ensure scheduled deletion applies to derived stores where practicable;
- ensure backups follow the organization backup/expiry policy rather than becoming a permanent hidden archive;
- do not retain an identifiable copy merely for an unspecified possible future use;
- where long-term trend analysis is still required, prefer irreversible aggregation/de-identification;
- record deletion-policy version and operational evidence without recreating the deleted personal data.

## 6. Privacy notice / transparency requirement

Before external analytics or durable attribution is activated, the relevant privacy notice should state at minimum:
- categories of referral/growth data processed;
- declared purpose;
- lawful basis used by the controller;
- recipients/processors, including PostHog if enabled;
- retention period or a sufficiently clear retention criterion;
- data-subject rights and how to exercise them;
- controller/contact details required by the applicable notice framework.

Marketing consent must remain separate from operational/security/accounting processing. Consent is not a universal legal basis for unrelated processing.

## 7. Current technical enforcement

PR #109 added fail-closed referral analytics delivery.

External PostHog delivery requires all of:
- `REFERRAL_ANALYTICS_ENABLED=true`;
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`;
- `REFERRAL_ANALYTICS_PROJECT_VERIFIED=true`;
- `POSTHOG_PROJECT_TOKEN`;
- `POSTHOG_INGEST_HOST`.

Production currently has none of those activation variables configured. Current PostHog revalidation exposes only `DROPi / Default project` (project id `273401`, no ingested events), which is not accepted as verified Business & Life destination evidence.

Prepared pre-conversion persistence now has a separate fail-closed gate. It remains inactive unless `REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED=true`, retention is approved, lawful basis is approved and a dedicated HMAC secret is configured. If later activated, its pending rows expire after the approved 90-day window and cannot store a referred account id.

Therefore:
- browser instrumentation can call Business & Life same-origin validation endpoints;
- no referral analytics is currently delivered to PostHog;
- no production retention value is activated by this document;
- `referral_growth_v1` remains inactive at 0%;
- event definitions remain unverified until correct-project real events are observed and audited.

## 8. Owner decision record

Recorded Owner decision:

- Unconverted referral-event retention: **90 days**.

Still requiring explicit approval/resolution before Growth enables production referral analytics or durable attribution:

1. Converted attribution retention rule.
2. Whether/when converted attribution becomes irreversibly aggregated.
3. Privacy-notice wording/basis for referral analytics.
4. Correct Business & Life PostHog project/region and project token.
5. Reward-evidence retention only after reward economics are separately approved.

Until then the canonical state is **HOLD** for external analytics and durable referral attribution retention.
