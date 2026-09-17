# Referral analytics contract

## Purpose

Measure the referral funnel without sending raw email, phone, address-book or private profile data to analytics.

## Canonical funnel

`share -> landing -> signup -> qualified -> rewarded`

## Events

| Event | When | Minimum properties |
| --- | --- | --- |
| `referral_link_created` | authenticated user requests/opens share identity | campaign, source_profile_role |
| `referral_shared` | user explicitly triggers a share action | channel, campaign, source_profile_role |
| `referral_qr_opened` | QR-origin landing is observed | campaign, source_profile_role |
| `referral_landing_viewed` | valid referral landing loads | campaign, source, medium, source_profile_role |
| `referral_signup_started` | referred visitor enters registration | campaign, source |
| `referral_signup_completed` | account registration completes and attribution is bound | campaign, source |
| `referral_qualified` | owner-approved qualification rule is satisfied | reward_policy_version |
| `referral_rewarded` | reward grant is successfully recorded | reward_policy_version, reward_kind |

## Prohibited analytics properties

Do not send:

- email addresses;
- phone numbers;
- postal addresses;
- contact-list entries;
- names of recipients;
- raw reset/auth tokens;
- private documents;
- referral secret/HMAC key.

A referral code may be stored by the transactional referral system. For general analytics, prefer a correlation/event id or one-way scoped identifier if person-level debugging is not required.

## Channel values

Initial user-initiated channels:

- `native_share`
- `copy_link`
- `whatsapp`
- `telegram`
- `sms`
- `email`
- `qr`
- `other`

No channel value implies permission to auto-send.

## Experiment dimensions

Reserve:

- `creative_variant`
- `cta_variant`
- `landing_variant`
- `reward_message_variant`

Do not launch experiments that alter actual reward economics without an explicit owner-approved reward policy.

## PostHog live configuration

Issue #49 owns live PostHog mapping.

Connection was resolved to the single accessible Business & Life/DROPi analytics project before any writes were made.

Configured on 2026-09-17:

- all eight canonical referral event definitions were created;
- every event definition is intentionally `verified=false` until production instrumentation actually emits and validates it;
- dashboard **Business & Life — Referral Growth** was created as the stable destination for future referral funnel/channel insights;
- feature flag `referral_growth_v1` was created with:
  - `active=false`;
  - rollout `0%`;
  - distinct-id bucketing;
  - experience continuity enabled.

The disabled flag reserves a stable rollout key but does not change production behavior.

Do not mark referral event definitions verified merely because their metadata exists. Verification requires observed, correctly instrumented production/staging events with expected properties and no prohibited PII.

## Dashboard activation sequence

After application instrumentation lands:

1. verify each canonical event appears in the data schema;
2. audit properties for prohibited PII;
3. mark correctly instrumented event definitions verified;
4. build the funnel insight;
5. add channel/source and creative-variant breakdowns;
6. add qualified/rewarded counts;
7. attach insights to the existing Referral Growth dashboard;
8. keep `referral_growth_v1` at 0% until the integrated feature passes CI, preview and owner acceptance.
