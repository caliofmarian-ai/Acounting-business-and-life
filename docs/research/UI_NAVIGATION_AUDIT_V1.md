# Business & Life — Navigation and UI hierarchy research

Status: **RESEARCH / PROPOSED EXPERIENCE — NOT IMPLEMENTED IN PRODUCTION**

Owner request: Agent 8, 26 October 2026, Europe/Dublin

Tracking: [#819](https://github.com/caliofmarian-ai/Acounting-business-and-life/issues/819); parent experience programmes #350 / #353; account/profile settings #165

Audited source: `bc34c9e783c76a068d05b5e737714739e15d3510`

## Recommendation

Use one persistent, top workspace navigation with a separate business identity area. For Merchant its exact primary order is **Today → Orders → Catalog → Stock → Money**. Remove the repeated bottom navigation and repeated mobile tools grid only when the replacement works on every existing destination. Give **Storefront** a direct, labelled entry beside the business name. Keep procurement, delivery and business configuration in **Business tools**, with their current workflows intact.

This is an information hierarchy change. It does not require a new application, another design framework, another business ledger or a rewrite of domain logic. Preserve the existing restrained green brand, use one action style and reserve larger visual emphasis for actual next actions. Do not treat moving Storefront to the first position in the existing seven-button row as a complete solution.

The reviewable concept is [ui-navigation-concept.html](ui-navigation-concept.html), an offline HTML fragment. All names, states and financial values in it are demonstrative. It has no network requests, account access, operational forms or save actions. Profile choices illustrate the proposed hierarchy; they do not grant or prove access to those roles. Browser rendering of this concept was not completed: the cloud browser disallows local-file URLs. Static markup/script checks are recorded separately from actual Production observations.

## Evidence and limits

| Surface | Evidence in this research | Limit |
| --- | --- | --- |
| Production health | Opened `https://caliof.com/health`: `ok=true`, `db=true`, environment `production`, revision `bc34c9e783c7` | No new deployment was performed; the deployment ID previously recorded by the active Merchant stream was not independently re-queried here |
| Account Home | Existing company-managed Merchant test session, rendered account/profile entry and desktop screenshot inspected | This is a controlled single-role account, not the Owner account or a multi-role customer |
| Merchant | Actual navigation through Today, Orders, Catalog, Storefront, Money, Stock and Merchant settings; inspected global More; no business forms submitted | Food business, desktop viewport 1363×936; not Food/Non-food/Mixed functional acceptance |
| Other profiles | Current source inspected for Customer, Supplier, Courier, Local Services, Admin and guest shells | No authenticated Production visual acceptance for these roles is claimed |
| Mobile | Current CSS breakpoints and navigation definitions inspected; proposed narrow-screen behavior specified | No physical Android or live 390×844 rendering was performed by this research stream |
| Data integrity | Only navigation/read operations; existing Merchant authentication preserved | No payments, orders, stock, publications, business type, permissions or credentials changed |

Do not reuse the older `PRODUCT_EXPERIENCE_AUDIT_MATRIX.md` statuses as evidence of today's UI. It documents earlier executable acceptance and remains owned by the broader programme. This research does not supersede its operational test history.

## Confirmed problems

Severity below is a research prioritisation, not a claim of a security or financial incident.

| ID | Priority | Observed problem | Evidence / consequence | Recommended treatment |
| --- | --- | --- | --- | --- |
| NAV-01 | P1 | Two competing Merchant primary menus | Today shows seven desktop workspace buttons plus five fixed bottom buttons; Today/Orders/Catalog repeat, Stock/Money are absent from the seven | One shared five-destination top nav; retain contextual task links, remove the duplicate nav |
| NAV-02 | P1 | Navigation and business context move behind the page | At scroll top, Merchant nav top was 968px in Orders, 2382px in Catalog and 2911px in Storefront, in the same 936px-high viewport | Shell owns stable header/context/nav/content slots; feature modules mount inside the content slot |
| NAV-03 | P1 | Existing nav disappears during feature journeys | Orders/Catalog hide the legacy bottom bar while the other nav has moved below their content | The same nav remains available on all feature pages, loading, empty and error states |
| NAV-04 | P1 | Mobile and desktop use different incomplete lists | Source hides `merchantWorkspaceNav` below 650px and provides a seven-entry mobile grid plus the five bottom controls | Reuse the same ordered destination model across widths; do not simply reveal all existing controls |
| NAV-05 | P2 | Storefront competes with daily operational destinations | Current middle button opens public shop configuration and readiness forms, not daily order work | Separate public-business entry near the business name; readiness also reachable from Business settings |
| NAV-06 | P2 | Inventory has multiple names | Today says Inventory / Open Inventory, page heading Inventory, bottom button becomes Stock for Food | Visible short nav label Stock, page title Stock, with Inventory retained as explanatory/search terminology |
| UI-01 | P1 | Large creation forms precede work lists | Stock starts with purchase entry before its inventory list; Catalog starts with its editor before existing products; Orders counter form precedes the board | Lists/active work first; New order, Add product and Record purchase open focused existing forms |
| UI-02 | P2 | Food Catalog still carries an empty Retail management section | Live Food test business showed Retail filters, barcode intake, bulk action and pagination alongside zero Retail results | Conditional category navigation and progressive empty-state guidance; preserve Mixed access |
| UI-03 | P2 | Merchant Money exposes business and personal/remittance concepts together | Live page combines business receipts, cash close, EUR remittance entry and Business vs personal analysis | Business summary and transactions first; preserve advanced records under named subsections; no silent ledger reclassification |
| UI-04 | P2 | Global account controls are difficult to distinguish | Merchant pill goes to Merchant home, avatar to Account Home, More to Payments/Legal/Report/Help Center; Help has another entry | Label profile selection, group personal utilities under Account, keep one predictable Help entry |
| UI-05 | P2 | Settings present three finance destinations at equal weight | Merchant settings has Money preferences, Account Money & Banking and Statements & documents together | Explain business-vs-person scope; keep statements in Money with a contextual settings link |
| UI-06 | P2 | Technical implementation explanations dominate normal UI | Examples observed: “One Inventory engine”, “Compatibility detail”, “Food menus and Retail products share one Catalog engine” | Describe the user's action/outcome; keep technical explanations in documentation |
| UI-07 | P2 | Page emphasis changes heavily between workspaces | Today uses a large purple hero and cards; Orders gives its counter form a dominant dark panel; a long Storefront form starts with readiness | One common page header, title/subtitle spacing, action hierarchy and content width; status emphasis reflects user urgency |
| NAV-07 | P2 | Supplier has two competing finance entry names | Source Supplier hub starts Finance & Accounting, then Today/Catalog/Orders/Money | Start with Today; Money is the primary finance destination, with Accounting/Statements as children |
| NAV-08 | P1 | Other role navigation is owned by disposable hub markup | Customer/Courier/Local Services primary nav is inside `roleHub`, and feature opening hides that hub | Generalise the persistent shell after role-specific handoffs; preserve role labels and destinations |

NAV-01 through NAV-03 and UI-01 through UI-07 have direct desktop Production observations. NAV-04, NAV-07 and NAV-08 are source-backed architectural findings. They must receive role-specific browser acceptance before runtime release. This is not a complete WCAG conformance assessment.

The measured offsets are one account/data/layout observation, not performance metrics or universal page heights. The [evidence manifest](UI_NAVIGATION_EVIDENCE_V1.json) records how to repeat them. Screenshots [Today](ui-navigation-evidence/merchant-today-production.jpg) and [Orders](ui-navigation-evidence/merchant-orders-production.jpg) contain only the controlled test workspace.

## Source diagnosis

- `public/index.html:669` defines the five-button Merchant bottom nav. `public/v03.js:1370` owns legacy view switching and bottom active state; `openMerchantAction` is the existing bridge to feature modules.
- `public/shell.js:280–347` creates the separate seven-button `merchantWorkspaceNav` and seven-entry `merchantMobileTools`. `public/shell.css:706–735` provides their width-dependent visibility. Keep one destination definition when implementing the replacement.
- `ensureWorkspace` in Orders, `ensureMarket`, `ensureSettingsWorkspace`, `ensureSup`, `ensureSvc` and `ensureDelivery` insert each module immediately after `.topbar`. The existing nav and business bar were already inserted there. The later module therefore sits ahead of them. A z-index adjustment or CSS `order` alone would leave reading/focus order and component ownership unresolved.
- `public/shell.js` has purpose-built Customer, Courier and Local Services hubs, which is useful. Their navigation must become persistent outside `roleHub`, rather than flattening their tasks into the Merchant model.
- `public/suppliers-ui.js` defines Today, Catalog, Orders, Money, Procurement, ETA and Fulfilment. Supplier operational substates already exist and should be reached through Orders/Today, not multiplied into a universal top row.
- `public/admin-console.js` already filters its ten modules by active permissions. Keep those permission checks; grouping a navigation label must not create new authority.
- `public/guest-explore.js` already has a separate public exploration surface. Its actual primary items are Discover, How it works, Pricing & benefits and Privacy. Guest discovery currently loads published storefronts with Food/Non-food filtering; this research does not claim a public Local Services directory already exists there.

## Patterns considered

| Pattern | Fit for Business & Life | Decision |
| --- | --- | --- |
| Keep both existing bars and align their labels | More simultaneous duplicate controls; feature mount-order problem remains | Do not use as the final structure |
| Desktop sidebar and mobile bottom nav | Can work for a dense business tool, but changes location across widths and retains the bottom bar the Owner asked to remove | Possible for a future complex admin-only surface, not the proposed Merchant model |
| Menu-only navigation | Compact, but hides frequent Stock/Money/Orders access | Use disclosure for secondary tools, not the primary five |
| One top workspace nav plus separate business identity and secondary tools | Keeps frequent destinations in one stable place, distinguishes public shop identity and scales across profiles | Recommended |

The recommendation is a product design inference from the observed application and the Owner's stated preference, not a claim of measured user-research superiority.

Primary references, checked 26 October 2026:

1. [GOV.UK service navigation](https://design-system.service.gov.uk/components/service-navigation/) separates service identity/navigation from global branding. Its menu, current-page treatment and flexible identity slots are useful structural references; do not copy its branding or install its framework.
2. [W3C WCAG 2.2 — Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html) explains predictable repeated navigation order. Use the same relative order across sibling views; different roles may legitimately have different destinations.
3. [W3C WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) supports retaining information/functionality at narrow equivalent widths. Use wrapping or an expanded menu when labels cannot fit, rather than clipping or shrinking essential text.
4. [W3C WCAG 2.2 — Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) sets an AA minimum of 24×24 CSS pixels with listed exceptions. Our proposed touch target is **44×44**, a product target above that minimum; do not describe 44px as the AA requirement.

## Proposed Merchant layout

| Layer | Contents | Behavior |
| --- | --- | --- |
| Global header | Brand, Help, Notifications, Account avatar/menu | Shared utilities in predictable positions; no second global More catalogue |
| Workspace identity | Explicit Merchant/profile selector; current business identity; labelled Storefront entry | Selecting another profile is explicit; show a business picker only if multiple authorised businesses exist |
| Primary top navigation | Today, Orders, Catalog, Stock, Money | Same items/order on every Merchant screen, including empty/error/loading; Money stays last with a subtle divider |
| Secondary disclosure | Business tools: Suppliers, Delivery, Business settings, Promotion, Profile tutorial | Same existing destinations and access rules; selection shows its own title and leaves primary nav present |
| Page header | One title, brief context and at most one main next action | No huge decorative hero for routine CRUD pages |
| Page content | Current activity/list first; forms and advanced details on demand | Contextual links may repeat a destination when they explain a specific task, without recreating another navigation bar |

**Storefront** contains public identity, logo/cover/gallery, opening/fulfilment preferences and publication controls. Do not hide this important surface solely inside Account settings. Do not duplicate its form in a new business panel. A future Preview action must respect Draft/private status and must not silently publish the store.

**Business settings** keeps identity, commerce readiness, business finance preferences, lifecycle/tutorial and related existing links. **Account settings** keeps personal identity/security, language/notifications, privacy and shared Money & Banking. Both preserve the originating business/profile context and clearly label a scope change.

**Today** becomes an action summary, not a directory of equally prominent modules. Preserve authoritative counts and explicit unavailable/error states. Show one useful next action and concise attention rows. Do not suppress operational alerts, finance warnings or a capability hold to achieve visual simplicity.

**Catalog** has products first and Add product on demand. Food includes recipes, menu groups, import and media; Retail includes variants/collections/barcodes; Mixed can reach both. The current Products & recipes destination remains the canonical editor. Link it from Catalog without taking ownership of #816 or inventing a second editor. Quick Sale remains a Food/Mixed-only action, reachable in its current flow; any later counter-order convergence requires a separate financial contract.

**Stock** opens balances/list and alerts. Retain all current capabilities in subsections: purchases, Food/Retail/Operations filters, unavailable stock, scanning/manual search, restock settings, storage/segregation, locations/transfers, lot/expiry, allergen evidence, guided count, waste/count adjustments, waste analytics, restock list and order consumables. Moving forms does not change purchase expense recording, lot allocation or available-stock calculations.

**Money** opens the same business-scoped Finance summary. Transactions, confirmed receipts, unpaid amounts, expenses and statements follow. Cash close/manual records/remittances/personal drawings remain available under appropriately labelled advanced sections until separately reviewed. Keep ledger evidence separate from provider balances, settlement and transfer execution.

## Role map — proposed structure, existing capabilities preserved

| Context | Proposed primary top navigation | Secondary/context access | Scope rule |
| --- | --- | --- | --- |
| Guest | Discover, How it works, Pricing, Privacy | Public Help; sign-in/create-account entry; Food/Non-food discovery filters | Published data only; no Money, private Knowledge or operational workspace |
| Customer | Home, Shop, Services, Orders, Money | Deliveries from an active order; customer settings; account utilities | Personal purchases/refunds, not business accounting; Platform Store remains a separate shop/basket |
| Merchant | Today, Orders, Catalog, Stock, Money | Storefront by business name; Suppliers, Delivery, Business settings, Promotion/tutorial under Business tools | Current authorised business; Food/Non-food/Mixed controls stay conditional |
| Supplier | Today, Orders, Catalog, Money | Public/business profile entry; relationships; business settings; accounting/statements inside Money; Procurement/ETA/Fulfilment under Orders | B2B PO evidence and selected Supplier business; no implicit Merchant stock/food tools |
| Courier / Delivery | Today, Deliveries, Money | Availability, eligibility, active route and delivery settings | Accepted jobs and evidence-backed earnings; no fabricated available payout balance |
| Local Services | Today, Quotes, Jobs, Services, Money | Public profile entry; qualifications, CV/portfolio, reviews, settings | Existing provider/account authorisation and quote/job payment authority |
| Delegated Admin / Super Admin | Overview, Members, Support, Safety, Finance | Delivery, Territories, Audit & Metrics, Team & Delegation, Settings | Render only modules permitted by current assignments; do not assume every admin sees the sample menu |
| Account Home | Profile selection and Account settings | Approved Admin workspace, personal Money & Banking, security, notifications/language, Help/Knowledge where authorised, sign out | Human account, separate from operational profile and economic business |

This is one common shell grammar with role-specific destinations, not identical menus for every role. Supplier's current Finance & Accounting entry and Money become one navigational family; they are not financially merged or discarded. Admin's proposed grouping is a candidate pending role-specific observation, not accepted a priori.

## Responsive and interaction contract

- Keep primary navigation at the top on desktop, tablet and phone. No fixed bottom navigation in the proposed release.
- Fit the Merchant five at 390px with readable labels and minimum 44px targets. At 320px, enlarged text or long translations, wrap/reflow or provide an explicit expanded top Navigation menu; do not clip, ellipsise essential labels or require a horizontal page swipe.
- On long pages, pin only the compact navigation row where space allows; let global/business chrome scroll away. Use measured scroll padding and test that focused controls and validation errors are never hidden. The inline concept intentionally has no sticky/fixed positioning because its host sizes to content.
- Stable DOM/read order: global header → workspace identity → primary navigation → secondary tools → page header/content. Keyboard/focus order follows the same sequence, with a production skip link.
- Exactly one relevant destination carries `aria-current="page"`; Storefront/secondary selection has a clear page title and its own current marker. Do not falsely leave Today active while a different module is open.
- Use real links for URL destinations and real buttons for in-place actions. Preserve Back/deep-link/notification entry behavior; history routing needs a separate explicit implementation decision if it does not already exist.
- Open/close secondary tools with the keyboard and touch; close on Escape, return focus to the invoking control, keep accessible names. Do not put primary navigation inside a modal.
- Help stays in a predictable location and routes to current public Help, authenticated Support and permitted private Knowledge. Reuse the other agents' modules; do not mix private document content into guest discovery.
- Preserve drafts and avoid silently resetting partially completed existing forms during navigation. Confirm only when genuinely needed to protect unsaved work.

## Incremental implementation and acceptance

Research acceptance is separate from runtime release. Do not mark #350/#353 or this proposal implemented because this document or a wireframe is merged.

| Slice | Work | Handoff / gate |
| --- | --- | --- |
| A — Merchant shell and navigation | Establish stable shell content mount; route five top destinations through existing canonical navigation; move Storefront entry; secondary tools; remove duplicate bars/grid | Coordinate after #813/#814/#816 and #812 ownership is reconciled. Moving their DOM mounts requires their current behavior and tests; do not edit their in-flight branches |
| B — Page hierarchy | Lists/attention first in Orders/Catalog/Stock; retain existing forms in focused disclosure/panels; organise Money advanced records | Separate scoped issues after Slice A, with all capabilities mapped; no pricing, ledger or stock semantic changes |
| C — Other profiles | Promote Customer/Courier/Services/Supplier nav out of hubs, unify utilities and scope labels | Dedicated test accounts and explicit session handoff; preserve #801/#805 fixes and existing profile/backend contracts |
| D — Administration and guest | Validate proposed grouping with each delegated rank and real guest flow | Permission/MFA negatives and public/private boundaries; avoid crowding dense Admin controls into phone tabs |

Required acceptance for runtime slices:

1. Actual 390×844 Android/narrow desktop plus 320, 650, 820 and 1280px checks. Verify 200% text/400% reflow, landscape, keyboard, focus visibility and touch sizing. A cropped desktop screenshot is not mobile evidence.
2. Every primary/secondary destination remains reachable from Today, every module, loading, error, empty, offline and expired-session states. Exactly one primary nav is rendered. Header/context remain before content on fresh and previously loaded modules.
3. Multi-business/profile changes preserve authorisation, selected-business context and current-request authority; old responses cannot replace a newer page. Preserve the existing Today, Orders, Stock, Supplier and Settings race/isolation regression suites.
4. Food, Non-food and Mixed profiles keep appropriate Catalog/recipes/Quick Sale/Stock availability, publication/readiness restrictions and existing create/edit workflows.
5. Counter orders, reservations, receipt/payment evidence, cash close, inventory purchase/lot/consumable behavior and supplier receiving/payment invariants remain unchanged. UI layout tests alone are insufficient for operational changes.
6. Account settings do not silently switch operational context. Navigation links do not bypass profile activation, commerce review, Admin delegation or MFA. Guest cannot see private guides or financial data.
7. Exact-head CI + Admin Runtime Contract + applicable isolated Preview automated and real-browser acceptance before merge. Serialise shared Preview; do not seize another stream's reservation.
8. After validated merge, verify exact Production SHA/deployment SUCCESS and agents' own smoke at caliof.com. Only Production is the Owner acceptance surface; until then report NOT YET IN PRODUCTION.

## Coordination boundary

Agent 8 owns this research leaf and new `docs/research/UI_NAVIGATION_*`, its concept and evidence images only. Runtime ownership remains with active streams: Inventory #813, Orders #814, recipe visibility #816/PR818, Supplier #801/PR805, Settings #812, Knowledge #85/PR803, Help #808/PR817 and research PR810, Local Services payments #571/PR790. No shared Preview/environment changes, operational data writes, session sign-out or changes to their files were performed here. The Production Merchant test account was left on Today.

Do not open duplicate runtime issues for these active defects. The future shell change needs a new, explicitly coordinated leaf with the above acceptance contract after this proposal is reviewed. No runtime implementation has been authorised by this research issue alone.
