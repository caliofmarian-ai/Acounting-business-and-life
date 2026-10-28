# V0.10 internal marketplace price comparison — calculation-only V1A (#16)

**Status: implementation slice / not connected / NOT LIVE on caliof.com.**
Parent design issue #16 stays open. This is a fail-closed **calculation primitive** with regression tests, not a search API, comparison UI, opt-in persistence or product-review service. It creates no new provider connections, databases, payments or Railway services.

## Owner policy (issue #16 comments, authoritative)

Price-comparison participation is **separate** from Marketplace publication, product reviews and Merchant reputation. It is **explicit opt-in, default OFF**. The storefront choice supplies a default; an explicit listing choice can override it. Withdrawal removes a listing from subsequent public calculations without rewriting order/accounting history. A product still appears in ordinary Marketplace discovery, orders and independent quality reviews with comparison OFF.

Matching is **not fuzzy text search**. Only reviewed server-curated match groups qualify:

- `EXACT_PRODUCT`: standardized product identity, **identical package/base quantity**, reviewed GTIN, manufacturer/model or manual evidence. Only this group can earn `LOWEST_LISTED_PRICE`.
- `COMPARABLE_PRODUCT`: reviewed category/variety/grade/unit equivalence; uses rational normalized PHP minor-unit prices (per kg/L/piece), and only `LOWEST_UNIT_PRICE`.
- `SAME_CATEGORY_ONLY`: discovery/category browsing only; **zero** comparison rows/badges. Similar-sounding prepared-food names cannot create an exact match.

A badge requires at least **two distinct opted-in eligible Merchant businesses**, and cites the exact observation timestamp, participating merchant count and the fact that delivery cost is excluded. Tied lowest-price listings are all recognized. Unpublished, unavailable, opt-out, non-PHP, malformed, stale/unapproved match members are excluded. Multiple listings from one business cannot manufacture multiple competitors. Any duplicate public listing ID in a projection (even identical rows, different-price rows from the same business, or conflicting consent/publication rows) invalidates that snapshot instead of choosing a potentially stale or privacy-violating record. Rejected group metadata is not reflected in the output.

## API-free primitive and trust boundary

`buildInternalPriceComparison({ group, listings, asOf })` in `price-comparison-core.js` runs only on in-memory inputs, synchronously. It makes no DB, network, provider or model calls and cannot write user state. The caller MUST supply:

1. **Server-authoritative** publication, availability, current price in integer PHP centavos, stable public listing ID, authenticated business membership and **separate** comparison consent booleans; not request-body flags. All identity, publication, review, match and consent proof fields must be **own snapshot properties**, never inherited via object prototypes. A persisted `comparisonListingConsent` can be true/false; null/undefined falls back to `comparisonStoreConsent===true`. Unknown/invalid values fail closed.
2. **Server-owned, reviewed group** `{id,categoryCode,matchKey,matchKind,matchEvidenceKind,version,active:true,reviewed:true,unitFamily,exactQuantityBaseUnits?}`. Do not give merchants permission to set `reviewed`, match keys, evidence or versions.
3. Per-listing **approved membership** `comparisonGroupId`, `approvedMatchKey`, `approvedMatchVersion`, `approvedMatchStatus:'verified'`, category and unit family. These MUST be populated by a future audited curation/matching service, never copied from a Merchant request.
4. `asOf` from the server clock as canonical UTC ISO (`YYYY-MM-DDTHH:mm:ss.sssZ`), not from the browser. Input groups are bounded to 500 records as a computation safety limit, **not** a commercial retention/ranking policy.

The calculation checks all four categories again but **cannot authenticate any caller or prove the truth of the supplied group/evidence**. Those prerequisites need DB/schema, RBAC, approval audit, consent history and API authorization tests before integration. The return projection contains only public listing IDs/prices, normalized rates, group/version-independent badges, count, comparison time and explicit partial-coverage/delivery exclusions. It does not serialize merchant internal IDs, contact data, names, private review claims or any delivery/accounting fields. The response keeps the legacy `groupId` envelope field as `null` for **every** outcome, including verified and category-only groups: the reviewed match-group identifier is an internal server join key, never a public ID or safe customer-facing reference. UI callers must use public listing IDs and the independently authorized comparison route.

The precise comparison uses `BigInt` cross-multiplication, avoiding float/rounded-price winner errors. Display rates are half-up rounded PHP **minor units per kg/L/piece**, encoded as a decimal integer **string** to avoid unsafe JSON numbers. No platform/operator fees, customer payable total, payment state or tax calculations are implied. Quality/reputation badges are deliberately absent pending separate verified-purchase evidence and independently approved thresholds.

## Regression checks

`node --test tests/price-comparison-core-16.test.js` tests opt-out/default/override; published/stock/currency boundaries; exact identity and package integrity; comparable mass/volume/piece ratios; category-only food; stale group/version/curation; distinct-business counting; ties; display-rounding vs exact selection; safe public output; immutable inputs; invalid money/IDs/times and resource limits. The normal repository `npm test` also discovers this `tests/*.test.js` file.

## What #16 still requires

- Durable separate storefront/listing consent schema and clear user choice/revocation UX, with any privacy/legal retention decisions before history is activated.
- Canonical server-reviewed product identity/equivalence and evidence audit, category-specific food/fresh attributes, approved match-group versioning; adversarial authorization tests.
- Actual server queries/projections for publicly published available Merchant listings with authorization, geography and pricing rules; mobile compare UI and transparently defined competitor set.
- Verified-order product ratings and independently versioned quality/reliability badge formulas (do not invent numeric review thresholds).
- Exact-head CI, allocated Railway Preview browser acceptance, coordinated merge, Production SUCCESS and independent `https://caliof.com` acceptance before the product capability can be called live.
- No Klarna dependency in the Philippines, no external private-data search, no new Railway resources or paid providers.

**This PR references #16; it does not close the parent design feature.**
