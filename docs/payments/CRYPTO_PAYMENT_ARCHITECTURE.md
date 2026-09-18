# Crypto Payments Architecture — Philippines

Status: **DESIGN CONTRACT / LIVE DISABLED**

Canonical issue: #188 — CRYPTO PAYMENTS V1.

## Decision

Business & Life Philippines supports crypto as an optional payment rail behind the same provider-neutral Payment Core used by fiat payments.

Crypto does not replace PayMongo. PayMongo remains the first fiat-online provider for GCash, Maya, QR Ph, card and other enabled methods. Crypto uses a separate VASP/provider adapter.

## Non-negotiable boundaries

Business & Life must not become a crypto exchange, custodial wallet or holder of customer private keys/seed phrases.

The PH commercial amount remains canonical in **PHP**. A crypto quote is a temporary payment representation of that PHP liability, not a second commercial price.

No client redirect, QR display or blockchain transaction hash alone may mark an order paid. Payment succeeds only after server-side provider evidence passes the canonical Payment Core checks.

## Provider adapter contract

Every crypto adapter must implement:

- `createQuote()`
- `createPaymentIntent()`
- `getPaymentStatus()`
- `verifyWebhook()`
- `reconcilePayment()`
- `requestRefund()`
- `getSettlementEvidence()`

The executable contract lives in `crypto-payment-contract.js`.

A concrete provider code such as `pdax` must not be activated until the commercial/API relationship and regulatory applicability are verified.

## Checkout

1. Customer chooses **Crypto**.
2. Business & Life keeps the order amount in PHP.
3. Server requests a short-lived quote from the configured VASP.
4. Provider returns asset, network, amount, expiry and destination/QR.
5. Customer pays using a compatible wallet/exchange.
6. Provider confirms payment server-to-server.
7. Payment Core verifies the expected PHP intent, quote id, provider, asset/network, amount and replay/idempotency evidence.
8. Allocation engine separates merchant/service value, delivery, Business & Life fee, processor/network/conversion cost and any verified statutory components.
9. Settlement evidence is reconciled before participant payout is marked paid.

## GCrypto compatibility

GCrypto is treated as a possible funding source when the selected VASP/network supports an external transfer compatible with the generated destination.

The checkout label remains **Crypto** unless an official direct GCrypto merchant integration is verified. Business & Life must not claim direct GCrypto support solely because a user can send an asset from GCrypto.

## Assets and networks

Availability is provider-configured and versioned. Do not hardcode BTC, ETH, USDT, USDC or a network as universally available.

Stable-value assets may be prioritized for commerce where provider-supported because they reduce quote volatility, but the Merchant should normally settle in PHP.

## Quote evidence

Persist enough evidence to reproduce the historical economics:

- canonical PHP amount;
- provider and quote id;
- asset and network;
- crypto amount;
- exchange-rate snapshot;
- quote created/expiry timestamps;
- destination/QR reference;
- provider payment id;
- blockchain transaction hash where supplied;
- provider/network/conversion fees;
- final PHP settlement evidence.

Historical transactions are never recomputed using a current rate.

## Fee policy

Crypto uses the same `fee_policy_versions` and `payment_allocations` model as fiat.

The existing 90-day promotional entitlement applies to the Business & Life platform fee. Provider/network/conversion costs are separate and may still exist.

A fee is not marked collected unless the real payment/settlement flow proves it.

## Settlement

Preferred PH model:

**Customer crypto funding -> regulated VASP -> conversion/settlement -> PHP allocation -> Merchant/participant payout**

The Merchant should not be forced to accept crypto volatility.

Direct crypto settlement to a participant is a later opt-in capability requiring separate provider/compliance approval.

## Refunds

Refunds remain provider-specific and auditable. Never assume the safe refund destination is the original blockchain sender address.

Record original PHP economics, original crypto evidence, provider refund reference, conversion evidence, network/provider costs and final refund status.

## Activation gate

Live crypto checkout remains HOLD until all are true:

- provider configured;
- VASP regulatory/commercial status verified;
- platform/provider KYB/KYC/AML readiness completed;
- signed webhook/API verification working;
- reconciliation implemented;
- controlled live-money evidence exists.

`cryptoActivationGate()` encodes this boundary.

## Pilot sequencing

Crypto architecture is designed now but does not block the first controlled PH pilot.

The first pilot must have **PayMongo online payments active**. Crypto follows as a controlled additional rail after a VASP integration is available and verified.
