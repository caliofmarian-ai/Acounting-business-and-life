# Unconverted referral attribution runtime

## Scope

This slice advances Issue #46 without activating converted referral attribution.

It prepares a durable **pre-conversion** boundary for:
- `referral_landing_viewed`;
- `referral_signup_started`.

It deliberately does not persist:
- `referral_signup_completed`;
- a referred account id;
- qualification;
- reward state;
- raw email/phone/contact-list data;
- the raw browser correlation id.

## Storage boundary

When all gates are approved, the runtime may create/use:

`referral_pending_attributions`

The table stores:
- referrer account id already resolved from the opaque referral code;
- referral code snapshot;
- source profile role;
- canonical campaign/source/medium;
- HMAC-SHA256 correlation hash;
- first landing time;
- signup-start time;
- fixed expiry.

It has no column for a referred account id, qualification or rewards.

The browser correlation id is never stored directly. It is HMAC-pseudonymized with a dedicated server-side secret and scoped to referral code + source profile role.

## Retention

Canonical unconverted retention is **90 days**.

Expiry is fixed when the pending attribution row is first created. Later events do not extend the expiry window.

Expired pending rows are purged before an enabled persistence write. A production scheduling/operations policy may later add a periodic purge, but it must not extend retention.

## Fail-closed activation

Persistence is inactive unless all of these are true:

- `REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED=true`
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`
- `REFERRAL_ANALYTICS_LAWFUL_BASIS_APPROVED=true`
- `REFERRAL_ATTRIBUTION_HMAC_SECRET=<dedicated secret at least 32 characters>`

Current production must leave these persistence activation gates unset/false until the privacy/lawful-basis requirements are actually approved.

The HMAC secret is separate from browser data and must not be committed to GitHub.

## Runtime behavior while HOLD

The public referral analytics endpoint validates the referral code and profile as before.

It calls the pending-attribution adapter, but the adapter performs **zero database work** while the activation gates are not satisfied. Referral UI and same-origin instrumentation continue to work.

A persistence error is suppressed from the user-facing flow and does not grant authority or change profile state.

## Conversion boundary

Moving a pending row into durable converted attribution remains **HOLD**.

Before conversion binding is enabled, the project still requires:
- approved converted-attribution purpose;
- approved converted-attribution retention/deletion rule;
- applicable privacy-notice/lawful-basis completion;
- self-referral and duplicate-conversion enforcement against the newly created account;
- an explicit implementation/test slice.

No environment variable in this slice can enable converted account binding or rewards.
