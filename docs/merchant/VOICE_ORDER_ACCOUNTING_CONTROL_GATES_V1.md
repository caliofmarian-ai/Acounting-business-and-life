# Merchant Voice AI — accounting and operator safety gates

Status: IMPLEMENTATION V1D / passkey-backed, gated source code in Draft PR #870 only; NOT YET in Preview or Production. Refs #863, #814, #860.

## Non-negotiable boundaries
1. Voice/LLM may only interpret instructions and prepare an editable Merchant order DRAFT. It has no direct capability to write transactions, record received payments, mark an order paid, modify stock, change product prices, issue refunds or generate legally valid invoices.
2. Use the authenticated operator's current account, device session and EXACT Merchant business. Microphone activation must be deliberate (prefer close-talk headset plus push-to-talk). VAD and speech recognition do not establish speaker identity. Unknown, overlapping or background speech must fail closed; no false guarantee of identifying a voice is permitted.
3. NIST SP 800-63B-4 disallows voice biometric comparison as an authenticator. A one-time spoken phrase confirms INTENT, not IDENTITY. Actions that can create orders or financial obligations need independent server-validated, device-held authentication (e.g. WebAuthn/passkey step-up), in addition to the active session and spoken confirmation.
4. The server rebuilds and verifies the Catalog selection, variants, quantities, availability and PHP amounts in INTEGER centavos. AI-estimated prices and speech transcripts are not trusted for any final amount. Any change to the products, total, operator, session, Merchant business or quoted price invalidates the confirmation and requires a new readback.
5. Before creating an order, assistant reads back named customer, every product/variant, quantities, pickup/delivery, amount, and payment method; states that no money has been received. Issue a short-lived, unpredictable, one-time phrase tied to a hash of the full order and server quote; lock after limited bad attempts.
6. The write side must atomically consume its server-owned approval record and enforce a UNIQUE idempotency key with result persistence before calling the canonical Orders engine; all retries return the same order, not a second one. Never accept a pending challenge object or device-trust boolean from the AI or browser as proof.
7. The existing POST /api/orders/merchant/create path currently has no demonstrated server-enforced idempotency request key. This is a HARD PRODUCTION RELEASE BLOCKER for voice order submission. Keep the new helper non-writing until coordinated backend hardening and isolated PostgreSQL concurrency QA.
8. Creating an order can create an UNPAID receivable and stock reservation, but never constitutes payment. Confirmed money comes only from verified payment sources and explicit independently authorized payment recording. Do not allow voice to record sales proceeds, account transfers, VAT claims, refunds or closing balances.

## Periodic accounting integrity
Daily reports must come from canonical Orders, payment, cancellation/refund, stock and ledger records, never AI transcripts or model-written summaries. Every confirmed order needs an auditable actor, business, idempotency key, immutable source event and linkage to its actual order number. Corrections use reversing/audited events, not deletion. Weekly, monthly and yearly totals must reconcile to the underlying immutable daily/source transactions. Any difference goes to a human exception queue: AI cannot silently auto-fix it.

## Release tests
- Real Android: operator vs customers speaking, multiple/similar voices, artificial/recorded voices, TV, overlap, microphone revoked, silence and noisy environments.
- English PH and Filipino numeric/product names: uncertainty asks a question, never invents a product/amount.
- Verified one-time phrase, server-bound account/session/business, device step-up, expired/replayed/guessed phrase, corrected draft and stale quoted price.
- Parallel duplicate confirmations, retry/refresh, crash/recovery, cross-business switch and 403/401 fail-closed, using isolated PostgreSQL and genuine browser actions.
- Zero unapproved Orders, payments, ledger rows or stock writes in the tested adversarial corpus. Reconcile every accepted source ID and all period totals before production acceptance.

## Implementati## Implementation state — 30 October 2026 (V1D)

