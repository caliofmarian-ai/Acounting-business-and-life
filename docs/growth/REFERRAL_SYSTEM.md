# Referral Growth Engine — V1 architecture

## Authority and coordination

Project Owner explicitly authorized implementation on 2026-09-17.

This workstream owns acquisition/referral growth only. It is deliberately separate from:

- Issue #30 operational profile invitations and approvals;
- PR #42 Admin/RBAC/Support authority;
- Issue #43 public Help Center content;
- Issue #33 operational/security notifications;
- Issue #35 legal-document and marketing-consent governance.

## Identity model

Referral identity is **account-level**, not one code per profile.

Reason: one human account can hold multiple public profiles. Creating separate reward identities per Customer/Merchant/Supplier/Courier/Service Provider profile would permit accidental duplication and make anti-abuse/accounting harder.

Each profile may expose the same referral code with a different `profile` source tag so analytics can measure where the share originated.

Public profile source tags:

- `customer`
- `merchant`
- `supplier`
- `courier`
- `service_provider`

## Security boundary

A referral can:

- identify an acquisition source;
- preserve campaign metadata;
- progress through acquisition states;
- eventually qualify for an owner-approved reward policy.

A referral can never:

- approve a Merchant;
- approve a Supplier;
- approve Courier eligibility;
- approve Service Provider categories;
- grant Admin permissions;
- bypass territory/compliance/credential gates.

Issue #30 remains the authority for privileged operational profile invitations/approval.

## Referral URL

Canonical shape:

`/referral/?ref=<opaque-code>&utm_campaign=<campaign>&utm_source=<source>&utm_medium=referral&profile=<optional-public-role>`

Rules:

- code contains no account id, phone or email;
- marketing tokens are bounded and normalized;
- public link never carries raw contact-list data;
- signup should preserve the attribution server-side when the gateway integration lands.

## State machine

`created -> clicked -> signed_up -> qualified -> rewarded`

Allowed shortcut:

`created -> signed_up` when signup attribution exists but a prior click event was unavailable.

Terminal rejection is used for abuse/invalid cases such as self-referral.

`qualified` is intentionally separate from `signed_up`. Reward policy must be based on a real owner-approved qualification rule rather than account creation alone.

## First isolated batch

Branch: `feat/growth-referral-engine-v1`

The first batch intentionally does not modify files touched by active PR #42.

It adds:

- `growth/referral-domain.js`
- `growth/referral-schema.sql`
- `public/referral/*`
- `docs/growth/*`
- `tests/referral-growth.test.js`

The existing production chain already serves `public/` statically, so the public referral landing can exist without changing the gateway.

## Follow-up integration boundary

After PR #42 stabilizes, a separate integration slice may:

1. create/refetch account referral identity through authenticated API;
2. mount attribution endpoints;
3. persist signup attribution;
4. add Promotion Center entry points to the five public profiles;
5. render a local QR code for the canonical referral URL;
6. connect analytics events;
7. feature-flag rollout.

The integration slice must be rebased from current `main` after #42 and must not copy stale gateway code.

## Pending attribution readiness — 2026-09-18

A fail-closed pre-conversion persistence adapter is prepared in `growth/referral-unconverted-attribution.js`.

It may persist only `referral_landing_viewed` and `referral_signup_started` into `referral_pending_attributions`, with a fixed 90-day expiry and HMAC-pseudonymized correlation identity.

It is inactive unless all privacy/activation gates are explicitly satisfied. It cannot bind a referred account, qualify a referral or create reward state.

See `docs/growth/UNCONVERTED_ATTRIBUTION_RUNTIME.md`.

## Converted attribution readiness — 2026-09-18

The registration flow now carries the already-existing referral code/profile/correlation context through account creation, and the server has a fail-closed binding adapter in `growth/referral-conversion-binding.js`.

The adapter requires an existing unexpired pending attribution, rejects self-referral, prevents replacing an already-attributed account, and treats repeat binding to the same referral as idempotent.

It remains inactive because converted-attribution retention/lawful-basis policy is unresolved. There is intentionally no default converted retention period in code or guardrails.

`referral_signup_completed` is prepared as an internal analytics event but can only be emitted after a successful non-idempotent converted binding. Current production cannot satisfy that binding gate.

See `docs/growth/CONVERTED_ATTRIBUTION_RUNTIME.md`.
