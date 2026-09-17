# Business & Life — Referral Marketing Kit

## Ownership

Issue #48 owns this visual marketing workstream.

GitHub remains the canonical source for:
- template IDs;
- field names;
- approved copy;
- QR rules;
- channel dimensions;
- governance boundaries.

Figma and Canva are editable visual-production tools. They must not become independent sources of product logic.

## Current Figma source

**Business & Life — Growth & Referral System**

https://www.figma.com/design/vi8SsQ2bPrrnTxlOoSpbHT

Current masters:

| Template | Figma node | Size | Figma | Canva |
| --- | --- | ---: | --- | --- |
| A4 referral poster | `3:10` | 794×1123 | READY | READY |
| Social square | `3:25` | 1080×1080 | READY | READY |
| Story / Status | `3:37` | 1080×1920 | READY | READY |
| A5 referral flyer | `4:2` | 559×794 | READY | READY |
| Referral / business card | `4:16` | 1050×600 | READY | READY |
| Counter card | `5:2` | 1200×800 | READY | READY |
| Window sticker | `5:13` | 1080×1080 | READY | READY |
| LinkedIn landscape | `5:22` | 1200×627 | READY | READY |
| Email / web banner | `5:34` | 1200×400 | READY | READY |
| QR phone card | `6:2` | 1080×1920 | READY | READY |

The same Figma file also contains the initial **Promotion Center — Mobile** screen at node `1:2`.

## Canva masters

All ten Figma masters above have been converted with Canva Magic Layers into editable Canva designs.

Canonical Canva titles:

- `Business & Life — A4 Referral Poster V1`
- `Business & Life — Social Square Referral V1`
- `Business & Life — Story Referral V1`
- `Business & Life — A5 Referral Flyer V1`
- `Business & Life — Referral Card V1`
- `Business & Life — Counter Card Referral V1`
- `Business & Life — Window Sticker Referral V1`
- `Business & Life — LinkedIn Referral V1`
- `Business & Life — Email Web Referral Banner V1`
- `Business & Life — QR Phone Card V1`

The public GitHub repository deliberately does **not** store private Canva edit URLs. Future agents should locate these designs through the connected Canva account by exact canonical title.

## Dynamic data contract

Every personalized asset may use only:

- `REFERRER_NAME`
- `REFERRAL_CODE`
- `REFERRAL_URL`
- `QR_ASSET`

Do not insert raw recipient email, phone, contact-list data or private profile data into public creative assets.

## QR contract

QR payload must be the canonical referral URL.

Required properties:
- no email/phone in QR payload;
- at least four-module quiet zone;
- high contrast;
- minimum recommended printed size 25 mm;
- QR remains visually isolated from decorative patterns;
- human-readable referral code remains visible as fallback.

All current masters use a clearly named `QR_SLOT`. A production QR renderer will replace this slot after runtime integration is rebased from the stable production gateway.

## Channel coverage

The V1 master family now covers:
- A4 print poster;
- A5 flyer;
- business/referral card;
- counter display;
- window sticker;
- Instagram/Facebook square;
- Instagram/Facebook Story;
- WhatsApp Status;
- LinkedIn landscape;
- email/web banner;
- full-screen phone QR sharing.

## Claim safety

Public copy must describe only current or clearly available product capability.

Never claim:
- guaranteed savings or profit;
- automatic operational-profile approval;
- government approval;
- automatic legal/tax compliance.

Referral acquisition and operational-profile approval remain separate systems.

## Canva production rule

Canva may be used for:
- editing the master designs;
- resizing/deriving channel formats;
- future brand-template/autofill production;
- localized copies.

Bulk personalized asset generation must not run until an autofill-capable Canva template is verified for the connected plan.

## Issue #48 V1 status

The planned V1 visual master family is complete in Figma and mirrored as editable Canva designs.

Remaining work under this issue is implementation-oriented rather than missing master artwork:
1. replace `QR_SLOT` with production-generated QR assets;
2. validate print QR scannability at physical output size;
3. connect runtime Marketing Kit generation to the canonical field contract;
4. add locale variants when localization is ready.

## Coordination

This work does not modify:
- Admin/RBAC work in PR #42;
- public Help Center ownership in Issue #43;
- profile approval authority in Issue #30.

Production shell integration happens only after shared gateway work stabilizes.
