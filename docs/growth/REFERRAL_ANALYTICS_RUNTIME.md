# Referral analytics runtime gate

## Scope

Issue #49 owns referral analytics instrumentation.

This slice wires only events that are truthful in the current product runtime:

- `referral_link_created`
- `referral_shared`
- `referral_landing_viewed`

It does **not** emit `referral_signup_completed`, `referral_qualified` or `referral_rewarded` before the corresponding attribution/reward runtime exists.

## Privacy boundary

Browser code posts only to same-origin Business & Life endpoints. It never receives a PostHog project token and never calls PostHog directly.

Allowed runtime properties are bounded to the canonical Growth allowlist. Raw email, phone, recipient name, contact-list data, auth/reset tokens and private documents are rejected.

A random session-scoped `correlation_id` is used as the PostHog `distinct_id`. Delivery sets `$process_person_profile=false` so these referral analytics events do not create person profiles.

The public landing sends its referral code only to the same-origin server so the server can verify that the opaque code exists. The code is not forwarded to PostHog.

## Delivery gates

External analytics delivery is fail-closed and requires all of:

- `REFERRAL_ANALYTICS_ENABLED=true`
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`
- `POSTHOG_PROJECT_TOKEN=<correct project token>`
- `POSTHOG_INGEST_HOST=<correct HTTPS ingest origin>`

If any gate is missing, the server accepts valid instrumentation calls but returns a non-delivered state and sends nothing externally.

This is intentional because `growth/privacy-guardrails.json` currently has `retention.productionReady=false`.

## PostHog transport

When all gates are satisfied, the server uses PostHog's current single-event HTTP ingest contract at `/i/v0/e/` with the configured ingest origin. The project token stays server-side in Railway configuration.

## Current HOLD

At implementation time:
- Railway production has no `POSTHOG_*` variables configured;
- retention approval is not configured;
- the PostHog connection exposed to this session points to a different project and must not be modified.

Therefore production event delivery must remain **HOLD** until the correct Business & Life PostHog project and retention policy are resolved.
