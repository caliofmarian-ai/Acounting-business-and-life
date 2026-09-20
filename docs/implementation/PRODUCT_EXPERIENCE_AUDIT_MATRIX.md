# Product Experience Audit Matrix — Philippines Reference Edition

Status: ACTIVE QA / RELEASE EVIDENCE  
Audit date: 2026-09-20  
Canonical repository: `caliofmarian-ai/Acounting-business-and-life`  
Verified `main` baseline at audit start: `5e8c5e2a9c330ccc4be6717d9f31a43239d70723`

## Evidence rule

`PASS` is used only where current executable behavior has direct automated or runtime evidence.  
`PARTIAL` means an important part is implemented and evidenced, but the complete profile journey is not yet accepted.  
`UNKNOWN` means repository implementation may exist, but this audit has not yet produced enough executable acceptance evidence.  
`BLOCKED` means the flow cannot currently be completed because a known product, policy or external gate is still open.

The application is mobile-first and the Philippines edition is the reference edition.

| Profil | Onboarding | Home/Dashboard | Core flow | Finance | Notifications | Settings | Support | Mobile UX | E2E | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity / Account | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PASS | PARTIAL | PARTIAL | PARTIAL | PARTIAL | P1: Customer auth/recovery and shared account foundations are evidenced, but complete multi-profile account acceptance is not yet proven role by role. |
| Customer | PASS | PASS | PARTIAL | PASS | PASS | PARTIAL | PASS | PARTIAL | PARTIAL | Pickup commerce, payment evidence, history, notifications, Support, privacy and recovery are accepted in isolated QA. Full delivery remains dependent on the Courier wave; public live online payment remains behind the PayMongo live gate. |
| Merchant | PASS | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UNKNOWN | PARTIAL | PARTIAL | Merchant onboarding, catalog, recipes, stock, Marketplace publication and AI fallback media are evidenced. Launch-quality still requires one complete Merchant experience acceptance covering business finance, notification reception, Settings, Support and session recovery. |
| Supplier | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UNKNOWN | PARTIAL | UNKNOWN | P1: procurement capability exists, but no dedicated isolated Supplier acceptance wave currently proves onboarding through commercial settlement and cross-profile Merchant reconciliation. |
| Courier / Delivery | PARTIAL | PARTIAL | PARTIAL | BLOCKED | PARTIAL | PARTIAL | UNKNOWN | PARTIAL | UNKNOWN | P1: delivery capability exists, but full Courier acceptance is missing and authoritative compensation/payout evidence is not yet configured. Customer full-delivery E2E is therefore still on HOLD. |
| Service Provider / Local Services | PARTIAL | PARTIAL | PARTIAL | BLOCKED | PARTIAL | PARTIAL | UNKNOWN | PARTIAL | UNKNOWN | P1: service lifecycle exists, but no dedicated end-to-end acceptance proves request → quote → job → completion → finance/support. Online service-job checkout is intentionally fail-closed until its payment/settlement boundary is accepted. |
| Delegated Admin | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PASS | PARTIAL | UNKNOWN | P1: RBAC, Support, incidents and scoped administration have implementation/tests, but role-by-role allowed and denied actions still need isolated acceptance for each delegated authority level. |
| Super Admin / Company | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PASS | PARTIAL | UNKNOWN | P1: company/admin foundations and finance components exist, but the full company operational dashboard has not yet been accepted as one coherent mobile operating surface. |

## Verified environment checkpoint

- `caliof.com` is the public production surface on Railway service `accounting-business-life`.
- `preview.caliof.com` is the isolated internal QA surface on Railway service `accounting-preview`.
- Production and preview both reported `SUCCESS` for the verified audit-start `main` commit.
- QA and public production use separate databases and secrets.
- A legacy Railway service named `accounting-v011-notifications-preview` still exists and must be proven unused before retirement; it is not treated as another canonical product.
- Public production live PayMongo checkout remains gated; QA uses controlled test mode.
- Notification Settings use the compact accordion model and must not regress to the old long always-expanded list.

## Current P0/P1 queue

No new P0 was proven during the audit-start checkpoint.

Current P1 focus:

1. Merchant complete experience acceptance.
2. Supplier isolated onboarding/procurement/finance acceptance.
3. Courier delivery/earnings acceptance and cross-profile Customer delivery completion.
4. Service Provider job/finance acceptance.
5. Delegated Admin allowed/denied authority acceptance.
6. Runtime latency/request-efficiency work, especially the chained gateway architecture and foreground notification polling.
7. Reconcile stale open issues only after executable evidence proves completion.

## Merchant acceptance target

The next controlled wave is `merchant_experience_v1`.

It must prove, without production test pollution:

1. Merchant onboarding and approved business workspace.
2. Catalog, recipe, stock and AI reference-media persistence.
3. A completed Customer Marketplace order crossing into Merchant state.
4. Merchant business-finance reconciliation against the completed order and confirmed payment.
5. Merchant receipt of its required order notifications.
6. Profile Settings retain Merchant/business context while shared external Money & Banking remains account-level.
7. Merchant Support can create and retrieve a contextual ticket.
8. Logout and re-login restore a valid Merchant session.
9. Supplier, Courier and live-online-payment dependencies remain explicit `HOLD` rather than being falsely marked `PASS`.
