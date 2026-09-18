# Converted referral attribution runtime

## Scope

This slice prepares the account-binding step for Issue #46 without activating it in production.

The runtime can bind a newly created account to an existing, unexpired `referral_pending_attributions` row only after explicit converted-attribution policy gates are approved.

Until those gates are satisfied, registration carries referral context but the binding adapter performs **zero database work**.

## Registration sequence

For a valid referral registration:

1. the browser sends `referral_signup_started` to the same-origin referral analytics endpoint;
2. registration waits for that request to complete before sending the create-account request, preventing a race where conversion could arrive before pending attribution exists;
3. the registration request carries only:
   - opaque referral code;
   - source profile role;
   - existing session correlation id;
4. account creation commits independently;
5. the server calls the converted-attribution binding adapter;
6. a binding failure or HOLD never rolls back or blocks the account;
7. `referral_signup_completed` is emitted only after a successful, non-idempotent binding.

## Mandatory conversion gates

Converted binding also depends on the pending-attribution pipeline being genuinely active. It does not auto-create a pending row or bypass the pre-conversion privacy gates.

Binding is inactive unless all of these are true:

- `REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED=true`
- `REFERRAL_ANALYTICS_RETENTION_APPROVED=true`
- `REFERRAL_ANALYTICS_LAWFUL_BASIS_APPROVED=true`
- `REFERRAL_ATTRIBUTION_CONVERTED_ENABLED=true`
- `REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_APPROVED=true`
- `REFERRAL_ATTRIBUTION_CONVERTED_LAWFUL_BASIS_APPROVED=true`
- `REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_DAYS=<approved integer>`
- `REFERRAL_ATTRIBUTION_CONVERTED_POLICY_VERSION=<approved policy version>`
- `REFERRAL_ATTRIBUTION_CONVERTED_MODEL=<explicit approved model>`
- `REFERRAL_ATTRIBUTION_HMAC_SECRET=<same dedicated secret used by pending attribution>`

There is intentionally **no default converted retention period and no default attribution model**.

The current implementation supports `registration_context_v1`: bind the valid referral context that is present on the registration flow. Merely supporting that implementation does not select it as policy. `growth/privacy-guardrails.json` keeps the chosen attribution model at `null`, and activation requires `REFERRAL_ATTRIBUTION_CONVERTED_MODEL=registration_context_v1` to be set explicitly after Owner/policy approval.

If Owner policy chooses first-touch, last-touch or another model, converted binding remains fail-closed until that model is implemented and added to the supported set.

The code accepts a configured retention period only as an implementation parameter after policy approval. Repository documentation and machine-readable guardrails keep converted retention at `null` while the Owner/legal decision is unresolved.

## Binding evidence

When enabled, the adapter:

- reconstructs the HMAC correlation hash from the referral code, profile role and browser correlation id;
- requires an existing, unexpired pending-attribution row;
- never looks up a pending referral by raw email or phone;
- rejects self-referral when the referrer account equals the newly created account;
- enforces one converted referral attribution per referred account;
- treats repeat binding to the same referrer/code as idempotent;
- rejects attempts to replace an already-bound account with a different referral;
- consumes the pending-attribution row after a successful/idempotent/rejected conversion decision.

## Converted retention metadata

A successful binding records:

- `retention_policy_version`;
- `retention_days`;
- `expires_at`;
- pseudonymous `correlation_hash`.

The raw browser correlation id is not stored in the converted attribution table.

Expired converted rows may be purged according to the approved converted-attribution policy. Rewarded rows are excluded from the generic converted purge because any future reward/payment evidence requires its own accounting/tax retention classification.

## Authority boundary

Referral conversion can attribute acquisition only.

It cannot:
- activate Merchant/Supplier/Courier/Service Provider authority;
- grant Admin rights;
- bypass credential/territory approval;
- qualify a referral;
- create or pay a reward.

Qualification and reward transitions remain separate, disabled domains.

## Current production state

Current canonical policy still has:
- converted-attribution retention rule: **unresolved / null**;
- converted binding: **disabled by default**;
- reward economics: **disabled**.

Therefore no production environment should set the converted-attribution activation variables yet.
