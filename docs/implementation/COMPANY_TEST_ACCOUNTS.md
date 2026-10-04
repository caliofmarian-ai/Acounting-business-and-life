---
title: Company-managed test accounts
status: implemented
owner: Business & Life
updated: 2026-10-04
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

## Controlled operational provisioning

Supplier, Delivery and Local Services identities are provisioned only by the one-shot `operational_v1` deployment wave. The runtime stays unhealthy until provisioning and its own cookie-authenticated acceptance checks pass. The wave is accepted only on the named isolated Preview service or the named Production service, on an immutable commit, with an explicit `non_settling_private_v1` acknowledgement and a temporary dedicated secret.

The wave:

- creates or reconciles only the three exact operational aliases;
- rotates a separate password for every alias without logging or persisting the temporary derivation secret;
- marks the company-owned alias as the verified recovery route and revokes older sessions;
- enables exactly the assigned profile and keeps every profile private;
- assigns the same official Philippines barangay to Customer, Merchant, Supplier, Delivery and Local Services;
- gives Supplier a private accounting workspace;
- stores and malware-scans a private, non-personal Delivery vehicle attestation, verifies it, and keeps Delivery unavailable by default;
- creates an audited lifecycle fixture linking Customer, Merchant, Supplier, Delivery and Local Services with settlement hard-blocked;
- signs in through the normal secure browser-cookie route, opens the assigned workspace, proves a different role is denied, and logs out.

`CONTROLLED_ROLE_FIXTURE_SECRET`, `CONTROLLED_ROLE_FIXTURE_WAVE` and `CONTROLLED_ROLE_FIXTURE_ACK` are temporary deployment controls. They must be cleared without redeploying after the PASS result is captured. The passwords remain hashed in the account store; future ownership recovery uses the company-controlled Gmail aliases and the normal password-reset flow. No credential or reset token belongs in source code, deployment logs, an issue, or a pull request.

The lifecycle fixture never creates an order, payment intent, delivery, accounting transaction or settlement. A later E2E run may create disposable lifecycle records only after its own readiness gates pass, and must still stop before settlement.

## User experience

The application displays **Company Test Account** and the assigned role prominently. Account Settings replaces personal phone/address inputs with an explicit policy summary. Customer activation accepts a verified company test identity without a personal address and uses the optional company address only when configured.

This classification does not claim that Business & Life is already an incorporated legal entity. It records platform management of controlled test identities only.
