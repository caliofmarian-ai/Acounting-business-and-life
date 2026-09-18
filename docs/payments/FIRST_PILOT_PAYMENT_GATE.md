# First PH Pilot — Payment Release Gate

Status: **CANONICAL RELEASE REQUIREMENT**

Owner decision: **PayMongo must be active from the first controlled customer test.**

This replaces any interpretation that the first real-user pilot may be cash-only.

## Internal QA versus controlled real-customer pilot

### Internal QA

Sandbox is allowed:

- `PAYMONGO_MODE=test`;
- `PAYMONGO_SECRET_KEY=sk_test_...`;
- verified/bootstrap webhook;
- sandbox Hosted Checkout;
- full end-to-end order/payment/refund/reconciliation exercise.

### Controlled pilot with real customers

PayMongo LIVE is required:

- PayMongo business account/live processing approved;
- `PAYMONGO_SECRET_KEY=sk_live_...` stored only in Railway/provider secrets;
- `PAYMONGO_MODE=live`;
- `PAYMONGO_LIVE_ENABLED=true`;
- exact live webhook ready and signature verification passing;
- at least one approved online payment method enabled;
- server-authoritative payment confirmation;
- successful small-value live payment evidence;
- successful reconciliation evidence;
- refund procedure tested or explicitly operationally gated;
- monitoring/support path available.

Cash remains available in parallel.

## Required first-test customer experience

Checkout must offer:

- Cash;
- the PayMongo online methods actually enabled for the account.

The UI must never advertise a method merely because the source code supports it. Capability comes from runtime/provider configuration.

## Release state

The provider status endpoint exposes a pilot readiness object:

- `READY` only when all requirements for the requested stage are met;
- otherwise `HOLD` with exact blocker codes.

For a real-customer controlled pilot, test keys or test mode are a blocker.

## Why this is mandatory

The pilot must validate the real online-money loop, not just the commerce UI:

Customer -> PayMongo -> verified webhook -> Payment Core -> order payment -> allocation -> accounting -> settlement/reconciliation evidence.

A successful browser redirect is never sufficient proof.

## Fee boundary

The 90-day Business & Life promotional platform fee may be zero while PayMongo processor fees still apply.

Processor fees, platform fees, Merchant net, Delivery allocation, refunds and any later operator share remain separate economic components.

## Crypto

Crypto is a separate future VASP rail under #188. It is not required for first pilot readiness.

PayMongo **is** required.
