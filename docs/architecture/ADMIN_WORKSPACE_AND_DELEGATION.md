# Admin Workspace and Delegated Function Architecture

Status: IMPLEMENTATION AUTHORIZED — Issue #108  
Country edition: Philippines (`PH`)  
Source of truth: GitHub `main` after merge.

## 1. Product decision

Administration is a privileged workspace/persona, not a normal marketplace profile.

A human account may still have Customer, Merchant, Supplier, Courier or Service Provider profiles. Separately, the same account may receive an active Admin assignment. Only an account with such an assignment can use the Admin workspace.

The dedicated route is `/admin`.

## 2. Rank and function are separate

Rank controls how far authority may be delegated:

`super_admin > country_admin > territory_admin > specialist`

Function controls what work the person may actually perform.

The protected bootstrap Super Admin is the Platform Owner and receives all canonical Admin permissions. Lower ranks have no implicit permission set beyond grants recorded for their assignment.

## 3. Initial delegated functions

- Support Operations
- Profile Onboarding
- Trust & Safety
- Compliance & Credentials
- Finance & Accounting
- Payments & Settlements
- Legal & Governance
- Audit & Analytics
- Territory Operations
- Admin Delegation

Each function expands to a version-controlled bundle of existing permission codes. Authorization continues to be enforced by individual permissions, so changing a job title or dashboard grouping does not bypass backend security.

## 4. Delegation rules

1. A delegator cannot grant a permission they do not possess.
2. A delegator cannot create a rank equal to or above their own rank.
3. No normal workflow can create or revoke the protected `super_admin`.
4. A Country Admin may create Territory Admins and Specialists only inside owned country authority.
5. A Territory Admin may create Specialists only inside owned territory/subterritory scope.
6. A Specialist receives explicit functions/permissions only and cannot self-expand authority.
7. Every assignment, permission/function change, suspension and revocation is auditable.

## 5. Scope

- Super Admin: platform authority; current Philippines runtime resolves all PH permissions.
- Country Admin: country scope.
- Territory Admin: one assigned operating territory plus descendants.
- Specialist: country scope when `territory_id` is null, otherwise one territory plus descendants.

Country-wide Specialist creation therefore requires country-level delegation authority.

## 6. UI behavior

The Admin workspace is distinct from the public profile switcher.

The workspace navigation is generated from effective permissions. A user never receives empty/disabled privileged modules merely because the code exists.

Super Admin sees every Admin module. A Specialist delegated only Support Operations sees the Support/overview surfaces required for that work, not finance, legal, payment or delegation tools.

## 7. Concurrency boundary

PR #107 owns the current mobile Admin launcher fixes and modifies `public/admin-operations-ui.js`.

Issue #108 deliberately creates new `public/admin-console.*` assets and does not edit that UI file in the first slice. After #107 stabilizes, the existing Admin entry point can redirect to `/admin` without duplicating Admin logic.

## 8. Future evolution

The function catalogue can later add dedicated internal roles such as Fraud Analyst, Credential Reviewer, Finance Reconciliation Specialist, Support Lead or Legal Operations without inventing new public profiles. New functions should map to existing or explicitly reviewed permission codes and preserve least privilege.
