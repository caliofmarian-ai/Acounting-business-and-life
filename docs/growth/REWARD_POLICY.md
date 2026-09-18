# Referral reward policy — safe default

## Current state

Referral acquisition can be implemented and measured before a reward economy is activated.

The canonical default is:

`status = disabled_pending_owner_policy`

No cash amount, subscription period, fee credit or other benefit is currently assumed.

## Why

A referral system needs two separate decisions:

1. **Attribution** — who introduced a new account and through which campaign/channel.
2. **Reward economics** — what qualifies, who receives a benefit, what that benefit is, and what limits apply.

Implementing attribution does not authorize an invented reward.

## State boundary

`signed_up` means registration completed.

`qualified` means a future owner-approved qualification rule was satisfied.

`rewarded` means a versioned reward policy actually granted a benefit.

These states must not be collapsed.

## Candidate reward forms

Future policies may use:
- subscription or feature credit;
- platform-fee credit;
- promotion/visibility boost;
- non-cash ambassador status;
- cash/currency value only after explicit commercial/legal/accounting approval.

## Required owner decision before activation

A reward policy must specify:
- qualification rule;
- referrer benefit;
- referred-user benefit, if any;
- reward type/value;
- territory/profile applicability;
- per-account or campaign caps;
- effective dates;
- abuse/fraud exclusions;
- accounting/tax treatment where relevant.

Until those values are explicitly decided, `enabled=false`.
