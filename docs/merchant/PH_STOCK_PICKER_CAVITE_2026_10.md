# Philippines Merchant Stock Picker — Bacoor/Cavite expansion (2026-10-30)

## Scope and safeguards

This change expands the **selectable suggestions** inside Merchant → Stock → Add stock from a purchase. It does **not** insert inventory rows, purchases, lots, financial transactions, supplier orders, recipes, published products, prices, or automatic reorder thresholds. Only the existing form's explicit human save can affect inventory or accounting.

The user asked for **street vendors and restaurants in the Philippines**, first tuned to Bacoor/Cavite where the initial real Merchant operates. The canonical business data and production Merchant stock remain unchanged by this change.

### Catalog counts

- Previously: 17 categories and 158 selectable templates.
- Added: **219 distinct PH-oriented options**, including 4 new groups.
- After: **21 categories and 377 distinct selectable options**.
- Added a mobile-first English/Filipino text lookup that searches across all groups without picking a category first.
- Every suggestion preserves one canonical name and a supported purchase unit (kg / g / L / ml / unit); Filipino names and alternate spelling are search aliases, **not separate inventory products**.
- Existing names, units, order, storage defaults and non-food operational groups are preserved.

### Major coverage gaps closed

- *Tusok-tusok and fried bites*: fish balls, squid balls, chicken balls, kikiam, tempura, cheese sticks, frozen siomai, fries.
- *Grilled street food*: isaw (chicken/pork intestines), chicken skin, gizzard, chicken feet (adidas), pork ear, blood cubes (betamax), pork barbecue raw cuts.
- *Dips and batter*: sukang sawsawan, manong-style fishball sauces, siling labuyo, cucumber (pipino), garlic powder, food coloring, tempura batter.
- *Carinderia/pancit*: bihon, sotanghon, puso ng saging, small shrimp, pork chicharon, togue, ampalaya, okra, patola, squash, green leafy vegetables.
- *Merienda and palamig*: sago pearls, gulaman, nata de coco, kaong, ube halaya, pandan, fruit syrups, cooked toppings.
- *Cavite seafood*: sapsap, dilis, tamban, lapu-lapu, smoked fish, plus a **caution** on shellfish/crab selections.
- *Vendor packaging*: bamboo barbecue skewers, paper food boats, frying cups, sauce squeeze bottles, drink sealing cups/film.

### Local research and content sources

- GMA's reporting on an actual Bacoor street-food vendor identifies fishballs, kikiam, chicken balls, chicken skin, isaw, kwek-kwek, okoy, cheese sticks, vinegar and cucumber:
  https://www.gmanetwork.com/news/lifestyle/food/835082/making-tusok-tusok-isn-t-cutting-it-a-cavite-spot-serves-street-food-buffet-style/story/
- De La Salle University-Dasmariñas Cavite Studies Center, *Galeón* (January 2014), Cavite *Pancit Puso* ingredients (bihon, small shrimps, chicharon, banana blossom, green beans, annatto/patis): https://www.dlsud.edu.ph/research/csc/assets/docs/Galeon/January-2014.pdf
- Philippines Department of Agriculture / Agricultural Training Institute list of locally produced vegetables: https://sites.google.com/ati.da.gov.ph/knowledge-resource-center/techno-guides/high-value-crops
- Philippines Department of Agriculture sector report lists pinakbet/chopsuey common vegetables: https://pcaf.da.gov.ph/wp-content/uploads/2023/02/2022_CIR_Part-2_PCAF-Newsletter.pdf
- Bacoor municipal 2024 shellfish safety notice, **historical and not evidence of a current ban**: https://bacoor.gov.ph/latest-news/shellfish-ban-sa-bacoor-ipinapaimplementa-sa-executive-order-no-38-series-of-2024/
- Current BFAR shellfish bulletins must be consulted before purchasing/selling shellfish: https://r10.bfar.da.gov.ph/shellfish-bulletin-2026/

## Handling details

Default storage category is only a **suggestion**. E.g. ready-to-fry packaged items default to frozen; chilled toppings to fridge; dry toppings to pantry. Per-item overrides keep fresh tofu, dumpling wrappers, fresh coconut cream and Pancit Malabon noodles chilled, and cheese powder/powdered milk dry when sold shelf-stable. The merchant must verify actual supplier instructions, original package size, expiry, allergens, food safety and local restrictions before saving a purchase.

A unit for **French fries** may refer to one pack, while **Quail eggs** may need conversion from boxes to eggs: the form must still capture the actual unit and packing conversion. Search aliases never promise a universal pack size.

For **tahong, talaba, halaan, alimango, alimasag**: only a *cautionary note* is shown, never an invented current red-tide status or prohibition. The merchant checks the latest BFAR advisory and Bacoor/Cavite restrictions at purchase time.

## Verification

Run:

```sh
node --check public/ph-stock-picker-catalog.js
node --check public/v03.js
node --test tests/ph-stock-picker-catalog-v1.test.js
```

Then authenticated Android browser QA with Merchant profile:

1. Open production-like Preview Merchant → Stock (do not save); search `fishball`, `itlog pugo`, `sitaw`, `pancit puso`, `tahong`.
2. Confirm category, normalized name, unit, storage hint, and shellfish caution appear correctly.
3. Confirm no `POST /api/inventory/purchase`, stock, money or public Catalog write is triggered by a selection or search.
4. Confirm existing unrelated Food/Retail/Operations, barcode and Count workflows work as before; accessibility/mobile keyboard remains usable.
5. Merge reviewed branch then verify the exact production build on https://caliof.com. Owner acceptance is production-only.

## Non-goals

No 219 purchases, no initial quantities or prices, no changes to existing Trizian stock, no new public-facing Catalog products. No automatic recipe creation. No claim that a complete nationwide ingredient taxonomy exists. Future category growth should be based on real item-search misses from participating Merchants.
