# Guest account-access intake — operational release assessment (#815 / PR #834)

Status: **DRAFT; not Production-approved**. Reviewed against current source on 2026-10-27. This is not a public privacy notice or proof of a staffed service.

## Actual route and human responsibility

The only guest contact path is `GET /help/account-access` + `POST /api/public/account-access`; success means committed storage in `guest_account_access_requests` and a generic HTTP 202 response. There is **no inbound Support email**, automatic response, account lookup, recovery/approval action, ticket-user portal, external notification provider, or response-time SLA. If storage fails the form retains input and reports failure/unknown state; neither the app nor documentation should say it was saved.

Only authenticated existing staff with current `support.manage` and an unscoped Philippine country/platform assignment can open `/admin/account-access` and its API. Territory-scoped or foreign-country assignments are rejected. Support Agent initial classification/escalation follows `docs/sop/SOP_SUPPORT_TRIAGE.md`, but that SOP does **not** prove a named on-duty staff operator or a monitored guest queue. Before a public release, agents must verify one **actual authorized staff login** and an operationally assigned team checks the private queue. Do not create a synthetic production assignment or request real user secrets as a workaround. No customer email reply capability exists in this implementation.

## Privacy and retention — unresolved release dependency

`docs/agreements/PRIVACY_NOTICE_FRAMEWORK.md` §7 requires purpose/record-type retention approved before publication and expressly prohibits arbitrary periods. It is still a DRAFT. `docs/privacy/INITIAL_PIC_DPO_GOVERNANCE.md` records unresolved controller allocation and public privacy contact. The 90-day/12-month referral policy in `docs/growth/REFERRAL_RETENTION_DECISION.md` is **domain-specific** and cannot be borrowed for guest account-access messages.

As implemented, guest request content (unverified contact email, optional name, reason, free text and staff note) persists in the database **without a purpose-approved retention/disposal job**. Duplicate/rate-limit metadata in `guest_account_access_limits` is deleted only when a later guest submission reaches its in-transaction cleanup, where windows older than two days are removed. It is not a request-record retention policy. Do not advertise automated PII deletion or a fixed period. Before activation, controller/privacy governance must approve guest-request purpose, lawful basis, transparent notice, record-specific retention/disposal handling, backup treatment and responsible operator. Implement and verify the approved deletion/review process on this scoped release or explicitly withhold launch until it exists. Do not expose raw contact evidence in logs/issues.

## Source-IP / proxy calibration

`server-account-access.js` uses `req.socket.remoteAddress` only; untrusted `X-Forwarded-For`, `Forwarded`, `X-Real-IP` and arbitrary visitor-supplied headers are intentionally ignored. `ACCOUNT_ACCESS_LIMITS` currently holds transactional per-hour maxima of **300 global**, **60 source** and **3 contact**, with same-day duplicate suppression. Behind a shared Railway/CDN reverse proxy, `remoteAddress` may be the proxy rather than the client: multiple legitimate visitors can share the 60-source bucket. This is a conservative availability tradeoff, not verified per-visitor IP rate limiting. Do not turn on blanket `trust proxy` or parse client-provided forwarding headers without independently verified ingress provenance/hop boundaries and tests for spoofing. Before release, inspect deployed ingress/network topology, monitor synthetic safe load/429 behavior and adjust only after the legitimate traffic and abuse threat model are reviewed. Do not remove the global/contact quotas.

## Release gates (all remain open)

1. New Help links / translations / route tests pass on the **new** PR head, including isolated real Chromium GET from Help to form, and maintain the existing guest no-private-API boundary.
2. Verify an actual current `support.manage` PH/platform staff session; list/detail/triage, audit and CSRF, denies for unprivileged staff, and the exact gateway bytes served. Synthetic fixtures alone are insufficient.
3. Record real staff queue coverage; approve/implement guest-message retention and truthful privacy notice; calibrate ingress/source limits without trusting spoofable headers.
4. Obtain current orchestrator's explicit shared Preview handoff. Pin exact head and run Preview browser/DB acceptance. After review, merge **that same head**, wait for Production SUCCESS and independently test `https://caliof.com` before issue closure. Never claim green CI as owner acceptance.

No cost, payment, external communications or Preview/Production mutation is authorized by this document.
