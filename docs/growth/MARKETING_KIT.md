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

The same Figma file also contains the initial **Promotion Center — Mobile** screen at node `1:2`.

## Canva masters

The five Figma masters above have been converted with Canva Magic Layers into editable Canva designs.

Canonical Canva titles:

- `Business & Life — A4 Referral Poster V1`
- `Business & Life — Social Square Referral V1`
- `Business & Life — Story Referral V1`
- `Business & Life — A5 Referral Flyer V1`
- `Business & Life — Referral Card V1`

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

## Master families

### A4 poster
Use for shops, community noticeboards, business counters, local events and printed referral promotion.

Primary message: **Run your business. Understand your money.**

### Social square
Use for Instagram and Facebook posts.

Primary message: **Know where your money goes.**

### Story / Status
Use for Instagram Story, Facebook Story and WhatsApp Status.

Primary message: **Your business. Your money. More clarity.**

### A5 flyer
Use for local handouts, business counters, community distribution and smaller noticeboards.

Primary message: **Small business? See the money clearly.**

### Referral / business card
Use for direct person-to-person sharing, a wallet-sized print piece or a compact digital card shown from a phone.

Primary message: **Join me on Business & Life.**

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
- editing the five master designs;
- resizing/deriving channel formats;
- future brand-template/autofill production;
- localized copies.

Bulk personalized asset generation must not run until an autofill-capable Canva template is verified for the connected plan.

## Future families

Still to add under Issue #48:
- counter card;
- window sticker;
- email/web banner;
- LinkedIn landscape;
- QR-only phone card.

## Coordination

This work does not modify:
- Admin/RBAC work in PR #42;
- public Help Center ownership in Issue #43;
- profile approval authority in Issue #30.

Production shell integration happens only after shared gateway work stabilizes.
