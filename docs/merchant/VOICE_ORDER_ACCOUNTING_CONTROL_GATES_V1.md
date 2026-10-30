# Merchant Voice AI — accounting and operator safety gates

Status: IMPLEMENTATION V1C / gated source code in Draft PR #870 only; NOT in Preview or Production. Owner requirement 30 October 2026. Refs #863, #814, #860.

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

## Implementation state — 30 October 2026

The original local proof was superseded by Draft [PR #870](https://github.com/caliofmarian-ai/Acounting-business-and-life/pull/870), issue #863. Canonical `main` and `https://caliof.com` do **not** contain this branch.

Implemented and source-tested:
- Provider-gated conversational draft reducer and typed/push-to-talk Android companion (English PH/Filipino), with explicit transcript review before AI; no raw audio/transcript storage or AI write tool.
- Authenticated exact-business Merchant Catalog turns and rate-limited model provider; `store:false`, no fabricated Catalog IDs/prices, no speaker biometric identity claims.
- Signed two-minute server Catalog quote, exact identity/session/variants/modifiers/quantity/price check, unpaid cash pickup, and no receipt/payment inference.
- Shared canonical `createOrder` PostgreSQL client handling: normal Orders behavior retained; voice approval uses an outer unique business/account/request-key transaction and current Catalog snapshots. Existing high-risk `order_create` velocity gate applies only to new approvals, not replay.
- Recent V2-session password step-up checked under PostgreSQL `FOR SHARE` to prevent revoke-before-commit. This **does not** replace a device-held credential.
- Android operator UI has a separate manual Confirm action, reads back the current total and unpaid status, and preserves one idempotency request key for explicit retries. Browser microphone is supported where available with consent; this is push-to-talk turns, not full duplex.

Verified: focused local Node tests, repository CI, Admin Runtime Contract, plus a dedicated isolated real PostgreSQL 16 GitHub Actions run [#41145267196](https://github.com/caliofmarian-ai/Acounting-business-and-life/actions/runs/41145267196) that passed parallel duplicate claims, transaction rollback, business-scoped request keys and session-revocation lock. Android-sized Chromium synthetic-API interface traversal also passed on 390 px width without JS errors or horizontal overflow. These are NOT authenticated real-Merchant Preview or physical Android acceptance.

**HARD RELEASE BLOCKER:** `ORDER_VOICE_CREATE_ENABLED=1` by itself CANNOT enable order creation. Server confirmation `ready()` also requires a real injected, server-side `verifyDeviceApproval` callback. No such device-held/passkey verifier is wired in the Production server; capabilities expose `can_confirm_order=false`. A one-time human confirmation phrase and vetted WebAuthn/passkey/device-held proof, scoped to account/session/business/signed quote and consumed atomically, must be implemented and independently audited before turning on voice order posting. Never replace this with a browser-supplied boolean, LLM judgment, ASR speaker label or password-only step-up.

**Remaining QA:** real authenticated Android mic/customer/background tests, same-account two-business switch, real Merchant Catalog/stock/Orders totals, temporary network disconnect + retry after committed create, independent device approval credential tests, serialized exact-head Preview acceptance, reviewed merge, production deployment SUCCESS and direct `caliof.com` smoke. Do not close #863 yet.

## Primary references
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
- OpenAI Realtime VAD: https://developers.openai.com/api/docs/guides/realtime-vad
- OpenAI Realtime transcription limitations: https://developers.openai.com/api/docs/guides/realtime-transcription
- OWASP LLM06 Excessive Agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
