# Business Delivery / Courier Growth — V1

## Current live promise

Business & Life Delivery currently supports **delivery attached to an eligible Business & Life customer order**.

For a restaurant, fast-food business, bakery, shop or other approved Merchant, the correct message is:

> **You have the order. Business & Life can coordinate the Courier delivery workflow.**

The application can:
- create a delivery quote from an active pricing rule;
- keep merchandise and delivery fee separate;
- dispatch only after configured payment/readiness gates;
- assign only an approved/available Courier;
- show Courier status/ETA;
- record Merchant arrival and pickup;
- show in-transit progress;
- use a secure customer handoff code;
- complete delivery without adding the delivery fee to Merchant merchandise revenue.

## Merchant examples
- restaurant;
- fast-food / takeaway;
- bakery;
- food stall;
- convenience shop;
- grocery;
- local retail;
- other approved Merchant.

## Courier side
Courier remains an approval-gated operational profile.

Approved Couriers may have:
- vehicle/capacity/radius;
- availability;
- assignment;
- pickup;
- active delivery/tracking;
- completion/handoff workflow.

Do not promise guaranteed assignments or automatic Courier approval.

## What is NOT live yet

The current delivery system is not a general-purpose courier marketplace for arbitrary external parcels.

Do **not** advertise:
- "send any parcel";
- "book a courier for any external order";
- delivery pricing before an Admin-active pricing rule exists;
- guaranteed Courier availability;
- cash delivery where current policy disables it.

## Future extension — Standalone Business Courier Booking

Desired future product:
A Merchant could create a delivery request for an order generated outside the Business & Life Marketplace by entering:
- pickup location;
- dropoff;
- recipient;
- package/order characteristics;
- readiness window;
- required delivery handling.

The system could then reuse pricing, approved Courier dispatch, tracking and handoff primitives.

This requires product/domain implementation and compliance validation before it may be marketed as live.

## Inspection protocol
After merge + verified deployment report:
- PR and merge SHA;
- exact Growth upgrade;
- files/routes/screens;
- deployed SHA and Railway status;
- direct production inspection URL;
- exact in-app destination;
- explicit note that standalone external parcel booking remains future-only until implemented.
