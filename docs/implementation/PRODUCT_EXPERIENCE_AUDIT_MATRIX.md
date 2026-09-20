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
| Merchant | PASS | PASS | PARTIAL | PASS | PASS | PASS | PASS | PARTIAL | PARTIAL | The dedicated Merchant experience wave is `PASS`: Account Home, catalog persistence, completed Marketplace order, finance reconciliation, notifications, Settings, Support and session recovery are proven. Supplier procurement, Courier delivery and live online payment remain separate `HOLD` boundaries, so cross-profile launch E2E is not overstated. |
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

1. Supplier isolated onboarding/procurement/finance acceptance.
2. Courier delivery/earnings acceptance and cross-profile Customer delivery completion.
3. Service Provider job/finance acceptance.
4. Delegated Admin allowed/denied authority acceptance.
5. Runtime latency/request-efficiency work, especially the chained gateway architecture and foreground notification polling.
6. Reconcile stale open issues only after executable evidence proves completion.

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


## Merchant experience acceptance evidence — 2026-09-20

The controlled preview wave `merchant_experience_v1` returned `PASS` on deployment
`663c9fbf-c92e-4683-8c2e-5f1c035ed374` at canonical commit
`debc764ef9f40b997a66c8c3a650d7a096588465`.

Direct evidence:

- Merchant Account Home resolved the active Merchant business workspace.
- The controlled completed Marketplace order persisted as order `6`.
- Merchant Finance reconciled at least PHP 185 of completed merchandise and confirmed payment evidence.
- Merchant notification lifecycle returned three expected order events.
- Merchant Settings preserved profile/business context and shared account Money & Banking.
- Merchant Support created and retrieved contextual ticket `3`.
- Logout and re-login restored a valid Merchant session.
- Supplier procurement, Courier delivery and live PayMongo remain explicit `HOLD` boundaries.

## Supplier acceptance target

The next controlled wave is `supplier_experience_v1`.

It must prove, in isolated preview only:

1. invite-first Supplier onboarding and Admin approval in the QA Philippines territory;
2. Supplier private profile and catalog persistence;
3. Merchant ↔ Supplier relationship acceptance;
4. Merchant PO → Supplier acceptance/status → Merchant receipt → Merchant payment;
5. Supplier Finance records fulfilled PO and payment evidence without inventing provider/bank settlement;
6. Supplier notification lifecycle includes relationship invite, PO creation/update and payment receipt;
7. Supplier Settings preserve business context and shared account Money & Banking;
8. Supplier Support preserves purchase-order context;
9. Merchant and Supplier views agree on a received and fully paid PO;
10. logout/re-login restores the Supplier session.

Until that executable wave returns `PASS`, the Supplier row remains `PARTIAL`.
