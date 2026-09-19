# Railway Service Topology

Status: **OWNER-APPROVED / CANONICAL**

## Canonical topology

Business & Life must not create a new Railway service for every feature, version, PR, or milestone.

The normal topology is:

1. `accounting-business-life`
   - canonical production service;
   - source: `main`;
   - production domain;
   - live configuration only after explicit readiness gates.

2. `accounting-preview`
   - one reusable preview service;
   - source branch changes to the currently reviewed PR/branch;
   - preview/test configuration;
   - PayMongo must default to TEST mode;
   - preview verification links may be enabled.

3. Temporary infrastructure-only service is allowed only when there is a real separate runtime responsibility or secret-migration constraint.

Current temporary exception:
- `accounting-v011-notifications-preview`
  - retained only as the source of the existing VAPID keypair/subject;
  - must be removed after VAPID values are migrated or rotated safely.

## Deployment workflow

For each feature:

`feature branch → accounting-preview → tests/Owner acceptance → merge to main → accounting-business-life redeploy`

The next feature reuses `accounting-preview`.

Do not create:
- `v02-preview`
- `v03-preview`
- feature-specific permanent preview services
- multiple growth/payment/help previews

unless the service is genuinely a distinct runtime component.

## Historical cleanup — 2026-09-19

Audit result before cleanup:
- 42 Railway services after creation of canonical `accounting-preview`;
- no historical preview had a volume;
- no historical preview had a custom domain;
- canonical production and preview depend only on shared DB/Auth variables plus the temporary Notifications VAPID source.

39 historical services were staged for deletion.

Railway requires interactive 2FA in the dashboard to apply the destructive removal. API/MCP cannot complete that verification.

Protected:
- `accounting-business-life`
- `accounting-preview`
- `accounting-v011-notifications-preview` (temporary VAPID anchor)

## Secrets and shared configuration

Prefer shared Railway variables for:
- DATABASE_URL
- TOKEN_SECRET
- APP_PIN

The preview should reference shared canonical variables, not another historical preview.

Provider secrets:
- PayMongo
- Resend
- OpenAI/Support AI
- VAPID

must never be committed to GitHub.

## PayMongo preview safety

`accounting-preview`:
- `PAYMENT_PROVIDER_DEFAULT=paymongo`
- `PAYMONGO_MODE=test`
- `PAYMONGO_LIVE_ENABLED=false`
- `PAYMONGO_PAYMENT_METHODS=card,gcash,paymaya,qrph`

Do not set live mode until controlled LIVE validation is explicitly approved.

## Deletion rule

Before deleting a Railway service, verify:
1. no protected service references its variables;
2. no volume is attached;
3. no custom domain is attached;
4. no unique external provider secret is stranded there;
5. canonical production and preview are healthy.

Historical branches remain preserved in GitHub even after their Railway preview services are removed.
