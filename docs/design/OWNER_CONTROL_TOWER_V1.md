# Owner Control Tower V1 — implementation foundation

Issue: #626  
Figma: https://www.figma.com/design/Tsh8jeXLNxhUdazKrGoba7

## Status

This branch implements the isolated, non-conflicting foundation for #626 while PR #623/#628 own shared Admin runtime files.

Implemented in this slice:
- truth-preserving read model;
- Production parity state from supplied release evidence;
- Payment/Support/Safety health normalization;
- Owner-only decision queue filtering and deduplication;
- territory/finance/product-quality safe summaries;
- mobile-first HTML renderer;
- Admin-theme CSS matching the validated Figma hierarchy;
- regression tests for unknown evidence, no fake zero, authority filtering and privacy whitelisting.

Not yet wired:
- `/api/admin/owner-control-tower`;
- Admin navigation/home integration;
- Payment exception aggregate;
- severe safety aggregate;
- territory capacity aggregate;
- release parity adapter.

Those integrations are deferred until the shared Admin files owned by active PRs are reconciled.

## Safety invariants

- Unknown evidence stays unknown.
- Missing decision source never renders "No Owner decisions waiting".
- GMV is not treated as platform revenue.
- Territory summaries whitelist aggregate fields and exclude PII/live Courier coordinates.
- Routine delegated Admin work does not enter the Owner decision queue.
- Decision records point to canonical evidence; they do not duplicate canonical financial/legal state.
- Renderer does not fetch infrastructure credentials or raw private evidence.

## Release boundary

This isolated slice has no production route until integration is completed.

A future integration PR must still pass:
CI → exact-head Preview → real Admin functional QA → merge → exact Production SHA → smoke.
