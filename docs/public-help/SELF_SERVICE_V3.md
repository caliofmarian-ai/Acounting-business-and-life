# Public Help Center self-service V3A

Issue: #808. Research: #807 / PR #810. Public account-access contact follow-up: #815.

## Behavior

Public `/help`, profile, article and help-code routes retain their stable identities. Search is available on every reading page. It ranks complete task wording and reviewed aliases, normalizes punctuation/diacritics, and uses bounded spelling alternatives when a word is absent from the public vocabulary. Long-form sections are indexed. Exact help codes resolve deterministically; unknown codes never receive a nearby but different diagnosis.

The local index is built once per catalog. Queries stay in the page and are not stored in URLs, analytics or account records. No new provider, paid search service or AI call is involved in this slice.

A Help topic is a public reading preference. It can boost a relevant profile's guides but never switches the app account, active profile or business and never calls a private API. English/Filipino help-language preference is independent of account communication language and guided onboarding.

Three explicit diagnostic branches cover sign-in, profile/readiness and money ambiguity. Their links lead to public instructions; they do not infer private account/payment facts or perform an operational action.

The catalog contains 80 public guides, including reconciled registration/profile activation, review evidence, readiness/publication, account utilities, consumables, restock/counts, Supplier ETA and Counter orders. Fourteen core articles have Filipino text for their current source version. Other articles visibly fall back to English and declare English as their reading language. A translation whose source version no longer matches is not used.

Legacy Yes/No buttons did not store feedback. The reader now presents working guide and Support-path links; feedback collection remains a separately scoped later capability.

## Public content control

Every published article has a stable slug, version, explicit `PUBLIC`/`EFFECTIVE` publication metadata, content owner/reviewer, source-review date, review reminder, source revision and source paths. These are product-guidance review records, not activation of legal policies or private governance documents. Source review does not assert that a provider is configured or that a financial operation occurred.

`tests/help-self-service-v3.test.js` validates publication, source references, related links, diagnostic targets and translation/source-version consistency. Runtime ranking and all readers exclude unapproved/non-public entries defensively. The static public catalog itself must never contain private text: a browser filter is not a confidentiality boundary.

When a feature changes, review its source-path dependencies in article verification metadata. Update the applicable guide, bump its version and refresh its translation only after reviewing the corresponding behavior. Unchanged guides do not need their verified revision changed for unrelated releases. The broader PR impact/dependency enforcement and feedback-maintenance loop remain later V3 slices.

## Guest account-access limitation

`POST /api/support/tickets` authenticates the requester. The email architecture documents an outbound Support sender while explicitly deferring inbound Support email. Neither proves a monitored public account-access inbox.

The guide offers actual password/email recovery and explains the current contact limitation. It does not invent a working `mailto:` destination or send unauthenticated users to a ticket form that requires sign-in. #815 owns a verified public contact/intake, private staff handling and its abuse/identity protections. That capability remains undelivered by V3A.

## Validation

- The fixed 64-intent corpus spans Guest, account utilities and every public profile, including Filipino wording, common typos and reordered words. It asserts relevant top-three results, not just any match. Additional tests cover unknown help codes, body-only matches, draft/private exclusion, translation drift, escaping, malformed route input and absence of private API/session writes.
- Run focused contracts with `node --test tests/help-self-service-v3.test.js tests/help-center.test.js tests/account-settings-help-unification-v1.test.js`.
- The repository suite must run with `TZ=UTC npm test`; the existing Courier PostgreSQL DATE test depends on this timezone contract. No Courier code is changed.
- `Help Center Acceptance` checks the exact PR head, starts the full application gateway against its own temporary PostgreSQL service and runs pinned Chromium journeys. Screenshots and result JSON are revision-bound CI artifacts with seven-day retention.
- Browser journeys cover anonymous use, article/profile search, natural questions, guided money clarification, known/unknown codes, evidence guidance, English/Filipino, language-preserving help topics, honest guest limits, keyboard recovery and same-origin GET-only behavior. Mobile viewport and 2x CSS-zoom checks are simulations, not physical Android acceptance.
- A dedicated `help-center-qa-808` Railway service runs `server-help.js` from the exact head without a database or shared Preview pointer changes. Its health route exposes only a normalized source revision and the public Help version. This supplies isolated public Help Preview verification; full-gateway routing is also exercised in CI.
- Runtime delivery still requires exact-head Preview acceptance, reviewed merge, successful production deployment and smoke at `https://caliof.com`. An open PR or passing CI alone is not Production delivery. Record final SHA/deployment evidence in #808.

## Boundaries

Private `/knowledge` and its RBAC remain owned by #85. V3A does not change shared Support/authentication, Merchant/Supplier workflows, operational approval, financial records, provider settings or public Legal activation. AI explanations and authorized private retrieval remain later independently reviewed slices.
