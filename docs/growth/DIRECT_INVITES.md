# Direct referral invitations — email and phone

## Why this is separate

The referral request includes:
- email address;
- phone/SMS;
- WhatsApp;
- Telegram;
- groups;
- QR/link sharing.

These are not all the same transport.

WhatsApp/Telegram/group sharing can begin as a **user-initiated share action**.

Server-sent email or SMS additionally requires:
- canonical transport/delivery infrastructure;
- a referral-specific template;
- consent/preference binding appropriate to marketing;
- rate limiting;
- per-recipient deduplication;
- abuse monitoring;
- delivery/suppression handling;
- channel/provider configuration.

## Current platform infrastructure

As of current `main`:

### Available
- V0.11 canonical notification events/deliveries/preferences/templates;
- in-app notification inbox;
- bounded retry/dead-letter behavior;
- pluggable Resend email transport when environment credentials are configured;
- Web Push/PWA support;
- V0.12 versioned legal/consent framework;
- `marketing_consent` legal document type;
- `marketing.opt_in` legal action gate.

### Still missing for referral server-send
The existence of Notifications and Legal Consent does **not** automatically authorize referral email/SMS sending.

Referral direct sending remains disabled until the Growth integration adds and verifies:
- referral email template/version;
- referral event/category mapping;
- binding to active marketing preference/consent rules where required;
- per-account rate limits;
- per-recipient deduplication window;
- suppression/stop behavior;
- abuse monitoring;
- provider configuration in the target environment.

SMS additionally requires an approved SMS provider; none is assumed by Growth.

## V1 UX

Promotion Center may show:

**Invite someone you know**

Tabs/fields:
- Email address
- Phone number

The user enters one recipient manually and confirms the invitation.

Do not require address-book upload.

## Email

The canonical notification layer is now available.

The referral system should supply:
- canonical campaign;
- referral URL;
- approved template/version;
- correlation/idempotency metadata;
- recipient selected by the user;
- referral-specific consent/preference decision.

The notification layer owns transport/retry/provider delivery.

Until the referral-specific production gates are implemented, the server-send action stays disabled.

## SMS

SMS remains future-gated by:
- an approved SMS provider;
- jurisdiction/provider policy;
- the same referral-specific rate-limit/dedup/consent/abuse controls.

Do not invent an SMS provider in Growth.

## WhatsApp / Telegram

V1 uses user-initiated share intents, not server-side mass messaging.

## Groups

A user may manually choose/share into a group.

The platform must not automatically post referral messages into groups in V1.

## Critical distinction

A Growth referral invitation means:

> “Try Business & Life through my referral.”

It does **not** mean:

> “You are invited/approved to become Merchant/Supplier/Courier.”

Operational profile governance remains authoritative for restricted profiles.

## Production gates

Canonical file:

`growth/direct-invite-policy.json`

Infrastructure gates for Notifications and Legal Consent are now recorded as ready. Referral-specific runtime gates remain false until deliberately implemented and validated.

## Figma reference

Direct invite mobile screen:
- file: `Business & Life — Growth & Referral System`;
- node: `7:2` — `Promotion Center — Direct Invite`.

The design intentionally keeps direct server-send disabled until the referral-specific production gates above are satisfied.
