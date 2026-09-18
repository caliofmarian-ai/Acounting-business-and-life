# Referral analytics runtime gate

## Scope

Issue #49 owns referral analytics instrumentation.

This slice wires only events that are truthful in the current product runtime:

- `referral_link_created`
- `referral_shared`
- `referral_landing_viewed`
- `referral_signup_started`

A `referral_signup_completed` emission path is also prepared internally, but it is reachable only after a successful converted-attribution binding. Converted binding is currently fail-closed/HOLD, so `referral_signup_completed` is not a current production emission claim.

It does **not** emit `referral_qualified` or `referral_rewarded` before their corresponding policy/runtime exists.

## Privacy boundary

Browser code posts only to same-origin Business & Life endpoints. It never receives a PostHog project token and never calls PostHog directly.

Allowed runtime properties are bounded to the canonical Growth allowlist. Raw email, phone, recipient name, contact-list data, auth/reset tokens and private documents are rejected.

A random session-scoped `correlation_id` is used as the PostHog `distinct_id`. Delivery sets `$process_person_profile=false` so these referral analytics events do not create person profiles.

The public landing and referred signup-start flow send the referral code only to the same-origin server so the server can verify that the opaque code exists and belongs to the claimed enabled source profile. The code is not forwarded to PostHog.

Campaign, source and medium values are canonicalized server-side from the validated source profile where applicable; client-supplied values cannot redefine canonical campaign attribution.

## Delivery gates

External analytics delivery is fail-closed and requires all of:

- `REFERRAL_ANALYTICS_ENABLED=true`
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`
- `REFERRAL_ANALYTICS_PROJECT_VERIFIED=true`
- `POSTHOG_PROJECT_TOKEN=<correct project token>`
- `POSTHOG_INGEST_HOST=<correct HTTPS ingest origin>`

`REFERRAL_ANALYTICS_PROJECT_VERIFIED=true` is a separate operator assertion made only after the exact Business & Life PostHog organization/project/region has been revalidated. A configured token by itself is not sufficient proof that the destination is correct.

If any gate is missing, the server accepts valid instrumentation calls but returns a non-delivered state and sends nothing externally.

This is intentional because `growth/privacy-guardrails.json` currently has `retention.productionReady=false`.

## PostHog transport

When all gates are satisfied, the server uses PostHog's current single-event HTTP ingest contract at `/i/v0/e/` with the configured ingest origin. The project token stays server-side in Railway configuration.

## Current HOLD

Revalidated on 2026-09-18:
- Railway production has no `POSTHOG_*` or referral-analytics activation variables configured;
- the connected PostHog account exposes organization `DROPi` with only project `Default project` (project id `273401`);
- that project reports `ingested_event=false` and is not verified as the Business & Life analytics destination;
- therefore `REFERRAL_ANALYTICS_PROJECT_VERIFIED` must remain unset/false.

Therefore production event delivery must remain **HOLD** until the correct Business & Life PostHog project and retention policy are resolved.
