# Referral privacy and anti-spam guardrails

## Purpose

Issue #50 owns the privacy/anti-spam boundary for Growth referral acquisition.

This is an engineering/product guardrail document. It does not replace the versioned legal/privacy governance required by Issue #35.

## Public referral payload

Allowed:
- opaque referral code;
- campaign;
- source;
- medium;
- optional public profile-source tag.

Prohibited:
- raw email;
- raw phone;
- recipient identity;
- postal address;
- contact-list contents;
- authentication/reset secrets.

## Address book

Business & Life does not need to upload a user's complete address book to implement referral sharing.

Preferred flow:

`Promotion Center -> choose share channel -> operating system/app share UI -> user chooses recipient`

The application should not silently read or retain the user's contact graph.

## Messaging

Initial referral distribution is user-initiated.

Allowed:
- native share sheet;
- Copy Link;
- WhatsApp share intent;
- Telegram share intent;
- SMS share intent;
- email share intent;
- manual share into a group.

Not allowed by default:
- automatic bulk SMS/email;
- automated group posting;
- background contact scraping;
- repeated automated invitations to non-users.

## Consent categories

Do not merge these categories into one checkbox:

- optional marketing/referral;
- operational notifications;
- security;
- legal acceptance;
- location;
- payment/transactional communications.

Issue #35 remains authoritative for versioned legal consent/acceptance architecture.

## Analytics

The canonical analytics allowlist and denylist are machine-readable in:

`growth/privacy-guardrails.json`

PostHog referral definitions must not be marked verified until emitted properties have been checked against this list.

## Retention production gate

Growth does not invent retention periods. The Project Owner confirmed **90 days** for unconverted identifiable referral events on 2026-09-18, superseding the temporary 60-day setting and aligning this Growth policy with the project-wide 90-day standard.

Before production referral tracking is activated, the project must still define:
- retention/legal basis for converted attribution;
- retention/accounting basis for reward evidence;
- the corresponding privacy-notice/processing basis required for the enabled analytics flow.

Until that happens:

`retention.productionReady = false`

The approved 90-day unconverted period is therefore recorded, while `productionReady` remains false until the remaining retention/privacy gates are resolved. This prevents a partial Owner decision from silently enabling indefinite or incompletely governed PII/pseudonymous tracking.

## Authorization boundary

Referral attribution can never:
- grant a public operational profile;
- grant Admin authority;
- bypass territory approval;
- bypass credential/document requirements.

Referral is an acquisition/attribution signal, not an authorization signal.
