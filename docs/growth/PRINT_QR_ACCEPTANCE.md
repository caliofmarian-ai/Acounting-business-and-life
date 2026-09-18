# Marketing Kit print QR acceptance

Status: **AUTOMATED PREFLIGHT PASS / PHYSICAL SCAN HOLD**

Verified: 2026-09-18

Scope: print-oriented Business & Life referral Marketing Kit exports.

## What the automated preflight proves

The automated contract checks the two formats whose physical paper size is unambiguous from their canonical template identity:

| Template | Runtime canvas | Intended print size | Runtime QR width | Approx. physical QR width | Canonical minimum |
| --- | ---: | ---: | ---: | ---: | ---: |
| `A4_REFERRAL_POSTER_V1` | 794×1123 | 210×297 mm | 246 px | ~65.0 mm | 25 mm |
| `A5_REFERRAL_FLYER_V1` | 559×794 | 148×210 mm | 173 px | ~45.8 mm | 25 mm |

The calculation scales the QR width from the runtime SVG canvas to the intended paper width.

The automated test also requires:
- the QR image to remain square;
- A4/A5 runtime aspect ratios to match the intended paper aspect ratios within raster rounding tolerance;
- `marketing-kit/template-manifest.json` to keep `minimumPrintSizeMm = 25`;
- the local QR renderer to use the same canonical four-module quiet zone declared by the manifest.

## What this does not prove

This automated preflight **does not replace a real printed scan test**.

It cannot prove:
- printer scaling is exactly 100%;
- ink/toner contrast on a specific printer;
- paper reflectance;
- laminate/glare behavior;
- camera autofocus performance;
- damage, folding or low-light scanning;
- whether a specific print shop silently resizes or crops the creative.

Therefore:

**Physical scan status: HOLD**

Do not mark physical print validation PASS until a real exported asset has been printed at intended size and scanned from at least representative Android devices.

## Physical acceptance procedure

For each physical print sample:
1. export the current production SVG;
2. print at 100% scale on the intended A4/A5 paper size;
3. confirm the QR measures at least 25 mm across;
4. scan from normal hand-held distance with an Android phone;
5. verify the URL opens the canonical Business & Life referral landing;
6. verify the URL keeps the correct opaque referral code and campaign/profile context;
7. verify the one-shot `#qr` marker is removed after landing;
8. record printer, paper size, device model, result and date without storing recipient PII.

A failure should remain a print/creative defect; it must never be worked around by embedding recipient identity or weakening referral validation.
