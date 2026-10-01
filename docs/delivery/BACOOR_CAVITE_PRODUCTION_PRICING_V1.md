# Bacoor / Cavite Delivery Pricing — Production V1

Benchmark date: **2026-10-01**

This document records the Owner-approved, versioned Production pricing activation for the Bacoor/Cavite launch market. It does not replace the Delivery pricing engine or Admin versioning.

## Current public benchmark

Primary public benchmark: Lalamove Philippines, Manila / South Luzon, including Cavite.

Sources:
- https://www.lalamove.com/en-ph/all-delivery-pricing-detail?city=manila
- https://www.lalamove.com/en-ph/
- https://www.lalamove.com/en-ph/personal

Published reference values checked on 2026-10-01:
- Motorcycle: PHP 49 base + PHP 6/km through 5 km + PHP 5/km after 5 km; add stop PHP 40; 20 kg limit.
- Sedan: PHP 100 base + PHP 18/km through 5 km + PHP 15/km after 5 km; add stop PHP 45; 200 kg limit.
- L300/Cargo Van: PHP 280 base + PHP 20/km; add stop PHP 100; 1000 kg limit.
- South Luzon waiting allowance: Motorcycle/Sedan 30 minutes; L300 60 minutes. Excess published at PHP 60/hr, PHP 100/hr and PHP 150/hr respectively.

The public provider notes that its app/web quote can vary with traffic, demand, driver availability, tolls and surcharges. Business & Life does not copy that dynamic surge model at launch.

## Business & Life Production V1

Launch demand adjustment is **0%**.

| Class | Base | Distance | Max km | Max kg | Max volume | Extra stop | Free wait | Excess wait |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Motorcycle | PHP 49 | PHP 6/km to 5 km, then PHP 5/km | 40 | 20 | 100 L | PHP 40 | 30 min | PHP 1/min |
| Sedan | PHP 100 | PHP 18/km to 5 km, then PHP 15/km | 40 | 200 | 420 L | PHP 45 | 30 min | PHP 1.67/min |
| L300 / Cargo Van | PHP 280 | PHP 20/km | 40 | 1000 | 3024 L | PHP 100 | 60 min | PHP 2.50/min |

Representative service fares, excluding toll/parking:
- Motorcycle 3/5/10/40 km: PHP 67 / 79 / 104 / 254.
- Sedan 3/5/10/40 km: PHP 154 / 190 / 265 / 715.
- L300 3/5/10/40 km: PHP 340 / 380 / 480 / 1080.

## Route and transparency policy

- Motorcycle uses the existing no-expressway route profile.
- Sedan/L300 may use toll-eligible routes.
- Toll and parking are explicit pass-through amounts, not hidden inside the service fare.
- Direct delivery remains the default; no hidden stacking.
- Weight/volume select the safe vehicle class; they do not create hidden per-kg/per-litre charges.
- Existing Delivery promo/economics remain unchanged: first 30 eligible Delivery days use the existing promo policy; post-promo platform economics remain governed by the existing versioned fee policy.

## Activation

The one-time activation is guarded:
- Production environment only;
- refuses to run if another PH pricing rule is already active;
- writes an activation marker;
- creates a normal versioned Delivery pricing rule that Admin can supersede later.
