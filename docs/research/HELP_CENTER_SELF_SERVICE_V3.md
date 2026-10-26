# Help Center V3: guest and member self-service

Date: 2026-10-26 (Europe/Dublin)

Research issue: [#807](https://github.com/caliofmarian-ai/Acounting-business-and-life/issues/807)

First implementation issue: [#808](https://github.com/caliofmarian-ai/Acounting-business-and-life/issues/808)

Status: **RESEARCH COMPLETE / IMPLEMENTATION PROPOSED**

Source baseline: `66895144e5c13702308a83327e41500b5699a41c`

## Decision

Extend the existing `/help` into a layered Help Center: searchable verified guides, short answers, guided troubleshooting, contextual next actions and an explicit Support handoff. An optional AI answer layer should explain the same approved content with citations. The guides, search and handoff must remain usable when AI is unavailable.

This is the recommended design for this application, not a measured claim that one design is universally best. It reuses the public catalog, profile taxonomy, help codes, language work and private Support workflow already present. No additional hosting, database or paid search service is needed for the first implementation slice.

The goal is complete coverage of released user tasks and a dependable recovery path for unfamiliar problems. It is not possible to guarantee a correct automatic answer to every future problem. When evidence is missing, the Help Center must say so and offer the appropriate next step.

This research does not implement or deploy the proposed experience. It changes no runtime, authentication, payments, permissions, provider configuration or application data.

## Evidence and coordination boundary

The audit read current `main`, open issues, PRs and branch scope. Public foundations #43/#53 and the single Account Settings Help & Support entry in #588 are complete. This design extends them.

At audit time the other active work included:

| Work | Ownership respected by this slice |
| --- | --- |
| Private Knowledge Center #85 / PR #803 | Private catalog, Markdown reader, access controls, `/knowledge`, entry wiring and `server-admin-operations.js` remain with that agent. |
| Merchant #353/#794/#800 / PR #802 | Today, Counter orders, Storefront refresh and their tests remain with that agent. |
| Supplier #801 | Orders/ETA navigation and request-context handling remain with that agent. |
| Authentication recovery and Local Services #571 / PR #790 | Existing authentication and payment authority remain untouched. |

Only new files under `docs/research/` belong to this research PR. No shared Preview pointer or Railway environment was changed.

On `https://caliof.com/health`, the browser observed `ok: true`, `db: true`, environment `production` and revision `66895144e5c1`, matching the audited source prefix. The health response did not expose a deployment ID; this audit does not invent one. These are point-in-time observations, not a whole-application production acceptance test.

### Current foundation and confirmed weaknesses

| Observation | Evidence at the source baseline | User consequence |
| --- | --- | --- |
| 65 public articles, five profiles, 16 help-code mappings | `public/help/content.json` | There is a useful foundation to improve. |
| Entire query is matched as one lower-case substring | `searchArticles()` in `public/help/help.js` | Natural questions, rearranged words and common typos can produce no result despite an existing guide. |
| Search omits long-form `sections` content and exists only on home | `searchArticles()`, `home()`, `profilePage()`, `articlePage()` | Users cannot reliably discover explanations inside the substantial overview; they must return home to search again. |
| All 65 articles have `status: current`; none has article-level source, reviewed date or release metadata | Catalog field inspection | The badge does not prove the instructions match the deployed version. |
| Catalog boundary and architecture still contain exclusions from the early Admin/Support and Referral/Growth development period | Catalog `product.currentBoundary`; `docs/public-help/ARCHITECTURE.md` and `PRODUCT_CATALOG.md` | A historical boundary is presented alongside newer product behavior. |
| Yes/No feedback controls are rendered without handlers or persistence | `articlePage()` and binding functions | The interface promises feedback that does not reach a maintainer. |
| Public pages do not use signed-in role, screen or allowed action context | `public/help/help.js` | A Merchant on an approval screen receives the same generic starting point as a guest. |
| Only the first nine help codes are shown on home | `Object.entries(...).slice(0,9)` | Seven existing code destinations are less discoverable through that home section. Direct mappings still exist. |
| Contextual suggestions mainly infer meaning from HTTP paths and English error strings | `public/help-linking.js` | A broad match can give the wrong explanation, and text changes/translations can break classification. |
| Support tickets require identity, while public articles direct stuck readers back to the app | `POST /api/support/tickets` in `server-admin-operations.js`; `report-problem` article | Someone unable to sign in needs a public recovery/contact path that does not itself require sign-in. |

The browser confirmed `/help` loads the 65-guide public home without a sign-in prompt. Entering **I cannot sign in** displayed **No matching guide**. Entering **ERR-AUTH-001** found **Sign in or reset your password**. The article showed generic four-step instructions, feedback controls, a report-problem link and no search field.

### Reproducible search baseline

The accompanying [search baseline](HELP_CENTER_SEARCH_BASELINE_2026-10-26.json) contains 20 deliberately selected queries and the actual returned slugs. It was produced by running the unmodified current `public/help/help.js` in a Node VM, supplying the catalog and a stubbed, non-network fetch. The exact source and catalog SHA-256 hashes are included.

To reproduce from the repository root at the audited revision, supply the saved queries to the actual search implementation:

```js
import fs from 'node:fs';
import vm from 'node:vm';
const catalog = JSON.parse(fs.readFileSync('public/help/content.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync(
  'docs/research/HELP_CENTER_SEARCH_BASELINE_2026-10-26.json', 'utf8'));
const context = vm.createContext({catalog, fetch: () => new Promise(() => {})});
vm.runInContext(fs.readFileSync('public/help/help.js', 'utf8'), context);
vm.runInContext('state.data = catalog', context);
for (const {query} of baseline.queries) {
  const hits = vm.runInContext(`searchArticles(${JSON.stringify(query)})`, context);
  console.log(query, hits.map(article => article.slug));
}
```

Results: **4 queries returned at least one article; 16 returned none**. This is a diagnostic corpus, not sampled traffic, task-completion data or a relevance success rate. It mixes retrieval failures and content gaps; a hit can also be irrelevant.

| Query | Current returned slugs |
| --- | --- |
| `password` | `sign-in-recovery`, `create-account` |
| `reset password` | none |
| `I cannot sign in` | none |
| `ERR-AUTH-001` | `sign-in-recovery` |
| `how do I create an account` | none |
| `browse without account` | none |
| `my application is under review` | none |
| `upload missing documents` | none |
| `food and non-food` | `browse-marketplace` |
| `packaging consumables` | none |
| `low stock alert` | none |
| `financial accounts` | none |
| `notification sounds` | none |
| `delete my account` | none |
| `handoff code` | `courier-completion-code`, `delivery-tracking-handoff`, `courier-active-delivery` |
| `where is my money` | none |
| `supplier ETA` | none |
| `mag reset ng password` | none |
| `forgot pasword` | none |
| `delivery quote expired` | none |

Existing foundation checks were also run: `node --test tests/help-center.test.js tests/account-settings-help-unification-v1.test.js` — **11 passed, 0 failed**. These establish existing route/catalog/launcher contracts; they do not prove the proposed V3 experience works or that every current article is accurate.

## Options considered

| Approach | Value | Limitation in this application | Decision |
| --- | --- | --- | --- |
| Larger article directory | Low running cost; predictable content | Does not resolve wording sensitivity, screen context or stale instructions by itself | Keep as the foundation. |
| AI chat as the main entry | Can interpret varied questions and explain steps | Adds latency/cost; can invent menus or rules; cannot repair inaccurate source content | Do not make it the only help path. |
| Layered self-service | Combines fast search, verified short answers, branching diagnosis and escalation; AI can improve phrasing later | Requires content ownership, evaluation and a modest context contract | Recommended. |

External research supports consistent help placement, actionable error recovery and continual review of knowledge based on use. The particular layering and rollout order below are design inferences for Business & Life, not findings directly measured by those sources.

## Audience and access model

| Audience | What Help Center can offer | Boundary |
| --- | --- | --- |
| Guest | Product explanation, public Food/Non-food discovery limits, prices as published, role requirements, account creation, sign-in recovery and public guides | Guest is a browsing state, not a sixth profile. No checkout, private stock, account status, balances, evidence or private documents. |
| Signed-in account | The same public help, account utilities, language, privacy and Support/My tickets | Do not require an operational profile for account help. |
| Customer | Orders, payment vs fulfilment, delivery, services, reviews and safe reporting | An authenticated, authorized app view owns actual order/payment facts. |
| Merchant | Today, Catalog, Counter orders, Storefront, inventory/consumables, procurement, delivery and Money | Role selection in Help is a relevance preference. It grants no access to any business. |
| Supplier | Connections, catalog, purchase orders, quantities, ETA, exceptions and Finance | Explain Supplier-specific navigation and business context; do not reuse Merchant instructions indiscriminately. |
| Delivery | Onboarding eligibility, operating area, availability, offers, collection, location, proof, handoff and Money | No invented approval, assignment, payout or location disclosure. |
| Local Services | Approval/scope, public services, quotes, changes, jobs, confirmation, Money and evidence consent | Readiness, job completion, customer confirmation and actual payment remain separate. |
| Authorized Admin | Public guide plus an explicit entry to permitted `/knowledge` content | Private retrieval belongs to #85; existing server authorization remains authoritative. |

The public content bundle must contain only explicitly public instructions. Hiding private articles in browser filters is not access control. Initially, AI retrieval should use **public approved content only**, including for signed-in users. Private retrieval is a separately reviewed integration after #85 is stable; do not preload its content into a public search index.

## Proposed user experience

Use one consistently placed **Help & Support** entry in the application, preserving #588. Within it, show **Find an answer**, **Contact Support** and **My tickets** as the useful choices. Guests see appropriate public options and an account-access contact path. Avoid introducing another floating question mark that can cover Money or other navigation.

The Help home starts with **How can we help?**, one search/question field and a few common tasks: sign in, start a profile, order/delivery, money, or report a problem. Product architecture and the complete catalog remain reachable below. A guest may choose a role to learn about; an enabled profile must not be required merely to read public instructions.

Keep search and language controls available on home, profile and article pages. For signed-in help, suggest the active role and current task while allowing the user to change the help topic without switching the actual app profile.

An answer should have:

1. A direct short answer in plain language.
2. At most a few immediate steps, with detail expandable.
3. The prerequisites and reason a control is unavailable.
4. A safe **Open the relevant screen** action when a canonical action exists.
5. The public source article, reviewed date and availability qualification.
6. **Still need help?**, with the correct Support, privacy or incident path.

App links must use a reviewed allow-list of canonical actions/routes. Do not invent a URL for a modal or a button that has no stable link. Preserve current profile/business selection and unsaved work. A Help role filter is never an instruction to switch workspaces.

### Example diagnostic journeys

| Question | First useful response | Appropriate next branch |
| --- | --- | --- |
| “Can I use this without an account?” | Explain public Food/Non-food browsing and what registration unlocks. | Continue browsing or open account creation; never imply guest checkout. |
| “I cannot sign in” | Offer password recovery and distinguish a wrong password, expired session and service failure. | Verified public account-access contact if self-service fails; do not route the only contact behind login. |
| “My Merchant is approved but the shop is still starting” | Explain profile authorization, commerce readiness and Storefront publication as distinct gates. | Show the applicable next task from authorized app state, or explain how to find it. Do not promise approval or a review deadline. |
| “How do I add packaging?” | Explain inventory classification and whether the material is used per recipe, batch or order. | Open the appropriate current inventory guide/action; do not invent a stock movement. |
| “Where is my money?” | Ask whether the user means an order payment, recorded balance or provider payout, and which profile. | Relevant guide and authorized Money screen; no answer may claim funds moved without provider evidence. |
| “Supplier ETA is wrong” | Distinguish a promised ETA from a private order's actual state. | Open the Supplier purchase-order/exception guide; actual data is read only through existing permissions. |

Guided troubleshooting should use a small, versioned decision tree for common blockers. Each branch has an exact question, known state conditions, a verified explanation and a safe next action. Do not ask guests for private details to choose a public article.

## Search and answer contract

### First slice: deterministic retrieval

Keep the small public catalog local. Index titles, summaries, short answers, steps, prerequisites, common problems, notes, long-form sections, reviewed aliases and help codes. Normalize punctuation/diacritics, tokenize natural questions, support limited typo tolerance and use curated English/Filipino synonyms.

Rank exact stable help codes first, then title/intent/phrase matches and relevant body matches. Role and task may boost results, but unrelated profile restrictions must not hide public information. Recognize broad or ambiguous queries and offer a few meaningful refinements. Do not declare success merely because one article shares a token.

Provide accessible keyboard navigation, result count announcements, Enter/Escape behavior and a useful empty state. Avoid a `listbox` label unless its actual keyboard/option semantics are implemented. Search must work across the catalog and on every reading page. Unknown codes offer search and contact without fabricating a diagnosis.

### Contextual assistance

Gradually replace English-message inference with a small structured help payload: stable help code, safe screen identifier, help-topic role and allow-listed action ID. During transition, retain the current mappings as fallback. Do not modify every operational module in one PR.

Use only approved coarse state for suggestions. Account/business IDs, tokens, addresses and error bodies do not belong in a public Help URL. A query parameter selecting Merchant help is presentation context, not authority. Delayed help from a previous profile/business must be discarded; the active workspace still owns context validity.

For validation errors, keep the correction next to the field and provide a relevant explanation. Approval restrictions and service outages need their own explanations; do not treat them as a malformed user input. Help must not replace a safe primary recovery action or obscure the form.

### Optional AI explanations

Retrieve approved, applicable articles first; give the answer service only the necessary public excerpts. Require source article IDs for product claims, resolve links from the approved catalog, and check applicability to the selected country, locale and released capability. A model's self-reported confidence is not evidence.

The answer service must abstain or clarify when retrieval is weak, documents disagree or a task is not released. Show the sources and the next safe step. Treat retrieved text and user questions as untrusted input; they cannot override scope, reveal private material or create tool authority.

The first AI release is explanatory and read-only. It cannot approve a profile, edit stock, submit an order, take payment, accept terms, change account security or file a ticket silently. Do not automatically send account data, attachments, recordings or private incident text to an AI provider. Reusing an existing speech/translation integration still requires its configuration, processing notice and request boundaries to be verified.

Use bounded input/output, timeout, per-session limits, cost ceilings and a kill switch. Cache only answers based entirely on public content, keyed by article version, locale and applicability. Personalized answers must not enter a shared cache. No new paid provider or infrastructure is provisioned by this research.

## Priority content reconciliation

Audit every current guide; the following are the first demonstrated gaps. Code availability alone is not final runtime acceptance. New instructions must be checked against the deployed behavior and use the actual visible labels.

| Priority | Topic / change | Current source to verify |
| --- | --- | --- |
| P0 | Guest browsing, what is public, conversion at protected actions | `docs/architecture/GUEST_EXPLORATION_AND_ONBOARDING.md`, public Marketplace projection and Guest UI |
| P0 | Sign-in failure, password reset, expired session and service outage; public account-access contact | `public/auth-ui.js`, `public/session-security.js`, current account security UI and public contact configuration |
| P0 | Profile application by role: Merchant/Local Services self-start; Supplier/Delivery invitation gates for normal launch users | `public/profile-governance-ui.js` (`GOV_META`, `roleControl`), `server-profile-governance.js` (`/profiles/:role/start`) |
| P0 | Under-review evidence upload, Admin notes, corrections and resubmission | `applicationEvidenceCard()` / application rendering in `public/profile-governance-ui.js` |
| P0 | Profile authorization vs commerce readiness vs public Storefront publication | `public/profile-governance-ui.js`, Storefront UI and current readiness gates |
| P0 | Money facts: recorded balances, payment status, payable quote, payout readiness and fees | `public/profile-settings-ui.js`, `profile-finance-core.js`, payment/finance authority; #571 is not documented as released while open |
| P1 | Merchant Today, Food/Non-food/Mixed, canonical Catalog and Counter orders | Current Merchant scripts and #353/#794; apply #800 wording only after release evidence |
| P1 | Inventory classes, recipes/batches, packaging and operational consumables, low-stock/restock, counts, locations and allergen review | `universal-inventory-core.js`, `server-business-accounting.js`, inventory UIs and `food-allergen-core.js` |
| P1 | Supplier Orders, ETA, exceptions and dedicated Finance navigation | `public/suppliers-ui.js`, Supplier daily/exception modules; #801 remains another agent's fix |
| P1 | Delivery operating area, current dispatch/tracking/handoff and evidence boundaries | Delivery UI and server eligibility/routing policies; do not describe blocked #617 acceptance as complete |
| P1 | Local Services Home/Services/Jobs/Money, quotes and approved changes, completion vs payment | `public/services-ui.js`, service pricing/job lifecycle and merged payment behavior |
| P1 | Account vs Profile Settings, Money & Banking, notification preferences/sounds, language, deletion checks and privacy requests | `public/shell.js`, `public/profile-settings-ui.js`, notification/session/account lifecycle UIs |
| P1 | Help & Support, My tickets and incidents as different purposes | `public/admin-operations-ui.js`, current Support/incident routing and #588 |
| P1 | English/Filipino help aligned with guided onboarding | `public/guided-onboarding.js` and its `en-PH`/`fil-PH` packs; complete translations require review |

The current inventory guide is four generic steps and does not explain these newer stock flows. Generic approval guidance does not distinguish the role-specific start gates or explain adding evidence during review. Existing Support has categories, conversations, attachments and privacy routing; the public report-problem article describes only incidents. These are content reconciliation tasks, not invitations to rewrite the underlying features.

Do not copy test-account exceptions into normal user instructions. Do not repeat the current application's displayed “typical review time” as a Help Center service promise without an approved operational commitment. Dynamic fees, delivery prices, availability and payout readiness should link to the current authoritative app disclosure instead of hard-coded timeless claims.

## Content freshness and governance

Preserve stable article slugs/help codes. Add an explicit public publication state and a separate verification record. Map to the canonical controlled-document states from `docs/governance/CONTROLLED_DOCUMENT_STANDARD.md`; do not create competing legal/policy approval rules.

Proposed article metadata:

| Field | Purpose |
| --- | --- |
| Stable ID/slug, version, locale and source-translation version | Identify one concept and detect outdated translations. |
| Audience/profile/topic and country applicability | Rank the right instructions without granting authority. |
| Explicit `PUBLIC` classification and approved/effective state | Prevent accidental publication of private or draft material. |
| Content owner, reviewer, reviewed date and review-due date | Assign maintenance responsibility. |
| Source paths, verified commit and verified capability/evidence | Explain what implementation and user journey were checked. |
| First applicable release, supersedes and availability conditions | Distinguish current, limited, unavailable and superseded behavior. |
| Related help codes, canonical action IDs and aliases | Keep recovery and discovery consistent. |

Do not require each article's verified SHA to equal every later release SHA: unrelated releases do not invalidate all articles. Track changed capabilities/source dependencies and require review for affected guides. Source-path changes are a prompt to inspect meaning, not proof that prose must always change.

Each user-visible product PR declares either affected articles/updates or a reviewed reason no help change is needed. A CI content contract checks uniqueness, code targets, public classification, supported locale metadata, links/action allow-lists, translation drift and recorded ownership. New behavior is described as current only after exact-head validation and production promotion. A rollout flag or unconfigured provider must remain a visible availability qualification.

Use feedback and unresolved searches to prioritize maintenance. A negative vote asks an optional reason such as outdated, unclear, missing step or did not solve. Confirm receipt only after storage succeeds. Guest feedback is bounded and abuse-limited; do not require identity for a simple vote. Public health/outage messages require a verified publishing path, expiry and an accountable owner.

A sensible initial review policy is event-driven review plus a 30-day reminder for rapidly changing/high-impact guides and a 90-day reminder for stable introductions. These are proposed maintenance defaults, not evidence of a rule changing and not a scheduled automation created by this research.

## Escalation and measurement

For members, reuse the existing Support conversation and private incident/privacy routes. With explicit user action, prefill a draft containing the public article ID/version, safe error code, selected category and the user's editable description. Before sending, show what will be included. The server verifies any related record access. Attachments, private logs and transcripts are never copied silently.

For a guest or locked-out user, offer a verified public account-access contact destination without requiring successful sign-in. The first implementation can reuse an already effective published support contact if one is confirmed. If none is operational, create a separately scoped, abuse-limited account-access intake. It must not disclose whether another person's account exists or return private ticket content. This is a release prerequisite for the locked-out escalation journey; the current authenticated ticket endpoint is not an anonymous endpoint.

Measure task completion through observed journeys, result relevance, explicit helpful/unhelpful feedback and Support outcomes. Useful aggregates include zero-result intent, result selection, time to a useful answer, outdated reports and repeat unresolved topics. A user leaving without a ticket is not proof that their problem was solved.

Prefer first-party aggregate counters without raw question text or durable user tracking. Typed questions can contain personal information. Do not automatically publish them as GitHub issues, send them to external analytics, or connect them to the blocked growth/PostHog activation programme (#203/#49). A later analytics design must specify permitted fields and retention.

## Scoped implementation order and acceptance

| Slice | Work | Minimum evidence before runtime delivery |
| --- | --- | --- |
| 1: trustworthy self-service | Reconcile P0 content; persistent search; intent/typo handling; first guided blockers; accurate guest/member paths and English/Filipino core journeys | Search relevance corpus, content/source review, anonymous routes, task journeys and no launcher overlap. |
| 2: release maintenance and handoff | Metadata/CI dependency coverage, functioning feedback, safe member draft handoff and a verified public locked-out contact | Successful and failed-save feedback tests, privacy boundaries, deliberate ticket submission, translation/release drift tests. |
| 3: grounded AI answers | Public-only cited explanations, clarification/abstention, provider/time/cost limits and fallback | Fixed evaluation set, fabricated-menu negatives, unauthorized/private-request negatives, provider failure and cost-bound tests. |
| Later: authorized private help | Integrate permitted `/knowledge` retrieval through #85's canonical server checks | Separate security review; revocation, business isolation, MFA and cache negatives. |

Keep slice 1 within public Help files and focused new modules/tests. Take narrow app-entry/Support/context wiring only after checking current owners and the merged #85 state. Future runtime implementation follows `AGENTS.md`: isolated exact-head Preview checks owned by agents, then reviewed merge, successful production deployment and agent smoke on `https://caliof.com`. The Owner is never asked to diagnose Preview.

Proposed release targets are acceptance goals, not measured outcomes:

- Build a reviewed corpus of at least 50 intents across Guest, account utilities and all five profiles, with expected relevant articles/branches and explicit ambiguity cases. For answerable cases, target at least 90% with a relevant top-three result; validate the remaining cases individually rather than return unrelated matches.
- Every stable help code resolves; unknown codes get a useful fallback. Include punctuation, word order, typo and Filipino variants and long-form article content in tests.
- At 360 CSS pixels and 200% zoom, primary actions remain usable, navigation is not covered, keyboard/focus behavior is sound, and article reading has no horizontal overflow. Physical Android acceptance is distinct from desktop emulation.
- Demonstrate six real journeys: guest understanding/registration boundary; sign-in recovery; profile review/evidence; Merchant stock/consumables; order or delivery problem; money/payout clarification. Include a deliberate unresolved case reaching usable support.
- Guest/public endpoints and bundles expose no private account, stock, finance, incident, Admin or Knowledge Center data. Help never switches business authority or performs financial/operational writes.
- AI answers, if enabled, cite existing applicable sources for product claims; unsupported questions clarify or abstain. Prove no privileged access or executable action can be obtained through prompts.
- Verify articles/actions against the deployed capability. Report code SHA and production deployment evidence for runtime releases; repository research completion alone is not product completion.

## Research sources

Primary sources were consulted on 2026-10-26. They support the design principles; they do not validate Business & Life implementation.

- [W3C: Understanding WCAG 2.2 Consistent Help](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html) — repeated help mechanisms should appear in a consistent relative order. This does not by itself certify accessibility or prescribe a floating widget.
- [GOV.UK Design System: Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/) — explain the problem and how to recover; preserve user input and distinguish validation from permission/eligibility and service failures.
- [Consortium for Service Innovation: KCS Article State](https://library.serviceinnovation.org/KCS/Knowledge-Centered_Success_Practices_Guide/301-Evolve_Loop/Practice_5_Content_Health/Technique_5.2) — maintain validation, visibility and continual review as knowledge is reused.
- [Consortium for Service Innovation: Self-Service Measures](https://library.serviceinnovation.org/KCS/KCS_v6/KCS_v6_Practices_Guide/030/040/010/085) — combine observation, feedback and behavior trends; a single indirect measure does not prove successful self-service.

Repository evidence is anchored at [the audited source revision](https://github.com/caliofmarian-ai/Acounting-business-and-life/tree/66895144e5c13702308a83327e41500b5699a41c): `public/help/`, `public/help-linking.js`, `tests/help-center.test.js`, `tests/account-settings-help-unification-v1.test.js`, `public/shell.js`, `public/profile-settings-ui.js`, `public/profile-governance-ui.js`, `server-profile-governance.js`, `server-admin-operations.js`, `server-business-accounting.js`, `universal-inventory-core.js`, `docs/public-help/`, `docs/architecture/GUEST_EXPLORATION_AND_ONBOARDING.md` and `docs/governance/CONTROLLED_DOCUMENT_STANDARD.md`.
