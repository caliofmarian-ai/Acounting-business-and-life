# Receipt Intelligence V1A — Merchant, Philippines

Status: **IMPLEMENTED ON ISOLATED DRAFT BRANCH / NOT IN PRODUCTION**. Parent #860. Depends on purchase-photo vault #856 / PR #858 and exact Inventory mutation authority #841.

## Purpose and strict boundary

A photograph of a shop/Supplier receipt is evidence of a commercial document, **not** confirmation of physical receipt, availability, a payment, or a BIR-valid tax invoice. This implementation reads that private original, proposes Inventory matches and lets a human save a *review plan*; it does **not** update Inventory, Accounts, Supplier PO or Catalog.

A permanent receipt source remains in `merchant_purchase_documents` from PR #858. The new tables `receipt_intelligence_drafts` and `receipt_intelligence_reviews` hold bounded suggestion/review metadata and audit history, not a second financial ledger or a copy of the raw photo.

## Implemented flow

1. Merchant opens **Stock → Read receipt → Prepare stock**.
2. Choose an existing business-scoped original receipt archived through #856.
3. Select **Analyze saved photo** and give explicit per-document permission to send the image to the configured provider. If unavailable, choose manual transcription. PDF originals can be archived but the current image adapter does not yet analyze PDF.
4. Extract header + item text, quantity, pack-size, unit, price, totals, source evidence and confidence. No unknown numeric field is guessed; decimals are parsed as exact cent units.
5. Suggest exact same-business matches by barcode, SKU, normalized name and previously confirmed alias; similarity always remains a candidate and never becomes an automatic foreign-key link.
6. Check document total against sum of extracted lines and explicit charges. Unknown line quantities/totals and mismatches remain visible.
7. Merchant reviews each line, chooses whether physically received / nonstock expense / excluded / needs investigation, confirms exact Inventory product, amount, unit and cost, then **saves an immutable review event**.
8. Review state is *reviewed_pending_physical_receiving*. The UI clearly states **stock unchanged**. Canonical physical receiving will be implemented only after #841 and #856 are accepted, using exact tenant authority and idempotency.

## APIs (canonical Supplier procurement runtime)

- `GET /api/procurement/receipt-intelligence/config?business_id=...`
- `GET /api/procurement/receipt-intelligence/inventory?business_id=...` (same-business products only)
- `GET /api/procurement/purchase-documents/:id/intelligence?business_id=...`
- `POST /api/procurement/purchase-documents/:id/intelligence/manual` (`business_id`, `extraction`)
- `POST /api/procurement/purchase-documents/:id/intelligence/analyze` (`business_id`, `allow_external_processing: true`)
- `POST /api/procurement/purchase-documents/:id/intelligence/review` (`business_id`, `draft_id`, `expected_version`, `client_request_key`, `decisions`)
- `GET /api/procurement/receipt-intelligence/count-sessions/:id/variance-evidence?business_id=...`: read-only evidence for count `review` or `posted`. **Never reveals expected quantity during blind counting**.

The app's session/auth, enabled Merchant profile and exact active business membership remain the authority. Request paths and IDs are not accepted as authorization. No direct stock or money mutations appear in this module.

## Provider configuration (explicit opt-in only)

Current image adapter supports JPEG/PNG/WEBP and OpenAI Responses JSON-schema output. AWS Textract AnalyzeExpense can be normalized if an authorized AWS runner is added later. These environment variables must be separately reviewed/configured by the platform owner or release operator:

- `RECEIPT_AI_ENABLED=1`
- `RECEIPT_AI_PROVIDER=openai`
- `RECEIPT_AI_MODEL=<reviewed vision-capable model>`
- `RECEIPT_AI_API_KEY=<secret>`

**None are set by this PR.** The integration fails closed without explicit configuration and per-document Merchant consent. The model request uses `store:false`, constrained structured JSON, and `detail:original` for small receipt text. Payloads are fetched solely from the malware-scanned private evidence vault. Do not log raw file bytes, personal data, tokens or the provider key. AI calls incur separate usage costs and must not start automatically merely because a receipt was uploaded.

## Duplicate prevention, confirmed aliases and provider cost control

