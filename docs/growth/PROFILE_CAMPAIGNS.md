# Profile-specific referral campaigns — V1

## Purpose

Business & Life has one human account that can expose several public profiles. Referral identity remains account-level, while campaign copy records the profile context from which a user shared.

This prevents:
- duplicate referral identities per profile;
- reward multiplication by switching profiles;
- accidental confusion between marketing referral and operational invitation.

## Grounding rule

Campaign copy is based only on executable product lanes currently described by GitHub `main`.

### Customer
May promote:
- Marketplace discovery/order flow;
- basket/checkout;
- order tracking;
- credit/partial payment tracking.

### Merchant
May promote:
- cash control/reconciliation;
- inventory;
- menu/recipes;
- profitability visibility;
- Marketplace/customer-order operations.

### Supplier
May promote:
- trusted Merchant-Supplier relationships;
- catalog;
- purchase orders;
- ETA/readiness;
- receiving/procurement payment workflow.

### Courier
May promote:
- vehicle/capacity/radius profile;
- pricing;
- dispatch;
- live delivery status/location;
- secure handoff workflow.

### Service Provider
May promote:
- profile/services;
- qualification/CV/portfolio evidence;
- request/quote lifecycle;
- job state;
- verified-review eligibility.

## Operational-approval boundary

Marketing referral never means:
- approved Merchant;
- approved Supplier;
- approved Courier;
- approved regulated/gated Service Provider category;
- Admin authority.

The appropriate existing governance/approval workflow remains authoritative.

## Supported invitation channels

The canonical campaign contract provides reusable copy for:
- native share;
- copy link;
- WhatsApp;
- Telegram;
- SMS;
- email;
- user-initiated group sharing;
- social creatives.

Group sharing remains user-initiated. There is no automated posting to groups or bulk address-book messaging.

## Analytics

Each profile uses:
- a stable `campaignId`;
- `utmCampaign`;
- `sourceProfileRole`;
- `creativeVariant`.

These map to the referral event taxonomy documented in `docs/growth/ANALYTICS_EVENTS.md`.

## Experiment rule

A/B tests may alter:
- headline;
- CTA;
- landing layout;
- reward messaging presentation.

They must not silently change:
- actual reward economics;
- qualification criteria;
- profile approvals;
- legal/consent meaning.

## Canonical file

`growth/campaigns.en-PH.json`
