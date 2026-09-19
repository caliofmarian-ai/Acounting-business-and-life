# Profile Subscriptions V1

Status: **OWNER-APPROVED ₱99/MONTH TARGET / BILLING READINESS IMPLEMENTED / LIVE BILLING DISABLED**

Canonical issue: #236.

## Product model

Business & Life subscription policy is per monetized economic profile/service scope.

### Customer
- monthly subscription: FREE
- no subscription invoice

### Merchant
- canonical service scope: `marketplace`
- subject type: `business`
- Owner-approved monthly subscription: **₱99/month** after applicable 90-day promotion
- Owner-approved transaction fee: **0.50%**, separate from subscription and separate from processor charges

### Supplier
- canonical service scope: `supplier`
- subject type: `account`
- Owner-approved monthly subscription: **₱99/month** after applicable 90-day promotion
- Owner-approved transaction fee: **0.50%**, separate from subscription and processor charges

### Artisan / Local Services
- canonical service scope: `local_services`
- subject type: `account`
- monthly subscription after applicable 90-day promotion
- Owner-approved transaction fee: **0.50%**, separate from subscription and processor charges

### Delivery / Courier
- no monthly subscription
- monetized through Delivery production fee under Monetization V2

## Promotion authority

Existing `service_monetization_entitlements` remains authoritative.

The subscription system does not create a second 90-day timer.

If an entitlement has not started:
- state = `NOT_STARTED`

Before `promo_ends_at`:
- state = `PROMOTIONAL`

After `promo_ends_at`:
- no active priced policy → `HOLD_NO_ACTIVE_POLICY`
- active priced policy → `READY_TO_INVOICE`

This first slice does not decide whether future promotion should instead start at profile activation. That would require an explicit Owner policy change to the existing monetization entitlement model.

## Versioned subscription policy

Table:
`profile_subscription_policy_versions`

Fields include:
- policy code;
- version;
- country;
- service scope;
- currency;
- monthly amount;
- status;
- 90-day promotion reference;
- effective dates;
- audit actors.

Statuses:
- draft;
- approved;
- active;
- superseded;
- withdrawn.

An `active` policy is not permitted without a monthly amount.

Current UI/API only creates **draft** policies.

There is no activation endpoint in V1.

## Invoice foundation

Table:
`profile_subscription_invoices`

An eventual invoice snapshots:
- monetization entitlement;
- policy version;
- billing period;
- currency;
- amount;
- policy snapshot;
- payment-intent reference;
- status.

Invoice status model:
- draft;
- open;
- paid;
- past_due;
- waived;
- void.

The current slice does **not** generate invoices automatically.

## Readiness states

- `NOT_STARTED`
- `PROMOTIONAL`
- `HOLD_NO_ACTIVE_POLICY`
- `READY_TO_INVOICE`
- `OPEN`
- `PAID`
- `PAST_DUE`
- `WAIVED`
- `VOID`

## Admin Finance

Admin Finance shows for:
- Merchant;
- Supplier;
- Artisan / Local Services.

For each:
- profiles with monetization entitlements;
- promotional count;
- post-promo HOLD count;
- ready-to-invoice count;
- latest plan draft;
- active monthly amount if one ever exists.

A privileged Admin with `fee_policy.manage_limited` may create a draft plan.

Creating a draft:
- does not activate billing;
- does not charge a profile;
- does not create an invoice.

## Safety boundaries

V1 intentionally has no:
- plan activation route;
- invoice-generation scheduler;
- automatic account/profile suspension;
- automatic PayMongo subscription collection;
- Customer subscription;
- Delivery subscription.

## Future slices

1. Owner-controlled plan approval/activation.
2. Exact billing-cycle/proration policy.
3. Invoice generation.
4. PayMongo payment path.
5. Subscription credit application from verified digital-payment rewards.
6. Grace period / overdue policy.
7. Profile-facing billing UI.
8. Tax/accounting treatment per operating country.

## Key implementation

- `profile-subscription-core.js`
- `GET /api/payments/admin/subscriptions/readiness`
- `POST /api/payments/admin/subscriptions/policies/drafts`
- Admin Finance Subscription Billing card
- Figma Admin Finance source:
  https://www.figma.com/design/sRwVQFpQchn9kv72vOoUbg


## Pricing transparency note

The monthly subscription amount is Owner-approved at **₱99/month** for Merchant, Supplier and Local Services. Live billing remains disabled until an active versioned subscription policy is explicitly activated.

The approved 0.50% Business & Life transaction rate does not include PayMongo/payment-processor charges. During the 90-day Business & Life promotion, Business & Life subscription/transaction charges are waived according to entitlement, while third-party processor charges may still apply.
