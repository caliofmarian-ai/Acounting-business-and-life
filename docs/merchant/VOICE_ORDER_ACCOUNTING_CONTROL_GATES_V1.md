# Merchant Voice AI — operator identity and accounting safety

Status: **V1F source implementation in Draft PR #870, NOT in Preview or Production.** Issue #863; related Orders #814/#852 and Inventory #841. Owner acceptance only on `https://caliof.com` after deployment and independent QA.

## Canonical business model

- One existing Business & Life account can own **one Merchant profile and one business**, with many human operators inside that business. Staff operators are **not** new top-level platform accounts, Merchant profiles, companies, or separate financial ledgers.
- Staff are business-scoped subidentities in `merchant_team_operators`. An operator may be active, temporary with an expiry, or immediately disabled by the owner. Each action must identify the actual operator, not simply the owner account.
- An operator's PIN is a shift credential, **not** a login to the owner's main account. No owner password, account bearer, or broad financial role may be shared with staff.
- Roles `manager`, `order_operator`, `temporary` currently allow read-only Orders and voice drafts; `stock_helper` currently has read-only stock scope. No staff scope permits Money, payments, refunds, financial transfers, account settings, or staff management.

## Separate worker terminal — V1F

The original in-account shift picker had a security flaw: while the owner's main login cookie remained valid, hiding Money controls did not prevent access to privileged owner APIs. **Do not launch staff operations in the primary logged-in Merchant shell.**

New V1F operator access is separate and explicitly gated:

1. Authenticated, recently password-verified business **owner** issues a **one-time, 10-minute** pairing code. The code is randomly generated and only its HMAC digest is stored. The private link uses a URL `#fragment` so the code does not appear in request URL logs.
2. The worker opens `/operator` on a separate phone/browser context, or signs the owner completely out of a shared browser. The staff API **rejects any request that still carries the owner's `__Host-abl_session` cookie**. The link alone is not enough: the worker selects their own authorized name and supplies their individual PIN.
3. PostgreSQL validates the code, exact business/owner membership and enabled Merchant profile, active operator and PIN. Wrong PIN increments a durable counter; after repeated attempts the link is unusable. Successful sign-in consumes the pairing code and issues a separate `__Host-abl_operator` **Secure, HttpOnly, SameSite=Strict** session, expiring no later than eight hours or the operator assignment expiry.
4. The staff terminal has only `/api/orders/operator/*` routes for a scoped operator session, live catalog, limited order status and AI non-posting draft/quote; mutating staff routes require session-specific CSRF. It does not mount the ordinary Business & Life account UI and cannot call its privileged Merchant Money endpoints as the owner.
5. Server-side operator disablement, business/owner suspension and expiry invalidate future worker API access immediately. Switching workers creates a different session/voice draft binding. Each shift and step remains attributable to a business and person.
6. The staff catalog projection omits **unit costs, Inventory internal identifiers, supplier terms and sensitive financial information**, while retaining the sellable products/options needed for drafting.

The original owner-cookie-backed worker-shift endpoints are **blocked** whenever the dedicated terminal is enabled. Owner management remains available through the existing Merchant profile.

## AI and order-writing authority

- AI listens only after explicit consent and an operator-activated microphone or edited text. Speech recognition is **not** identity verification. The model may suggest a draft only; exact-business Catalog IDs/variants/modifiers/quantities and current prices are verified by the server.
- A server-generated HMAC quote lasts two minutes and binds the business, operator session, customer, lines and integer PHP centavos. Neither AI nor client can supply an authoritative price or payment state.
- The **staff terminal deliberately has no order-posting, payment, refund, stock mutation or account-impersonation endpoint** in V1F. `creates_orders=false` is returned for worker drafts/quotes. The outstanding release-critical work is **per-operator device-held passkey/approval, independent server authorization and atomic canonical Order-to-operator attribution**; an owner-level passkey cannot silently approve an employee's sale.
- The existing account-level experimental confirmation code remains off by default when Team mode is enabled. It uses the canonical Orders engine, same PostgreSQL transaction and idempotency key, but **is not authority for staff orders**.
- A confirmed pickup/cash order is **UNPAID**; order creation does not prove payment. Only verified payment/receipt workflows may mark money received or change ledgers. Daily, weekly, monthly and annual reports always derive from canonical Orders, Inventory and payment records, not AI text.

## Feature flags (none enabled in Production by this PR)

- `MERCHANT_TEAM_ENABLED=1`: internal Merchant operator roles/management; requires secure worker access before commercial use.
- `MERCHANT_TEAM_TERMINAL_ENABLED=1`: separate staff-only pairing and operator terminal. Both Team flags must be on, and the terminal requires server-side secrets.
- `MERCHANT_TEAM_SECRET` and `MERCHANT_TEAM_PIN_PEPPER`: server-only, independent high-entropy secrets; never expose in browser, source, CI logs or issue text.
- `ORDER_VOICE_AI_ENABLED=1`, `ORDER_VOICE_AI_MODEL`, `OPENAI_API_KEY`: separately reviewed consent-gated provider. Without these, manual Catalog and limited order viewing remain possible but AI drafts report unavailable.
- `ORDER_VOICE_UI_ENABLED=1`: experimental main-account Merchant voice companion; not the worker account permission model.
- `ORDER_VOICE_WEBAUTHN_ENABLED`, RP ID and HTTPS Origin, separate initial enrollment gate, `ORDER_VOICE_CREATE_ENABLED`: previous account-level passkey/confirmation experiments; they do **not** authorize employee orders. Do not enable public first-passkey bootstrap without a reviewed independent recovery process.

## Acceptance evidence and remaining gates

Exact V1F implementation is in Draft PR #870 on the issue-numbered branch, with new unit/source tests and dedicated disposable PostgreSQL 16 staff security suite. The branch's CI must pass **at its latest head**, not at a past commit. Tests cover: one company/two operators, pairing TTL, one-time use, wrong PIN, independent cookies/CSRF, main-owner cookie rejection, permission denial for Money, immediate employee revocation, business switching and Catalog cost filtering.

**Not yet completed:** actual authenticated Merchant Owner-to-Worker pairing via live Preview, physical Android camera/microphone and native passkey QA, independent threat/security review, employee credential-backed *order confirmation*, operator-to-canonical-order audit under a single transaction, serialized Preview acceptance without disrupting the Orders #820 owner, reviewed merge, Production deploy SUCCESS, and direct verification of `https://caliof.com`. Until then, keep #863 OPEN and #870 DRAFT, no commercial worker activation or owner acceptance claim.

## References

- NIST SP 800-63B-4: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP LLM06 Excessive Agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- OpenAI speech recognition and VAD documentation: https://developers.openai.com/api/docs/guides/realtime-vad