The Merchant is warned if another receipt in the same business has the same original file digest or matching supplier, document number, date and amount. Suggestions never automatically create or reverse an Inventory transaction. The current OpenAI call budget defaults to **30 analysis attempts per business per 24 hours**; the operator can set `RECEIPT_AI_DAILY_LIMIT` between 1 and 100. This is a safeguard against unintended model expenses, not a promise about provider billing.

When the Merchant explicitly confirms that a receipt line represents an existing Inventory item, an alias can be learned for that exact Merchant business and named supplier. The alias mapping is audited by the related review event, and similarity/alias matches still require explicit selection in subsequent receipts. A supplier name that cannot be identified does not create an alias.

## Physical count and fraud safeguards

Existing #718 blind count, review and posted variance safeguards remain unchanged. Variance evidence is exposed only after the server confirms count status `review` / `posted`; it includes recent actual purchases and originals when linked. Photos can help investigate a mismatch but cannot prove present stock.

Duplicate scans of the same original are deduplicated by scoped receipt + source digest. Concurrent analysis claims one `processing` row; failed analyses are not silently retried at cost. Review uses a stable idempotency key and version check to avoid duplicate or stale manual amendments.

## Release/testing evidence and remaining tasks

- Node syntax and deterministic tests for receipt amounts, multipacks, unknown tray counts, same-business product matching, total mismatch, unknown physical quantities, provider consent, constrained JSON and no writes.
- Exact-head isolated Preview must verify real image upload, clean scan, output model rejection/missing config, wrong-business denial, privacy, real device capture, multi-item review, provider timeouts and count blind boundary.
- Acceptance is Production-only at **https://caliof.com**, after successful Preview, merge, production deployment and production verification. No Owner preview acceptance.
- **Not in this V1A**: automatic inventory posting, PDF AI OCR, provider price optimization, controlled 50–100 receipt accuracy pilot, complete reconciliation of charges/refunds or supplier payment, offline queue, count-evidence UI panel. These remain in #860 as further independently reviewed slices.

Official references used for the provider contract:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/images-vision
- https://docs.aws.amazon.com/textract/latest/dg/expensedocuments.html
- https://docs.cloud.google.com/document-ai/docs/processors-list

## V1B — read-only receiving preflight and count evidence UI (2026-10-30)

New modules in PR #861:

- `receipt-receiving-preflight.js` groups reviewed source lines by authorized existing Inventory item and base unit, without posting goods or costs.
- Merchant receiving readiness GET validates the saved review, source totals, cross-business item identity, existing receipt-to-purchase links and possible duplicate receipt sources. It reports reasons/flags and never returns stock-posting permission.
- Multiple receipt lines for the same item are grouped; no expense is generated and charges/discounts are never allocated silently.
- The review button now shows the preflight details and explicitly states that receipt posting is disabled.
- Review-idempotency keys include a SHA-256 submission fingerprint. A retry with the same key and changed quantities or linked items is rejected.
- The Guided Inventory Count → Review pane now has a **Check scanned receipts for stock differences** button. It obtains the current Review session from the server and shows existing private original links and last recorded purchases without changing stock. Blind-count mode hides it, and the server separately refuses evidence access until status is review or posted.

### Release hold: do not enable stock writes yet

Existing `/api/inventory/purchase` records a single-line purchase, expense and lot; invoking it repeatedly for a scanned receipt risks partial stock updates or duplicate bookkeeping. Safe activation requires an atomic, idempotent batch receiving adapter with exact-business authorization after #841 and original vault #856 are reconciled. No invoice/PO/payment/stock is changed in this V1B slice.

### Remaining checks

- Exact-head CI, controlled isolated Preview file/scan/Android tests, malformed document and cross-business negative tests.
- Reconcile PR #858 before PR #861 and rebase the shared `server-suppliers.js` composition without displacing another agent's Preview deployment.
- Production release and owner acceptance strictly at https://caliof.com, after exact production deployment and smoke.

## Agent coordination

This slice only touches isolated new modules plus the Supplier procurement composition entrypoint. It does **not** edit the active agents' Inventory mutation logic (#841/#821), Merchant Orders, catalog AI (#845/#170), and Promotion Center (#836). Because the pending receipt vault #858 touches `server-suppliers.js` too, reconcile its reviewed exact head first and rebase this PR before promotion.