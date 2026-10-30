# Customer Purchase Documents V1 — Philippines

Status: **DRAFT PR / NOT DEPLOYED**. Issue #857.

## Purpose
A Merchant may send the registered Customer a private order/payment record by email after a purchase. Both participants retain the immutable account-scoped document for bookkeeping. This is **not** automatic BIR fiscal invoicing.

## Accounting boundaries
- Primary economic sources: `orders`, `order_items`, `order_payments`, current `paid_amount`, `outstanding_amount`, and existing finance document engine #247.
- New `customer_sales_documents` stores immutable JSON snapshots by `(order_id,source_sha256)`. A different recorded payment status creates a new snapshot rather than rewriting an old one.
- Document types are `payment_record` when the Merchant's authoritative Order shows a positive `paid_amount`, and `order_summary` for a completed order with no recorded payment.
- An Order Summary is **never** presented as payment evidence. A Merchant Payment Record is **not independent bank/PayMongo settlement proof**.
- The snapshot is classified `internal_evidence`, `official_tax_invoice:false`, with explicit non-BIR disclaimer. Only a separate verified fiscal issuer workflow can create legally compliant invoices.
- No new `orders`, `order_payments`, `transactions`, tax amounts, discounts or payments are synthesized.
- A cancelled order is excluded from this first send workflow; refunds/credits require subsequent append-only fiscal evidence.

## Email delivery
- Merchant must be authenticated, active in Merchant role, authorized for the requested exact business and bound via membership.
- Source Order must belong to that Merchant business and the Customer must have an **existing account with verified email**; the target address comes only from account records, never from Merchant input.
- Before sending, create/reuse a snapshot for actual Order balances, then create one audit entry per explicit request.
- Replayed `client_request_key` is idempotent. A new send within five minutes is throttled; the send returns **queued**, not **delivered**, until Resend provides delivery evidence.
- Reuses the canonical Communications V2 notification queue with English/Filipino templates, Merchant billing sender route and no extra standalone mail provider. The worker verifies email remains verified before final send.
- Email includes Merchant, Order number, item summary, total, Merchant-recorded payment, amount due and fiscal disclaimer, with a secure in-app action. Complete line items remain in the private account record.
- Notification delivery worker status and provider webhook evidence remain the authority for actual send/delivery results.

## UI
- Merchant: Orders → **Email receipts / Order documents**. Shows recent eligible orders of the selected business, verified-email eligibility, **Email purchase document**, and archive.
- Customer: My Orders → **My receipts / Order documents**. Shows only documents addressed to that account.
- The original snapshot is viewable, printable and browser-saveable as PDF through a signed-in same-origin endpoint; HTML is escaped and carries no-store/CSP headers.
- The UI is injected separately rather than editing the active Orders agent's pages.

## API
- `GET /api/notifications/order-sales-documents/merchant-orders?business_id=...`
- `GET /api/notifications/order-sales-documents/business?business_id=...`
- `POST /api/notifications/order-sales-documents/orders/:id/send`, body `{business_id,client_request_key}`.
- `GET /api/notifications/order-sales-documents/my`
- `GET /api/notifications/order-sales-documents/:id`
- `GET /api/notifications/order-sales-documents/:id/print`

## Release gates and remaining work
- Node syntax + tests `node --test tests/customer-sales-documents-v1.test.js` and repository CI.
- Isolated Preview with verified test Merchant and Customer: fully completed paid order, completed order with credit, duplicate sends, expired email verification, wrong business, wrong customer, XSS and email queue/provider unavailable.
- **Manual Android Customer and Merchant login** with print/download and live email delivery status; no customer mail to real people during QA.
- Exact-head Preview QA PASS, merge reviewed SHA, exact production deploy, automated production smoke at `https://caliof.com`.
- Remaining issue #857: automatic issuance for all payment methods, receipt email delivery status prominently in UI, legally compliant Merchant tax Invoice when authorized, split/partial payments/refunds/credit records, downloadable PDF generation beyond browser Print-to-PDF, email receipt contents/branding audit.

**Owner acceptance is production only.** No code in a Draft PR is ready for customers until the full release process passes.
