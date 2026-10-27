# Live Promotion Center — runtime integration

## Purpose

This slice moves Growth referral from static/demo presentation to a real account-level identity.

The recovery changes tracked in #836 require exact-head Preview acceptance and
Production verification. This document describes the implementation contract; it
is not evidence that those changes have been deployed.

## Runtime authority

Referral identity belongs to the human account.

Account/Auth now owns:
- referral identity persistence;
- authenticated lookup;
- validation that the selected source profile is enabled.

The selected public profile changes campaign/source attribution only. It never creates a second referral identity.

## Data model

Runtime uses the existing canonical `referral_accounts` model:
- `account_id` primary key;
- one unique opaque `referral_code`;
- created timestamp;
- optional future rotation timestamp.

Codes are generated from cryptographic random bytes and do not encode account id, email or phone.

## API

`GET /api/growth/referral?profile=<public-role>`

Requires normal account authentication.

Supported source profiles:
- customer;
- merchant;
- supplier;
- courier;
- service_provider.

The requested source profile must be enabled for that account.

Response includes:
- authenticated `account_id`, used only to reject stale responses after a session/account change;
- stable referral code;
- source profile;
- canonical referral URL;
- safe share title/text/url;
- explicit `grantsProfiles=false`;
- explicit `grantsPermissions=false`.

`account_id` is not included in the public invitation URL, QR or marketing asset.

## Unified shell

Promotion Center is a tool in each public profile's **Profile Settings**. It is
separate from the account-level **Account Settings** page.

Merchant navigation:

`Merchant -> Settings / Profile Settings -> Promotion Center`

On desktop, **Settings** is in the Merchant workspace navigation. On mobile,
**Profile Settings** is in **Merchant tools**. The settings page places Promotion
Center between **Statements & documents** and **Profile tutorial**.

The direct Merchant URL is `/referral/promotion-center.html?profile=merchant`.
Other public profiles open the same page with their own source role. The avatar
opens Account Home; it is not a direct Promotion Center entry.

## Promotion Center

The page at:

`/referral/promotion-center.html`

now:
- requires sign-in for a personal referral identity;
- loads the real account code from the authenticated endpoint;
- reuses the same account code when the source profile changes;
- supports Native Share, Copy, WhatsApp, Telegram, SMS intent and email intent;
- keeps direct server-sent referral email/SMS disabled until referral-specific controls are ready.

This is an invitation to **Business & Life**. The source role does not turn the
invitation into a product advertisement, discount code or a link to a particular
Merchant storefront. A public store promotion must use that store's own approved
public destination.

The #836 recovery contract is to offer only the account's enabled sharing
profiles, bind every loaded result to the current account/session/role, and clear
the previous link and QR while loading or after failure. Interface copy supports
English and Filipino. Saved tool choices may contain role, format, language and
message selection; private referral payloads are not persisted as preferences.

Share, Copy and Marketing Kit are the primary tasks. If clipboard access fails,
the user must be able to select the actual public invitation link. The browser's
Promotion Center address is not a substitute for that link.

## Basic referral progress summary

Promotion Center reports readiness of the currently loaded assets only:
- referral link: `Ready` only when the authenticated canonical URL loaded;
- personal QR: `Ready` when the matching local QR loaded, otherwise the code fallback is stated;
- referral totals: unavailable in this interface;
- rewards and automatic invitations: not enabled.

There is no claim that journey tracking or external delivery is ready just
because a referral link was generated. The UI does not display fabricated zero
conversion/reward counts. Completed-referral counts require durable converted
attribution, and reward progress requires an approved reward policy. Existing
activation gates in #203 remain unchanged.

The product uses **Invite & Share**, never **Invite & Earn**, while rewards remain
disabled. Availability explanations must not obscure the working share tools.

## Referral landing and event acknowledgement

The public invitation landing loads the shared session-security bootstrap before
its referral module. Anonymous visitors remain anonymous; an already signed-in
visitor's existing same-origin POST requests receive the normal CSRF header.

The client treats an analytics response as accepted only when the JSON explicitly
contains `accepted: true`. HTTP 202 with `accepted: false` is not acceptance.
Acceptance remains separate from external delivery: `accepted: true` with
`delivered: false` can reflect an unchanged privacy/provider activation gate.
This acknowledgement does not enable analytics, rewards or converted attribution.

## Personal QR — live local rendering

Promotion Center now renders a real personalized QR tied to the exact authenticated referral URL.

Implementation rules:
- encoding runs locally in the Business & Life server process via the `qrcode` package;
- the referral URL is not sent to Google Charts, qrserver, QuickChart or another QR web service;
- the QR keeps the exact canonical referral URL and adds only the fragment `#qr` as a one-shot scan-origin marker;
- URL fragments are not sent in the HTTP request; after the landing emits `referral_qr_opened`, it removes `#qr` with `history.replaceState`;
- copying or resharing from the landing uses the clean canonical referral URL, so the QR marker is not propagated;
- the renderer uses a four-module quiet zone, matching the Marketing Kit QR contract;
- changing the source profile changes the canonical role campaign URL and therefore regenerates the QR;
- the human-readable opaque referral code remains visible as fallback;
- QR generation never grants profile or Admin authority.

The authenticated endpoint returns a `qr` object containing `format`, `encoder`, `marker`, `referralUrl`, `payload` and a PNG `dataUrl`.

## Authorization boundary

Referral identity is acquisition attribution only.

It cannot:
- approve Merchant;
- approve Supplier;
- approve Courier;
- approve Service Provider categories;
- grant Admin permissions;
- bypass legal/credential/territory gates.
