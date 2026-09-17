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

## PostHog integration

Issue #49 owns live PostHog mapping. Before writing to PostHog, resolve the correct organization/project and verify existing event names to avoid duplicate schemas.
