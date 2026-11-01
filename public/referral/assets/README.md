# Business & Life approved promotional images

The Owner approved all three product-focused branded images on 2026-10-27.
These replace the earlier shop/community/miniature scene proposals. Each approved
image visibly contains Business & Life, the existing app icon and caliof.com.

| Artwork ID | English choice | Full image | Thumbnail |
| --- | --- | --- | --- |
| `app-platform` | App platform | `brand-app-platform.jpg` | `brand-app-platform-thumb.webp` |
| `connected-profiles` | Connected profiles | `brand-connected-profiles.jpg` | `brand-connected-profiles-thumb.webp` |
| `everyday-life` | Everyday life | `brand-everyday-life.jpg` | `brand-everyday-life-thumb.webp` |

The complete, unmodified generated PNG sources are committed under
`marketing-kit/source-artwork/`, with exact SHA-256 hashes documented there.
They are not served or fetched by the application. Runtime JPEGs keep the full
1536 × 1024 composition, encoded at quality 93 with 4:4:4 chroma sampling.
Thumbnails are uncropped 360 × 240 WebP images. These delivery encodings do not
add or remove a design element. JPEG also works in SVG renderers that cannot
decode an embedded WebP image.

`../promotion-brand.js` is the fixed, localized allowlist. All three choices are
available to every eligible user; `connected-profiles` is the fresh default.
The user may choose another image. The selected ID is retained per account in
the current browser, not synchronized to other devices. Retired scene IDs and
arbitrary URLs are not accepted.

## QR placement

The source images are shared brand assets and contain no personal invitation QR.
The `BRANDED_INVITATION_V1` runtime format renders the complete image above a
white personal footer on a 1536 × 1536 canvas. The image occupies the first
1536 × 1024 pixels. The footer contains the current account's locally generated
QR, scan instruction, complete invitation link, referrer name and fallback code.
It keeps the QR clear of the artwork and retains the QR renderer's four-module
quiet zone. Nothing is painted over the approved image.

The fixed image contains English branding and slogans. Language selection
localizes the interface and dynamic invitation/footer text, not the words
already baked into the selected image. This distinction is stated in the UI.
The previous ten export formats remain available, with the selected image
contained in their dedicated image region.

The illustrations are promotional concepts, not screenshots of the live app or
evidence of registered people/businesses. No personal data or secret is stored
in these shared assets. Source approval and repository persistence do not certify
that a deployment or physical printed QR scan has passed.
