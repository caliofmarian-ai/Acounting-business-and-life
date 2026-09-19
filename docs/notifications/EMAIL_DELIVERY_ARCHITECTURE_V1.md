# Email Delivery Architecture V1

Status: **OWNER-APPROVED DIRECTION / PROVIDER CREDENTIALS PENDING**

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

Recommended addresses once a verified Business & Life domain exists:

- Security: `security@<verified-domain>`
- Billing: `billing@<verified-domain>`
- Support: `support@<verified-domain>`
- Operations: `operations@<verified-domain>`
- Legal: `legal@<verified-domain>`
- Marketing: `hello@<verified-domain>`

Subdomains may be introduced later for stronger reputation separation without changing Business & Life application authority.

## API-key permissions

Each departmental key should use the minimum Resend permission needed for sending.

Do not use one full-access API key in every runtime service.

Where Resend permits sender/domain restriction, restrict each sending key to its intended verified domain.

## Delivery observability

Business & Life keeps `notification_deliveries` as the internal delivery ledger.

Target lifecycle:

`queued → delivering → delivered / retry / failed / not_configured / skipped`

A future Resend webhook adapter should update provider-delivery evidence for events such as delivery, bounce, complaint and failure after signature verification.

## Webhook security

A future Resend webhook:
- must consume raw request bytes;
- must verify the Resend/Svix signature;
- must use a Railway secret such as `RESEND_WEBHOOK_SECRET`;
- must be idempotent;
- must never trust a webhook body before signature verification.

## Environment policy

### Preview
- provider may be configured;
- preview verification links may remain enabled for controlled testing;
- no claim of external delivery unless Resend reports success.

### Production
- `AUTH_PREVIEW_SHOW_LINK=false`;
- verification/reset links are delivered by configured email provider;
- missing provider fails visibly rather than claiming success.

## Current blocker

No Resend account credentials or verified sender/domain are currently installed in Railway.

The code can route by department, but actual external email delivery remains `not_configured` until credentials and sender identities are supplied.
