# Business & Life Communications V2

Status: **V2 EMAIL + NOTIFICATION CENTER LIVE / V2C OBSERVABILITY IN REVIEW**

Parent issue: #385

## 1. Brand architecture

The public brand relationship is:

- **CALIOF** — umbrella/domain identity;
- **Business & Life** — product;
- **Business & Life by Caliof** — official relationship shown in email and communication surfaces;
- canonical public domain: `caliof.com`;
- internal QA domain: `preview.caliof.com`.

The product is not renamed to Caliof. Caliof provides the recognizable domain/brand anchor while Business & Life remains the service name.

## 2. Outbound departments

| Department | Display sender | Mailbox |
|---|---|---|
| Security | Caliof · Business & Life Security | `security@caliof.com` |
| Billing | Caliof · Business & Life Billing | `billing@caliof.com` |
| Support | Caliof · Business & Life Support | `support@caliof.com` |
| Operations | Caliof · Business & Life Operations | `operations@caliof.com` |
| Legal | Caliof · Business & Life Legal | `legal@caliof.com` |
| Updates | Caliof · Business & Life Updates | `hello@caliof.com` or future `updates@caliof.com` |

Existing `RESEND_FROM_<DEPARTMENT>` configuration remains authoritative for the actual mailbox. The application adds the display name.

## 3. Channel responsibility

- **In-app**: canonical communication history and complete user context.
- **Push**: immediate attention for time-sensitive or actionable events.
- **Email**: durable confirmation, account/security action, finance evidence, support/legal communication and important operational summaries.
- **Sound/vibration**: attention only; never the sole carrier of meaning.
- **SMS**: not part of V2; reserve for a later justified fallback.

No parallel notification event system is introduced.

## 4. Email presentation contract

Every transactional email uses one reusable shell:

1. CALIOF brand marker;
2. Business & Life product name;
3. department + profile context;
4. clear event title;
5. concise body;
6. at most one primary CTA;
7. Business & Life by Caliof footer;
8. `caliof.com` recall anchor;
9. plain-text fallback.

The current application palette is reused: dark slate plus restrained teal accent. No unrelated email theme is created.

## 5. Deep-link policy

Email CTA links must open the most specific safe application context available.

V2 immediately supports exact Support ticket deep-linking through the existing `support_ticket` query contract.

Other entities continue to open the canonical application root until their route contracts are verified. V2 does not invent unimplemented URLs.

## 6. Reply / inbound boundary

Outbound Support identity may be replyable only after inbound routing is proven.

Code supports:

- `RESEND_REPLY_TO_SUPPORT`;
- generic fallback `RESEND_REPLY_TO`.

Default is blank. This means no Reply-To behavior is claimed until explicitly configured.

Inbound Support activation requires:

1. a verified receiving address/domain;
2. signed Resend/Svix `email.received` webhook;
3. idempotent message ingestion;
4. safe ticket correlation;
5. controlled attachment handling;
6. Admin/User authorship labels;
7. audit evidence;
8. test proof that an email reply reaches the correct Support ticket.

Resend supports inbound email via `email.received` webhooks, but Business & Life keeps this feature **HOLD** until these controls are complete.

## 7. Delivery observability

The existing `notification_deliveries` ledger remains canonical.

Communications V2C implements signed provider reconciliation for:

- sent;
- delivered;
- delivery delayed;
- bounced;
- complained;
- failed;
- suppressed.

Provider webhooks update separate provider evidence; they do not replace Business & Life domain state. Payloads are verified from raw bytes before trust, deduplicated by provider event id, and minimized so provider webhook storage does not copy recipient addresses or message content.

## 8. Company Gmail organization

The connected company Gmail already contains:

- `Business & Life/Company Admin/01 Support Operations`;
- `03 Trust & Safety`;
- `07 Finance & Accounting`;
- `08 Payments & Settlements`;
- `09 Legal & Governance`;
- `11 Territory Operations`;
- controlled Test Role labels.

Recommended operational mapping:

| Communication | Company label |
|---|---|
| Support | 01 Support Operations |
| Security | 03 Trust & Safety |
| Billing / finance | 07 Finance & Accounting |
| Payment / settlement | 08 Payments & Settlements |
| Legal / privacy / consent | 09 Legal & Governance |
| Operations | relevant operational queue / 11 Territory Operations when territory scoped |

Customer mailbox labels are controlled by the recipient/provider, not by Business & Life.

The current Gmail connector can create/apply labels but does not expose Gmail filter-rule creation. Therefore existing test traffic may be backfilled by label, while durable automatic routing should be configured through the mail provider/routing layer rather than falsely claimed as complete.

## 9. Marketing separation

Marketing remains opt-in and silent by default.

Marketing must not imitate:

- Security;
- Finance;
- urgent operational alerts;
- Support escalation.

Transactional Security/Billing/Support/Operations/Legal communication remains distinct from promotional updates.

## 10. Privacy and safety

- secure reset/verification links remain transient and are not stored in notification history;
- sensitive event fields remain filtered by the existing notification safety layer;
- spoken notifications must not expose private values;
- email subject lines should not reveal unnecessary sensitive financial or incident detail;
- provider credentials remain Railway secrets, never repository content.

## 11. V2 implementation slice

Implemented on `communications/caliof-email-v2`:

- reusable `email-presentation.js`;
- department-aware branded sender display names;
- professional HTML transactional shell;
- plain-text fallback;
- department/profile context;
- safe CTA target helper;
- exact Support ticket email deep-link;
- opt-in Reply-To configuration;
- reuse of existing Resend routing and delivery ledger.

Merged follow-up slices:
- Notification Center V2A — CALIOF identity, profile context and Recommended / Essential / Custom modes;
- Notification Center V2B — opt-in entity threading for Support, Orders, Delivery, Purchase Orders and Service Jobs plus grouped Web Push.

Current V2C review:
- signed Resend delivery observability;
- provider outcome reconciliation without exposing message content.

Still separate follow-up work:
- production Resend webhook registration + signed controlled evidence;
- inbound Support email → ticket;
- digest generation;
- broader verified entity deep-links.
