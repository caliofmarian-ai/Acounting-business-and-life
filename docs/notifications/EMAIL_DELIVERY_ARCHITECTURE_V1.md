# Email Delivery Architecture V1

Status: **OUTBOUND LIVE / PROVIDER OBSERVABILITY V2C IN REVIEW**

Provider: **Resend**

## Separation of responsibility

Business & Life owns:
- authentication identity;
- email verification tokens;
- password-reset tokens;
- user/profile/account permissions;
- departmental routing;
- notification templates;
- delivery ledger;
- audit and retention policy.

Resend is the outbound email transport provider only.

Resend does not become the authentication authority.

## Department routing

Outbound email is classified into one of six departments:

| Department | Typical event families |
|---|---|
| Security | auth, verification, password, security |
| Billing | payment, invoice, subscription, refund, settlement, fee, finance |
| Support | support, incident |
| Legal | legal, privacy, consent, compliance |
| Marketing | marketing, referral, promotion, campaign |
| Operations | everything else |

## Railway credential model

Preferred department-specific variables:

```
AUTH_EMAIL_PROVIDER=resend

RESEND_API_KEY_SECURITY=
RESEND_FROM_SECURITY=

RESEND_API_KEY_BILLING=
RESEND_FROM_BILLING=

RESEND_API_KEY_SUPPORT=
RESEND_FROM_SUPPORT=

RESEND_API_KEY_OPERATIONS=
RESEND_FROM_OPERATIONS=

RESEND_API_KEY_LEGAL=
RESEND_FROM_LEGAL=

RESEND_API_KEY_MARKETING=
RESEND_FROM_MARKETING=
```

Legacy/shared fallback remains supported:

```
RESEND_API_KEY=
AUTH_FROM_EMAIL=
```

Department-specific values take precedence over shared fallback.

## Sender naming

Current Caliof-domain sender architecture:

- Security: `security@caliof.com`
- Billing: `billing@caliof.com`
- Support: `support@caliof.com`
- Operations: `operations@caliof.com`
- Legal: `legal@caliof.com`
- Marketing: `hello@caliof.com`

Subdomains may be introduced later for stronger reputation separation without changing Business & Life application authority.

## API-key permissions

Each departmental key should use the minimum Resend permission needed for sending.

Do not use one full-access API key in every runtime service.

Where Resend permits sender/domain restriction, restrict each sending key to its intended verified domain.

## Delivery observability

Business & Life keeps `notification_deliveries` as the internal delivery ledger.

Target lifecycle:

`queued → delivering → delivered / retry / failed / not_configured / skipped`

Communications V2C adds a signed Resend webhook adapter and keeps provider outcome separate from the existing internal delivery lifecycle.

Provider outcomes:
`accepted → sent → delivered / delivery_delayed / bounced / complained / failed / suppressed`.

The existing `notification_deliveries.status` remains the internal transport/worker state for backward compatibility. Resend webhook truth is stored in `provider_status` and `provider_last_event_at`, with minimized idempotent evidence in `notification_provider_events`.

## Webhook security

The V2C Resend webhook:
- consumes raw request bytes;
- verifies the Resend/Svix signature before parsing trusted event state;
- uses Railway secret `RESEND_WEBHOOK_SECRET`;
- is idempotent on `svix-id`;
- stores no recipient address, subject or body from provider payloads;
- safely retains unmatched provider events for later reconciliation if a webhook wins the send-response timing race.

## Environment policy

### Preview
- provider may be configured;
- preview verification links may remain enabled for controlled testing;
- no claim of external delivery unless Resend reports success.

### Production
- `AUTH_PREVIEW_SHOW_LINK=false`;
- verification/reset links are delivered by configured email provider;
- missing provider fails visibly rather than claiming success.

## Current state / remaining V2C setup

Outbound Resend delivery is active on `caliof.com`. Test mail received through the current environment has verified SPF, DKIM and DMARC alignment for the Caliof sender domain.

Communications V2C code can receive signed provider delivery events, but production provider observability remains **HOLD** until:
- a Resend webhook endpoint is registered for the canonical production URL;
- `RESEND_WEBHOOK_SECRET` is installed in Railway secret storage;
- a signed controlled webhook event is observed and reconciled to an existing `notification_deliveries.provider_reference`.

Inbound Support email remains a separate later gate.
