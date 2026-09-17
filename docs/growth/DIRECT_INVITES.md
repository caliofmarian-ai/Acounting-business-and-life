# Direct referral invitations — email and phone

## Why this is separate

The user's original referral request includes:
- email address;
- phone/SMS;
- WhatsApp;
- Telegram;
- groups;
- QR/link sharing.

These are not all the same transport.

WhatsApp/Telegram/group sharing can begin as a **user-initiated share action**.

A server-sent email or SMS requires:
- a delivery provider;
- rate limiting;
- abuse controls;
- delivery/suppression handling;
- marketing/privacy policy;
- separation from operational notification infrastructure.

## V1 UX

Promotion Center may show:

**Invite someone you know**

Tabs/fields:
- Email address
- Phone number

The user enters one recipient manually and confirms the invitation.

Do not require address-book upload.

## Email

Server-sent referral email is integration-blocked until the canonical notification layer/provider is ready.

The referral system supplies:
- canonical campaign;
- referral URL;
- approved copy;
- correlation/idempotency metadata.

The notification layer owns transport/retry/provider delivery.

## SMS

Same boundary as email, plus an approved SMS provider and jurisdiction/provider rules.

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

Issue #30/Admin governance remains authoritative for restricted operational-profile invitations.

## Production gates

Canonical file:
`growth/direct-invite-policy.json`

All production gates currently default false. Runtime sending must remain disabled until each required dependency is deliberately configured.