**Canonical scope:** Existing Draft [PR #870](https://github.com/caliofmarian-ai/Acounting-business-and-life/pull/870), issue #863. Not in canonical `main`, not live at `https://caliof.com`, and not accepted through a real authenticated Merchant Preview session.

### Implemented (feature flags OFF unless deliberately set)

- **Voice / text draft:** multi-turn, English PH/Filipino, current same-business Catalog products/variants/modifiers, ambiguous name clarification and strict max quantities. No model authority for order/payment/stock writes; OpenAI Responses uses `store:false` and per-user/business request quotas.
- **Android UX:** tap-to-speak, explicit speech processing consent, editable recognized text, readback, server-priced quote, password step-up, native WebAuthn `navigator.credentials.create/get`, human-typed one-time phrase and explicit confirm. Android emulation with mocked APIs is NOT physical device/browser-microphone proof.
- **Authoritative quote:** two-minute HMAC of Merchant business, operator, active session, products, variants, modifiers, customer and PHP centavo amounts. Server re-prices every line in the canonical transaction.
- **WebAuthn ES256:** server checks HTTPS exact Origin, RP ID hash, cryptographic challenge, user presence (UP), user verification (UV), valid registered P-256 signature and monotonic counters where available. Registration accepts only `fmt:none` with strict COSE validation, so the server **does not certify authenticator hardware provenance**. Synced passkeys may be backed up across devices.
- **Device approval:** short-lived (90 second) random challenge and a manually typed random phrase tied in PostgreSQL to account/session/business/quote hash/request key. The device signature and one-time phrase are checked and consumed **inside the same PostgreSQL transaction** as the idempotency claim, canonical Orders/stock reservation and committed order ID. Duplicate request keys replay the original order result without creating another transaction.
- **Operator check:** fresh V2-session password step-up `FOR SHARE` resists concurrent session revocation. It is **in addition to**, not a substitute for, the passkey.
- **Manual Orders continuity:** ordinary Merchant creates use the existing own transaction; voice confirmation uses the same client under its protective outer transaction. High-risk `order_create` velocity rules apply to a new voice claim, not an idempotent replay.
- **Financial correctness:** only pickup/cash, `unpaid` and presence not confirmed. No cash receipt, payment, direct Inventory adjustment, fee settlement, fiscal invoice, or autonomous money movement. Canonical Orders remains the one authority.

### Explicit release flags

Enabling voice UI/AI/order submission alone must not be enough. No credential or secret values should be committed:

- `ORDER_VOICE_UI_ENABLED=1` — show experimental Merchant companion
- `ORDER_VOICE_AI_ENABLED=1`, `ORDER_VOICE_AI_MODEL` and `OPENAI_API_KEY` — consent-gated model interpretation
- `ORDER_VOICE_WEBAUTHN_ENABLED=1`, `ORDER_VOICE_WEBAUTHN_RP_ID`, `ORDER_VOICE_WEBAUTHN_ORIGIN` — server verifier is live only for an exact HTTPS origin and matching RP ID (no untrusted Host-derived defaults)
- `ORDER_VOICE_PASSKEY_ENROLLMENT_ENABLED=1` — **separate**, temporary first-passkey enrolment authorisation; requires active account, verified email and recent password step-up. Once a passkey exists, another cannot be registered using password alone; recovery requires a separately reviewed procedure. Disabling enrolment does not disable use of an already-registered passkey
- `ORDER_VOICE_CREATE_ENABLED=1` — allows an explicit, credential-verified, idempotent canonical order create. Requires all preceding gates and real Merchant QA acceptance
- `TOKEN_SECRET` — existing V2 signed session authority; no caller-provided device-trust boolean is accepted

**First-device bootstrap remains a separate security review gate:** historic email verification plus password step-up do not constitute a fresh second-channel proof. Do not activate initial passkey enrolment for public real-world Merchant accounts until secure bootstrap/recovery policy has been reviewed, tested and approved. A compromised session+password must not silently allow a fraudulent first device to be trusted.

### Verified evidence and what is still missing

- Focused Node tests for model suggestions, Catalog match, quote/HMAC, current session, WebAuthn CBOR/ES256 registration and assertion, tampering, missing UV, origin/RP mismatch, cloned counters, account/business switching and phrase reuse.
- Dedicated GitHub Actions on disposable real PostgreSQL 16 tests the same-transaction order/idempotency/stock path, password step-up versus session revocation, concurrent double-submit, passkey challenge consumption and rollback. Refer to **the latest exact-head successful CI run**; do not carry a historic success forward after branch changes.
- 390×844 Android-sized Chromium with synthetic auth/API shows no JS errors or horizontal overflow across voice/text draft → quote → operator password → passkey enrolment → one-time phrase → explicit create UI. This is synthetic client evidence, not live AI and not physical device microphone/passkey acceptance.
- **Outstanding:** secure first-device bootstrap and recovery, independently vetted WebAuthn security review, real authenticated Merchant A↔B and all-error-case tests in isolated Preview, physical Android native passkey/microphone/noise checks, real model integration, staging reconciliation, reviewed merge, production deployment SUCCESS, and agent-run `https://caliof.com` smoke. Do not turn on live order writes or close #863 before all acceptance gates.

rences
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
- OpenAI Realtime VAD: https://developers.openai.com/api/docs/guides/realtime-vad
- OpenAI Realtime transcription limitations: https://developers.openai.com/api/docs/guides/realtime-transcription
- OWASP LLM06 Excessive Agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
