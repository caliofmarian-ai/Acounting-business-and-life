# Business & Life — Product Image Standard

Status: canonical V1  
Owner decision: 2026-09-20  
Related: #295, #294, #170, #166

## 1. Purpose

Business & Life must not publish a visually inconsistent catalog made of random photos, cluttered backgrounds or misleading AI images.

When a Merchant has no real image yet, AI may create a temporary **reference image** for a prepared recipe. The Merchant remains responsible for confirming that the image fairly represents the product.

A real Merchant/Supplier photo can replace the generated image later. One product may contain multiple gallery images.

## 2. Canonical hero image

Primary product imagery uses:

- 1:1 square composition;
- generation target: 1024×1024 for V1;
- pure white background: `#FFFFFF`;
- product centered;
- approximately 8–12% breathing room;
- soft natural contact shadow;
- realistic catalog/product photography;
- no people or hands;
- no table/restaurant/lifestyle scene;
- no promotional graphics;
- no text, price, watermark, logo overlay, badges or pseudo-writing inside the image.

The visual system is illustrated in the shared Business & Life Figma file:

- Frame: `Product Image Standard / AI + Real / Mobile`
- Node: `21:50`

## 3. Prepared recipe images

AI image generation may use only confirmed product information.

For a recipe image:

- use the Merchant-confirmed product name;
- use confirmed recipe ingredients and quantities;
- use confirmed description/category where available;
- show the finished serving;
- prefer a neutral white/light serving vessel;
- use a restrained 30–45° view unless top-down is clearer;
- never add a visible ingredient or garnish that is not in the confirmed recipe;
- never exaggerate the serving size;
- never invent packaging.

The generated image is a **reference representation**, not proof of the exact real product.

## 4. Fresh/direct food

A generic AI reference may be used only when the identity is unambiguous.

Do not infer or visually claim:

- origin;
- grade;
- organic status;
- size/weight;
- certification;
- freshness date.

A real photo remains preferred.

## 5. Packaged/branded food and non-food

For exact resale inventory, use a real Merchant/Supplier image or an authorized manufacturer asset whenever possible.

Without a real reference image, AI must not invent:

- branded packaging;
- logos;
- certification marks;
- model numbers;
- regulatory/safety labels;
- warranty claims;
- technical features.

A generic generated representation must be disclosed as generated and must not be presented as the exact package sold.

## 6. AI disclosure

Generated images are stored with source metadata and the UI displays:

> AI-generated reference image

The disclosure is shown **outside** the image. The image itself stays visually clean.

Media metadata records:

- source type;
- provider/model;
- generation date;
- approving account;
- approval state;
- primary/gallery order;
- public/private state;
- alt text.

## 7. Gallery lifecycle

A product can hold multiple images.

Rules:

1. Exactly one approved public image may be primary.
2. A new AI generation begins as `draft`.
3. Merchant explicitly approves it before public use.
4. A real upload can become primary at any time.
5. Replaced generated assets become non-public/archived unless deliberately retained.
6. Gallery order is explicit.
7. V1 maximum: 8 non-archived images per product.

## 8. AI generation cost controls

No automatic image generation occurs on product creation.

V1 guards:

- explicit Merchant action only;
- one image per provider request;
- maximum 3 AI generations per product in 24 hours;
- 1024×1024 output;
- compressed WebP;
- generation must be explicitly enabled by environment configuration;
- provider credentials remain environment-only;
- production may remain disabled independently of QA.

Current implementation uses a provider-neutral configuration boundary. The OpenAI adapter uses the official image-generation endpoint when enabled.

## 9. Storage boundary

V1 can use compressed data URLs for controlled pilot assets so no new storage vendor is required.

This is a pilot boundary, not the long-term scale architecture.

Before high-volume launch, media should move to private/object storage with derivative delivery, without changing product/media semantics.

## 10. Publication invariant

AI never:

- automatically publishes a product;
- automatically approves an image;
- fabricates product price or stock;
- fabricates ingredient facts;
- fabricates branded packaging.

Product publication and image approval are separate explicit Merchant actions.
