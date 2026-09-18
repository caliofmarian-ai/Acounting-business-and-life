# Money & Banking V1 — Figma source

Status: **DESIGN SOURCE FOR IMPLEMENTATION**

Figma file:
https://www.figma.com/design/9gNwZeoAicQ2aH3UAab3zu

Primary mobile screen nodes:
- `1:323` — `Money & Banking — Mobile`
- `2:2094` — `Transfer between profiles — Mobile`

## Canonical UX

The Avatar / Account owns the external financial identity.

The screen contains:
- account-level Financial Identity;
- profile internal Balance overview;
- `Pay`, `Transfer`, `Withdraw` primary actions;
- account-level payout / withdrawal destination;
- provider-tokenized saved payment methods;
- security / evidence boundaries.

Profiles keep separate internal Balance, budget and activity, but do not repeat bank/card configuration.

## Payment rule

Direct Customer payment does **not** require a pre-funded Business & Life Balance.

Customer may pay through supported provider methods even when internal Balance is zero.

Internal Balance may be used only when evidence-backed funds exist.

## Transfer rule

`Transfer` moves recorded internal funds only between active profiles/workspaces of the same account.

It does not:
- create platform revenue;
- create business profit/expense;
- move provider/bank/e-wallet cash;
- use planned Budget as Balance.

## External finance security

Business & Life must not store:
- raw card PAN;
- CVC/CVV;
- card PIN;
- full bank credentials entered as ordinary app data.

Saved cards/payment methods are provider-tokenized.
Payout destinations use masked display metadata and provider references when a verified adapter is available.

## Implementation rule

Use this Figma file as the visual source for `Avatar → Money & Banking`.

Do not create separate external bank/card forms for Customer, Merchant, Supplier, Courier and Service Provider.
