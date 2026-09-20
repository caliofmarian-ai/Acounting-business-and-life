---
title: Company-managed test accounts
status: implemented
owner: Business & Life
updated: 2026-09-20
---

# Company-managed test accounts

## Decision

The controlled `dropi.deliveries+test…@gmail.com` identities are operational test accounts managed by Business & Life. They do not represent natural persons and must not be filled with invented personal data.

They still require their own password and verified email. Authentication, session revocation and authorization boundaries remain unchanged.

## Contact-data policy

- Personal phone: **not required**.
- Personal/home address: **not required**.
- Managed by: **Business & Life**.
- Contact source: the configured company contact, when one exists.
- If a real test scenario genuinely needs a delivery or service location, that scenario must provide it explicitly. The system must not invent one.

Optional company contact values are configured outside source code:

- `BUSINESS_LIFE_COMPANY_PHONE`
- `BUSINESS_LIFE_COMPANY_ADDRESS`

Leaving either value unset is valid. The interface then states that no company contact is configured instead of presenting fake data.

## Controlled role aliases

| Alias suffix | Assigned test role |
|---|---|
| `+testcustomer` | Customer |
| `+testmerchant` | Merchant |
| `+testsupplier` | Supplier |
| `+testcourier` | Delivery |
| `+testservice` | Local Services |
| `+testcountryadmin` | Country Admin |
| `+testterritoryadmin` | Territory Admin |
| `+testspecialist` | Specialist Admin |
| `+testsuperadmin` | Super Admin |

Only the exact controlled aliases are classified automatically. An arbitrary email containing the word `test` receives no special access.

Operational test accounts are restricted to their assigned profile role. Admin test identities do not gain a personal operational profile; Admin authority remains a separate audited assignment.

## User experience

The application displays **Company Test Account** and the assigned role prominently. Account Settings replaces personal phone/address inputs with an explicit policy summary. Customer activation accepts a verified company test identity without a personal address and uses the optional company address only when configured.

This classification does not claim that Business & Life is already an incorporated legal entity. It records platform management of controlled test identities only.
