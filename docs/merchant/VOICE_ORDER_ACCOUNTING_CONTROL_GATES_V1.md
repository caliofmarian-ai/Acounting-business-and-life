# Merchant Voice AI — accounting and operator safety gates

Status: Design / non-writing local proof only. Owner requirement 30 October 2026. Refs #863, #814, #860.

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

## Implementation state
Local source proof comprises merchant-voice-order-core.js, merchant-voice-order-provider.js, merchant-voice-order-approval-core.js plus three test files: 28 local Node tests PASS, 0 FAIL. This GitHub document does NOT deploy those local files, is NOT authenticated Preview QA, and does NOT authorize production activation.

## Primary references
- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
- OpenAI Realtime VAD: https://developers.openai.com/api/docs/guides/realtime-vad
- OpenAI Realtime transcription limitations: https://developers.openai.com/api/docs/guides/realtime-transcription
- OWASP LLM06 Excessive Agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
