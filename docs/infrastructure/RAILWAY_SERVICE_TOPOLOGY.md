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
   - internal QA configuration, never a second Owner/customer application;
   - `APP_ENV=qa`;
   - service-specific `DATABASE_URL` targeting a dedicated `*_qa` or `*_test` database;
   - service-specific `TOKEN_SECRET` so public sessions cannot cross into QA;
   - PayMongo must default to TEST mode;
   - PayMongo LIVE must remain disabled;
   - preview verification links may be enabled.

3. Temporary infrastructure-only service is allowed only when there is a real separate runtime responsibility or secret-migration constraint.

Current temporary exception:
- `accounting-v011-notifications-preview`
  - retained only as the source of the existing VAPID keypair/subject;
  - must be removed after VAPID values are migrated or rotated safely.

## Deployment workflow

For each feature:

`feature branch → accounting-preview → assistant QA → merge to main → accounting-business-life redeploy → assistant production verification`

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

Shared Railway variables may be used only for values that do not break environment isolation.
`accounting-preview` must never reference the production `DATABASE_URL` or production
`TOKEN_SECRET`. Its database and token-signing secret are service-specific. Provider secrets remain
service-specific unless their provider contract explicitly supports safe environment sharing.

The runtime checks this boundary before any gateway starts. A QA service pointing at the production
database, using live PayMongo mode or enabling live payments must fail closed. The public service
must likewise reject a QA database or preview-only verification links.

Provider secrets:
- PayMongo
- Resend
- OpenAI/Support AI
- VAPID

must never be committed to GitHub.

## PayMongo preview safety

`accounting-preview`:
- `APP_ENV=qa`
- `DATABASE_URL=<service-specific isolated QA database>`
- `TOKEN_SECRET=<service-specific QA secret>`
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
