# Live Promotion Center — runtime integration

## Purpose

This slice moves Growth referral from static/demo presentation to a real account-level identity.

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
- stable referral code;
- source profile;
- canonical referral URL;
- safe share title/text/url;
- explicit `grantsProfiles=false`;
- explicit `grantsPermissions=false`.

## Unified shell

`Account & Profiles` exposes a universal **Invite & Earn / Promotion Center** entry.

Navigation path:

`Account avatar -> Promotion Center`

This works from every public profile because the account drawer is common to the unified shell.

## Promotion Center

The page at:

`/referral/promotion-center.html`

now:
- requires sign-in for a personal referral identity;
- loads the real account code from the authenticated endpoint;
- reuses the same account code when the source profile changes;
- supports Native Share, Copy, WhatsApp, Telegram, SMS intent and email intent;
- keeps direct server-sent referral email/SMS disabled until referral-specific controls are ready.

## QR coordination gate

Personal QR must be generated locally rather than through a third-party QR web service.

An active Payment V0.13 branch currently owns `package.json` and `tests/architecture.test.js`. Growth does not modify those shared files in this slice.

Therefore local dynamic QR encoding remains a follow-up inside Issue #94 after the Payment dependency surface stabilizes. The live page does not display a fake personal QR.

## Authorization boundary

Referral identity is acquisition attribution only.

It cannot:
- approve Merchant;
- approve Supplier;
- approve Courier;
- approve Service Provider categories;
- grant Admin permissions;
- bypass legal/credential/territory gates.
