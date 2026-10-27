# Promotion artwork

These three Business & Life illustrations were generated for the Owner's
Promotion Center request on 2026-10-27. The Owner approved all three and asked
that each user be able to choose their preferred image.

| Stable ID | Direction | Full image | Thumbnail |
| --- | --- | --- | --- |
| `local-business` | Realistic local merchant and customer scene | `brand-local-business.jpg` | `brand-local-business-thumb.webp` |
| `community` | Illustrated neighborhood, local businesses and delivery | `brand-community.jpg` | `brand-community-thumb.webp` |
| `miniature` | Tactile miniature shop, home and workshop composition | `brand-miniature.jpg` | `brand-miniature-thumb.webp` |

Full images are 1536 × 1024 pixels; thumbnails are 360 × 240. Both retain the
complete approved 3:2 composition. JPEG/WebP encoding and thumbnail resizing are
delivery optimizations; no subjects, text, logos or QR marks were added or
removed. Full JPEG images use quality 90 and WebP thumbnails quality 78. JPEG
is used for the embedded artwork so exported SVGs also render in image engines
that do not support WebP inside SVG.

The fixed, localized catalog in `../promotion-brand.js` is the only runtime
selection source. User preferences store its enum ID, never an arbitrary image
URL or the private referral payload. Selected images are embedded into the
SVG before raster/print export; text, links and QR are rendered separately by
the application. Preserve full composition within the reserved artwork panel
and keep the QR quiet zone clear.

These are generic generated brand scenes, not evidence of actual registered
merchants, customers, deliveries or premises. Production release status is
tracked in issue #836 / PR #838.
