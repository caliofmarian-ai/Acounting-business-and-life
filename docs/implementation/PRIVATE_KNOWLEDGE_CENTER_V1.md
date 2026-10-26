# Private Knowledge Center V1

Issue: #85. Implementation is not a production acceptance claim.

The read-only `/knowledge` portal reads controlled Markdown from the canonical
repository. Its signed-in entry appears in Account Home and the account drawer.
Public Help remains at `/help`. This portal contains reusable guidance and blank
templates, not uploaded credentials, business records or private user evidence.

## Source and document controls

`documentation-catalog.js` scans only the listed governance, masterplan, role,
PH compliance, form, SOP, pitch, agreement and training directories. Documents
need a unique controlled ID, title, version, recognized status, access class and
PH/global scope. Existing form IDs explicitly encode their PH/global scope.
Unclassified, unknown-access and concrete-territory content is excluded; no
missing access class is inferred. PUBLIC documents stay in public Help.

The catalog is bounded to 200 documents and 256 KiB per source file, excludes
symlink escapes and fails closed on duplicate IDs. Content is loaded once per
deployment; account-specific authorization is recomputed for every request.
API identifiers never become filesystem paths. Responses omit source paths.

## Authorization

`server-knowledge.js` uses the existing gateway identity function, current enabled
and active profiles, active PH business memberships from its account snapshot,
and `getAdminAssignments`. No parallel role or permission tables are introduced.

| Access class | Required authority |
| --- | --- |
| MEMBER | Authenticated available account |
| PROFILE_PRIVATE | Applicable enabled, active profile; empty applicability means generic member guidance |
| BUSINESS_PRIVATE | Active Merchant/Supplier profile and active PH business membership; applicable profile restrictions also apply |
| OPERATIONS_PRIVATE | Current active Admin assignment and matching function permissions where specified |
| TERRITORY_ADMIN | Current Territory/Country/Super Admin rank and applicable function |
| COUNTRY_ADMIN | Current Country/Super Admin rank and applicable function |
| SUPER_ADMIN | Current Super Admin rank |
| EXECUTIVE_CONFIDENTIAL | Owner account 1 with current Super Admin assignment |

Effective rank, country, account ownership, assignment status and effective dates
are checked. Specialist rank can read appropriate delegated operations guidance;
its legacy backing `admin_role` cannot grant Country/Territory/Super Admin rank.
Reading a guide never grants the authority described by it.

Super Admin privilege requires the canonical signed, unrevoked V2 session MFA
state, the existing 12-hour read policy, an active authenticator factor, and
configured key material. This check lives in the Knowledge router because the
gateway may handle the request before a downstream Auth Hardening middleware.
Missing MFA hides privileged titles/content and shows the existing Admin unlock
path. Owner ID alone is insufficient for executive access.

Both catalog and direct document requests use the same policy. Unauthorized and
unknown IDs share a generic 404. Every successful document read first writes a
sanitized `knowledge_document_read` event to the existing audit table; audit
failure withholds content. No document body or credential is logged. APIs use
`private, no-store` with Cookie/Authorization variation and are excluded by the
existing service worker's `/api/` rule.

## Reading experience

The UI supports title/topic/ID search, category filtering, document status/version
and access labels, mobile list/reader navigation, loading/error/retry states and
draft warnings. It does not accept agreements, generate forms or change policy
status. A document is not presented as binding merely because it exists here.

Markdown is rendered with DOM text nodes and a small safe element set. Raw HTML,
scripts and remote images never become executable markup. Only explicit HTTP(S),
public Help and authorized same-catalog document links are navigable. Internal
links are reauthorized when followed. External links use no-referrer/noopener.
Private catalog/content is held only in page memory and cleared on session expiry,
tab hiding and page exit; late responses cannot restore cleared content.

## Validation and release

Behavioral tests in `tests/knowledge-center.test.js` cover profile/business access,
effective Admin rank, expired/revoked/wrong-country assignments, specialist
permissions, Owner/MFA boundaries, metadata ambiguity, symlinks/duplicate IDs,
safe links, anonymous HTTP requests, direct-ID/traversal denials, permission
revocation, active-factor/session revocation, response headers and audit failure.
The existing Admin Runtime workflow is triggered by the narrow gateway wiring.

Before merge, record exact-head CI/Admin Runtime and isolated Preview browser/API
acceptance for the five profiles plus Owner and delegated Admin negatives. After
merge, record the production SHA/deployment, `/knowledge` smoke, access denials
and the Account Home/drawer entry, then reconcile Preview. Do not repoint another
agent's active Preview slot. Local tests are not production acceptance.
