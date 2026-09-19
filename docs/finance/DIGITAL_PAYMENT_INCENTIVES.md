# Digital Payment Incentives — Philippines

Status: **SIMULATION / LIVE CREDIT DISABLED**

Canonical issue: #234.

## Purpose

Business & Life wants to encourage verified digital payment without punishing Cash through an undocumented surcharge and without paying rewards that exceed the operational benefit of the payment rail.

The economic question is:

`How much of the measured Cash-vs-digital savings can Business & Life safely return as a profile credit?`

## Provider benchmark snapshot

Reference date: **2026-09-19**.

PayMongo published standard pricing:

| Rail | Published fee |
| --- | ---: |
| QR Ph online | 1.34% |
| GCash | 2.23% |
| Maya | 1.79% |
| Domestic Visa / Mastercard | 3.125% + PHP 13.39 |

PayMongo states that published prices are exclusive of VAT.

Primary source:
https://www.paymongo.com/en/pricing

QR Ph source:
https://docs.paymongo.com/docs/payment-acceptance-qr-ph

QR Ph can be paid through participating bank/e-wallet applications including GCash and Maya where supported.

These values are dated reference benchmarks, not Business & Life live fee policy.

## Calculator

For a transaction amount:

`modeled Cash cost = amount × measured Cash handling % + fixed Cash handling cost`

`modeled digital processor cost = published processor percentage + fixed rail fee + explicitly entered tax/VAT on processor fee`

`gross savings = modeled Cash cost - modeled digital processor cost`

If gross savings is not positive:

`supported credit = 0`

Otherwise:

`raw credit = positive savings × return-to-profile percentage`

Then apply:

1. per-transaction credit cap;
2. remaining Growth/Finance budget cap.

The remainder is retained Business & Life savings.

## Why rail awareness matters

A flat digital reward can be economically wrong.

Example with PHP 1,000 ticket, before fee VAT:

- QR Ph: PHP 13.40
- Maya: PHP 17.90
- GCash: PHP 22.30
- domestic card: PHP 44.64

A Cash-cost assumption of 3% would model Cash at PHP 30.

Under that assumption, QR Ph, Maya and GCash produce positive modeled savings, while domestic card does not.

This does **not** mean Business & Life should reject card. It means a reward funded from operational savings should reflect the actual rail cost.

## Credit target

Preferred business-profile rewards:

- next subscription invoice credit;
- future platform-fee credit.

Customer voucher/loyalty rewards require a separate Growth policy.

## Qualification

Live credit may only qualify after:

- provider-confirmed successful payment;
- exact internal Payment Intent match;
- eligible method/rail;
- no refund/reversal that invalidates the reward;
- active versioned incentive policy;
- available Growth/Finance budget.

A browser redirect, screenshot or client-only state never qualifies.

## Cash boundary

Business & Life does not add a hidden Cash penalty.

Cash remains a supported payment choice where the product flow permits it.

The incentive is a transparent benefit for verified digital-payment economics, not a punitive surcharge against Cash.

## Provider evidence

Actual provider transaction/statement evidence always overrides the benchmark registry.

The benchmark registry must be re-dated/reviewed when PayMongo changes pricing.

## Live activation

Before activation:

- Owner approves reward formula;
- Finance verifies measured Cash handling assumptions;
- provider pricing is refreshed;
- explicit credit budget is approved;
- accounting treatment for credit is defined;
- refund/reversal behavior is defined;
- UI explains eligibility clearly;
- automated tests and reconciliation are green.

Current implementation is simulation-only and cannot create or apply live credits.
