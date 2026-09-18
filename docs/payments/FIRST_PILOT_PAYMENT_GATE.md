# First PH Pilot — Payment Release Gate

Status: **CANONICAL RELEASE REQUIREMENT**

Owner decision: **PayMongo must be active from the first controlled customer test.**

This replaces any interpretation that the first real-user pilot may be cash-only.

## Three release stages

### Internal QA

Sandbox is allowed:

- `PAYMONGO_MODE=test`;
- `PAYMONGO_SECRET_KEY=sk_test_...`;
- verified/bootstrap webhook;
- sandbox Hosted Checkout;
- full end-to-end order/payment/refund/reconciliation exercise.

### Admin LIVE validation

Before external customers are allowed to use PayMongo on the public production surface:

- PayMongo live account/configuration must already be READY;
- a scoped Finance/Super Admin may use a small unpaid test order to open one LIVE Hosted Checkout;
- only the Admin validation override may bypass the missing-evidence blockers;
- the normal external-customer checkout remains HOLD;
- the payment must complete through the signed LIVE webhook;
- Business & Life records the checkout attempt with `metadata_json.mode=live`.

After the payment succeeds, Finance Admin runs the provider reconciliation action. Business & Life fetches PayMongo payment records through the provider API and compares:
- provider Payment id;
- `status=paid`;
- `livemode=true`;
- exact PHP amount;
- currency;
- processor fee;
- provider net amount.

Any mismatch keeps the pilot on HOLD and creates reconciliation/audit evidence.

### Controlled pilot with real customers

PayMongo LIVE plus validation evidence is required:

- PayMongo business account/live processing approved;
- `PAYMONGO_SECRET_KEY=sk_live_...` stored only in Railway/provider secrets;
- `PAYMONGO_MODE=live`;
- `PAYMONGO_LIVE_ENABLED=true`;
- exact live webhook ready and signature verification passing;
- at least one approved online payment method enabled;
- server-authoritative payment confirmation;
- successful small-value LIVE payment evidence from the Admin validation step;
- matched provider reconciliation evidence from PayMongo API;
- refund procedure tested or explicitly operationally gated;
- monitoring/support path available.

Cash remains available in parallel.

## Required first-test customer experience

Checkout must offer:

- Cash;
- the PayMongo online methods actually enabled for the account.

The UI must never advertise a method merely because the source code supports it. Capability comes from runtime/provider configuration.

## Release state

The provider status endpoint exposes three readiness states:

- `internal_qa` — sandbox/test checkout;
- `live_validation` — LIVE key/mode/webhook ready for scoped Admin validation;
- `controlled_pilot` — external customers may use PayMongo only after LIVE payment + matched reconciliation evidence.

Each state is `READY` or `HOLD` with exact blocker codes.

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

## Operational Admin flow

1. Configure and verify PayMongo LIVE.
2. Finance Admin confirms **Admin LIVE validation = READY**.
3. In Pay online, a scoped Admin uses **Run LIVE validation** on a small unpaid order belonging to that Admin test account.
4. Wait for the verified webhook; the order/payment intent must become paid from provider evidence only.
5. Finance Admin selects **Reconcile LIVE validation payment**.
6. Business & Life compares the internal payment against PayMongo `GET /v1/payments` evidence.
7. Only a matched reconciliation can remove the final controlled-pilot blocker.
8. External-customer PayMongo checkout becomes enabled automatically when `controlled_pilot=READY`.
