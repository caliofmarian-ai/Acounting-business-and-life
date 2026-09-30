# MICROBUSINESS READINESS ACTIVATION V2

Status: implementation contract for #642, derived from #620.

## Purpose

Turn the #620 formalization model into a production commerce gate without making Business & Life a government licensing authority and without breaking already-operating Production users on activation day.

## Who decides

Government agencies, LGUs and professional regulators remain authoritative for permits, registrations, licences, sanitary approvals, tax registrations and other official requirements.

Business & Life does **not** issue or replace those authorities.

The initial Business & Life commerce-readiness reviewer is an **active Super Admin**. The reviewer records whether each applicable requirement has been resolved and the evidence/source used. Profile Authorization remains a separate prerequisite and does not itself grant commerce readiness.

A later delegated-review model may be added only with explicit permission/scope rules; V2 does not silently delegate this decision.

## What must be reviewed

Every grant of `eligible_limited` or `eligible_full` requires:

1. active platform Profile Authorization;
2. a completed activity track;
3. a completed operating context;
4. a review reason;
5. every policy checklist item resolved.

Common checklist:
- activity scope confirmed;
- operating context confirmed;
- business-registration requirements resolved;
- tax / invoice / receipt record requirements resolved.

Food adds:
- location / vending-authority requirements resolved;
- food-safety / sanitary requirements resolved.

Non-food adds:
- location / vending-authority requirements resolved;
- regulated-goods requirements resolved.

Local Services adds:
- service-category scope resolved;
- professional / regulatory credential requirements resolved.

A legal/regulatory item may be marked `not_applicable` only where the policy permits it and only with:
- the source/authority used;
- a reviewer reason.

Items that define the actual platform scope (activity, operating context, Local Services category scope) cannot be marked not applicable.

A `verified` item requires an evidence or record reference and a source/authority.

## Commerce states

### readiness_only

Private/internal preparation remains available. Public commerce gates remain unavailable when enforcement applies.

### eligible_limited

All required review items are resolved, but commerce is restricted to an explicit scope recorded in `commerce_scope` (for example a territory, exact activity/category or pilot capability).

### eligible_full

All required review items are resolved and the platform review permits the full currently-supported commerce scope for that profile/activity.

Neither eligible state means “government approved”.

## Production activation

### Phase 1 — deploy policy V2

Deploy code and schema with Production enforcement unchanged.

### Phase 2 — establish transition cutoff

Set `MICROBUSINESS_READINESS_TRANSITION_CUTOFF` to the exact activation timestamp.

Set:

`MICROBUSINESS_READINESS_ENFORCEMENT=transition`

Transition mode is enforcement ON.

It behaves as follows:
- profiles/businesses with governed `eligible_limited` or `eligible_full` continue normally;
- a Merchant storefront that was already published **and** had active Merchant Profile Authorization approved on/before the cutoff receives a temporary Production transition allowance;
- a Local Services profile that was already public/active **and** had active Service Provider Profile Authorization approved on/before the cutoff receives the same temporary transition allowance;
- new subjects after the cutoff do not receive that allowance and must pass the evidence-driven readiness review;
- a previously public subject that becomes private/paused does not gain a permanent bypass merely because it once existed.

This prevents activation day from silently breaking established Production commerce while still enforcing the new rules for new commerce.

### Phase 3 — review legacy transition subjects

Super Admin reviews each transition subject against V2 policy and moves it to:
- `eligible_limited`,
- `eligible_full`, or
- `readiness_only`.

### Phase 4 — full enforcement

After all transition subjects are reviewed, set:

`MICROBUSINESS_READINESS_ENFORCEMENT=full`

At this point only governed eligible states pass the readiness commerce gate. Remove the transition cutoff only after verifying no Production subject still depends on transition allowance.

## Safety boundaries

- no government fee/tax collection;
- no claim that Business & Life legalizes a business;
- no anonymous production commerce;
- no self-grant of commerce eligibility;
- no self-declaration of Verified/Growing;
- no exact address made public by readiness;
- no duplicate identity/location/authorization system;
- evidence references and decisions are audited;
- revoking to `readiness_only` still pauses Merchant publication or makes Local Services private through the existing governed flow.

## Production acceptance

Before declaring V2 activated:
- Production deployment SUCCESS;
- Production `/health` PASS;
- Production env reports `transition` (or later `full`) as intended;
- existing pre-cutoff public/authorized subjects remain reachable;
- a new/unreviewed subject cannot become publicly transactable;
- a fully reviewed fixture can become eligible;
- readiness review audit records policy version and checklist outcomes;
- no real-money test transaction is required.
