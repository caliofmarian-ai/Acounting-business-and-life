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

Figma is the editable visual source for composition. Canva is a downstream distribution/template tool and must not become a second source of product logic.

## Current Figma source

**Business & Life — Growth & Referral System**

https://www.figma.com/design/vi8SsQ2bPrrnTxlOoSpbHT

Current master nodes:

| Template | Figma node | Size | Status |
| --- | --- | ---: | --- |
| A4 referral poster | `3:10` | 794×1123 | READY |
| Social square | `3:25` | 1080×1080 | READY |
| Story / Status | `3:37` | 1080×1920 | READY |

The same file also contains the initial **Promotion Center — Mobile** screen at node `1:2`.

## Dynamic data contract

Every personalized asset may use only these canonical fields:

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

The first Figma masters use a clearly named `QR_SLOT`. A production QR renderer will replace this slot after the runtime integration workstream is rebased from the stable production gateway.

## Master families

### A4 poster
Use for:
- shops;
- community noticeboards;
- business counters;
- local events;
- printed referral promotion.

Primary message:
**Run your business. Understand your money.**

### Social square
Use for:
- Instagram post;
- Facebook post;
- other square social surfaces.

Primary message:
**Know where your money goes.**

### Story / Status
Use for:
- Instagram Story;
- Facebook Story;
- WhatsApp Status.

Primary message:
**Your business. Your money. More clarity.**

## Claim safety

Public copy must describe only current or clearly available product capability.

Never claim:
- guaranteed savings or profit;
- automatic operational-profile approval;
- government approval;
- automatic legal/tax compliance.

Referral acquisition and operational-profile approval remain separate systems.

## Canva handoff

Canva is connected and a Brand Kit exists.

The intended Canva workflow is:
1. lock this GitHub manifest/copy contract;
2. use the Figma masters as the visual reference;
3. build reusable Canva masters;
4. resize/derive Facebook, Instagram, Story, LinkedIn and flyer variants;
5. populate dynamic fields only from the canonical list above;
6. retain template IDs in asset naming.

No bulk personalized asset generation should run until a Canva autofill-capable template has been verified for the connected plan.

## Future families

Still to add under Issue #48:
- A5 flyer;
- referral/business card;
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
