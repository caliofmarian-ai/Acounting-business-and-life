# Merchant Purchase Documents V1 — Philippines

Status: **DRAFT PR / NOT DEPLOYED**. Issue #856. Parent evidence standards: #247, #341 and #32.

## Owner requirement
A Merchant can retain the original supplier/shop receipt or invoice received while purchasing goods for Inventory, including ingredients and packaging. One photographed shop receipt can belong to several stock-purchase records. This module is not an independent ledger.

## What this slice adds
- Stock → **Purchase receipts · Save / View**, reachable on mobile when the Merchant workspace is active.
- Take photo or choose existing JPEG/PNG/WEBP/PDF; upload ceiling 6 MiB. Camera capture depends on the Android browser's supported file input.
- Optional issuer, document number, issue date, total, document class, note, and multiple recent `inventory_purchases` links. The original remains accessible via an authenticated scoped download.
- Metadata-only saving when a source document is missing; an unlinked record remains separate evidence and does **not** mark a payment or create Inventory stock/expense.
- Business-scoped idempotent save: the same `client_request_key` with the same content returns the existing document; same key with changed content rejects 409.
- Private binary objects use existing S3-compatible storage + malware scanning and audited access; metadata tables contain only opaque references.
- Original document is not editable. Application metadata is a separate record; historical accounting cannot be rewritten through this interface.

## Routes (existing Supplier-owned gateway)
- `GET /api/procurement/purchase-documents/linkable-purchases?business_id=...`
- `GET /api/procurement/purchase-documents?business_id=...`
- `POST /api/procurement/purchase-documents`
- `GET /api/procurement/purchase-documents/:id?business_id=...`
- `GET /api/procurement/purchase-documents/:id/file?business_id=...`

Every route requires an authenticated enabled Merchant profile with an exact active business binding/membership. POST carries `business_id`, `client_request_key`, metadata, an optional `data_url`/filename, and `links:[{kind,id}]`. Every linked record must belong to the same business.

## Evidence versus economics
- Supplier-issued invoice is distinct from Purchase Order, goods received, payment and bank settlement.
- A paper order slip or POS receipt may be supplementary only; never assert BIR fiscal validity automatically.
- No second expense, revenue, Supplier payable, payment intent or Inventory movement is created.
- Keeping originals and immutable source links supports future periodic statements and export, subject to jurisdiction-specific accounting retention policy.

## Before release
1. Run `node --check merchant-purchase-documents.js`, `node --check public/purchase-documents-ui.js`, and `node --test tests/purchase-documents-v1.test.js`.
2. Exercise on isolated Preview with the real photo/PDF scanning and private storage configuration, verify account & business IDOR denial, file size, malicious file rejection and wrong-profile rejection.
3. Test Android file picker, camera, multi-item linking, late responses after switching Merchant business, idempotent retries and download privacy.
4. Confirm exact reviewed head on Preview. Promote only after QA PASS, then verify production exact SHA and smoke on `https://caliof.com`.
5. Remaining #856 acceptance: inline attachment directly during Inventory purchase, links to Supplier invoice/PO from their own forms, archived document filters, supplementary upload and full fiscal export/retention decisions.
6. Customer invoice/receipt email is **separate issue #857**. No part of this PR sends Customer financial e-mails.

No production acceptance or live customer-facing claim exists until deployment evidence is recorded.
