# Contextual Public Help / Error Linking

Status: **DESIGN CONTRACT**

This document defines how Business & Life application surfaces should link users to the exact public Help Center article for a problem.

## Why stable help codes exist

User-facing copy can improve over time and may be translated. A permanent help link must therefore not depend on matching a changing English sentence.

Use a stable identifier:

```text
ERR-<DOMAIN>-<NNN>
```

Initial domain prefixes:

- `AUTH` — authentication/account security
- `GOV` — invitations/profile governance
- `ACC` — business accounting/workspace access
- `ORD` — Customer/Merchant order workflow
- `DEL` — Delivery/Courier
- `SUP` — Supplier/procurement
- `SVC` — Local Services
- `INC` — private incident/evidence

## Public route

```text
/help/error/:code
```

The Help Center resolves the code to a stable article slug.

Examples reserved by the first content catalog:

| Help code | Article |
| --- | --- |
| `ERR-AUTH-001` | `sign-in-recovery` |
| `ERR-GOV-001` | `profile-approval-required` |
| `ERR-ACC-009` | `business-workspace-unavailable` |
| `ERR-ORD-003` | `cash-pickup-presence` |
| `ERR-DEL-004` | `delivery-quote-expired` |
| `ERR-DEL-006` | `courier-approval-required` |
| `ERR-SUP-002` | `trusted-supplier-relationship` |
| `ERR-SVC-002` | `service-provider-approval` |
| `ERR-INC-001` | `incident-evidence-limits` |

These are **reserved documentation identifiers** until application surfaces begin emitting/linking them.

## UI behavior

Preferred error presentation:

```text
Delivery quote is missing or expired.

[Get a new quote]   [Learn more]
                    -> /help/error/ERR-DEL-004
```

Rules:

1. The primary action should fix the problem when a safe recovery action exists.
2. **Learn more** explains the reason, prerequisites and next steps.
3. Do not replace the useful error message with only a code.
4. Do not expose stack traces, database details, secrets or internal route names.
5. Do not send private IDs or tokens in the public Help Center URL.
6. If an incident/support path is appropriate, the article may direct the user there after self-service steps.

## Translation

Help codes and article slugs remain language-neutral/stable.

Localized UI may render:

```text
/fil-PH/help/error/ERR-DEL-004
```

or another locale-routing strategy later, but the canonical code must still resolve to the same conceptual article.

## Implementation follow-up

After the Help Center is live, integrate contextual links domain by domain:

1. Auth
2. Profile governance
3. Accounting/workspace
4. Orders/Marketplace
5. Delivery
6. Supplier procurement
7. Local Services
8. Incidents

Each domain integration should include executable tests proving the public help target exists.
