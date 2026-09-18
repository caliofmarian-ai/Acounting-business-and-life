# PayMongo Integration — Philippines Sandbox + Live Pilot

Status: **Hosted Checkout + automatic webhook bootstrap + live-pilot reconciliation gate**

This document is operational/technical. It does not claim that PayMongo onboarding, KYC, payment-method activation, or live processing has been completed.

## Integration choice

Business & Life uses **PayMongo Hosted Checkout v2** for the first provider adapter.

Why:
- checkout is hosted by PayMongo, so card/e-wallet collection is not implemented inside Business & Life;
- the backend creates the Checkout Session;
- the customer is redirected to PayMongo;
- the redirect back to Business & Life is **not** payment authority;
- only a verified PayMongo webhook can mark an internal payment intent and order as paid.

Official references:
- https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start
- https://docs.paymongo.com/docs/payment-channels-hosted-checkout
- https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
- https://docs.paymongo.com/docs/payment-acceptance-refunds

## Sandbox environment variables

Secrets must exist only in Railway/provider secret storage.

Required for checkout:
- `PAYMENT_PROVIDER_DEFAULT=paymongo`
- `PAYMONGO_MODE=test`
- `PAYMONGO_SECRET_KEY=sk_test_...`
- `PAYMONGO_PAYMENT_METHODS=card,gcash,paymaya,qrph`
- `AUTH_PUBLIC_BASE_URL=https://<public Business & Life domain>`

Webhook bootstrap:
- `PAYMONGO_WEBHOOK_SECRET` is **optional** in V0.15.
- If it is absent but `PAYMONGO_SECRET_KEY` is configured, Business & Life lists webhooks for the exact public endpoint and reuses the matching test webhook.
- If no matching webhook exists, it creates one through `POST /v1/webhooks` for `checkout_session.payment.paid`.
- The returned/retrieved webhook secret is kept only in process memory and reacquired from PayMongo after restart.
- An explicit `PAYMONGO_WEBHOOK_SECRET` environment variable remains supported as an override.

Optional:
- `PAYMONGO_WEBHOOK_TOLERANCE_SECONDS=300`

Live protection:
- live processing is **disabled by default**;
- public production Hosted Checkout remains blocked until the controlled-pilot evidence gate is READY;
- `sk_live_...` is not accepted unless both:
  - `PAYMONGO_MODE=live`
  - `PAYMONGO_LIVE_ENABLED=true`
- enabling live mode requires an explicit production decision after KYC, payment-method activation, legal/commercial review and production-readiness gates.

## Webhook

Public endpoint:

`POST /api/payments/webhooks/paymongo`

Subscribe the PayMongo test webhook to:

`checkout_session.payment.paid`

The adapter verifies:
1. raw JSON request body;
2. `Paymongo-Signature`;
3. timestamp freshness;
4. test/live signature branch;
5. internal payment-intent metadata or stored Checkout Session id;
6. exact PHP amount in centavos;
7. exact session/intent relationship;
8. current outstanding order balance.

A mismatch becomes `manual_review`; it does not silently credit Accounting.

## Payment methods

The initial configured logical set is:
- Card
- GCash
- Maya / PayMaya
- QR Ph

Actual availability remains controlled by the PayMongo account and its enabled capabilities.

## Processing fees

`pass_on_fees` is set to **false** in V0.14.

Business & Life does not invent a platform fee. PayMongo's verified webhook fee and net amount are stored separately:
- gross internal merchandise/delivery allocations remain intact;
- PayMongo processor fee is a separate `processor_fee` allocation;
- provider net amount is stored as provider evidence.

## Refunds

V0.14 connects approved internal refund requests to:

`POST https://api.paymongo.com/v1/refunds`

The request uses:
- provider Payment id;
- amount in centavos;
- bounded PayMongo refund reason;
- internal note.

The original payment evidence is never deleted.

## Settlement / payout boundary

PayMongo payment confirmation means the customer paid PayMongo. It does **not** mean the money has already reached the Merchant's bank account.

Until payout reconciliation is activated:
- provider-confirmed money is recorded to the platform's existing `other` / provider-clearing account boundary;
- settlement/payout remains a separate financial event;
- no bank settlement is fabricated.

Later payout reconciliation should use PayMongo payout/payment exports/API evidence and move provider-clearing balances to the actual destination account without creating a second sale.

## Programmatic live-payment reconciliation

For the controlled live validation payment, Business & Life does not rely only on its own webhook record.

Finance Admin can trigger:

`POST /api/payments/admin/paymongo/reconcile-live/:intent`

The adapter retrieves PayMongo payment records through:

`GET https://api.paymongo.com/v1/payments`

and matches the stored provider Payment id. The reconciliation checks:
- `paid` provider status;
- `livemode=true`;
- exact PHP amount and currency;
- PayMongo processor fee;
- provider net amount.

A successful comparison writes:
- a `reconciliation_runs` record with status `matched`;
- a matching `reconciliation_items` payment record;
- an immutable payment/Admin audit event.

If any value differs, the run is `mismatch` and real-customer checkout remains HOLD.

Official references:
- https://docs.paymongo.com/reference/list-all-payments
- https://docs.paymongo.com/docs/payment-acceptance-payment-reconciliation
- https://docs.paymongo.com/reference/getpayoutlist
- https://docs.paymongo.com/reference/getpayouttransactions

Payment reconciliation proves the customer payment. Payout/settlement reconciliation remains a separate later evidence layer because a paid customer transaction does not prove funds have reached a Merchant bank/e-wallet.

## Required owner/provider action before end-to-end sandbox test

1. Create or use a PayMongo account.
2. Complete any PayMongo requirements necessary to access the test secret key.
3. Put the **test** secret key directly in Railway as `PAYMONGO_SECRET_KEY=sk_test_...` — do not paste it into GitHub or public chat.
4. Redeploy. Business & Life will automatically discover/create the test webhook at `https://<V0.15 preview domain>/api/payments/webhooks/paymongo` for `checkout_session.payment.paid` and recover its verification secret server-side.
5. Verify:
   - `/health`
   - `/api/payments/paymongo/status`
   - test checkout
   - verified webhook
   - order becomes paid only after webhook.

## Required live activation sequence before first external customer

1. Complete PayMongo live merchant approval/KYC/KYB and enable the actual methods to be offered.
2. Store `sk_live_...` only as `PAYMONGO_SECRET_KEY` in production secret storage.
3. Set `PAYMONGO_MODE=live` and `PAYMONGO_LIVE_ENABLED=true`.
4. Confirm automatic live webhook bootstrap/signature verification.
5. Finance Admin runs one small LIVE validation order/payment.
6. Verified webhook must mark the matching internal payment succeeded.
7. Finance Admin runs provider reconciliation and obtains `matched` evidence.
8. Only then can `controlled_pilot` become `READY` for external customers.
