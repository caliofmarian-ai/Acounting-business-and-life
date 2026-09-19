---
document_id: BL-00-INVENTORY-004
title: Runtime State Inventory for Reconciliation
document_type: implementation_inventory
status: ACTIVE_MIGRATION_RECORD
access_class: INTERNAL
owner_role: Product Owner
version: 1.0
last_updated: 2026-09-19
---

# Runtime State Inventory for Reconciliation

This inventory records conflicting runtime state discovered before the canonical AppShell migration. An item is removed only after its consumers and rollback implications are verified.

| State/source | Current purpose | Conflict/risk | Reconciliation disposition |
| --- | --- | --- | --- |
| `accounts.active_role` | Last/current backend profile role | Was treated as the visible surface and forced Merchant UI over Account Home | Retain temporarily as profile preference; never use as the launch surface |
| `profileChosenThisSession` | Client-only distinction between Account and Profile | Boolean cannot represent Account/Profile/Admin/Guest and is lost on reload | Replaced by explicit client `activeSurface` in the first bootstrap slice |
| `abl_active_role` | Legacy local-storage role | Stale client value mounted Merchant tools before authorization/bootstrap completed | Removed from authentication and navigation decisions; old browser values are ignored |
| `BusinessLifeProfileState.activeRole` | Shared client profile context | Previously published Merchant even when Account Home was visible | Now null outside the Profile surface and accompanied by `surface` |
| `/api/me` | Person/profile snapshot | Required a second `/api/admin/me` request, causing late Admin appearance | Shell now consumes `/api/session/bootstrap` from the authorization gateway |
| `/api/admin/me` | Active Admin assignments | Loaded asynchronously after Account UI | Retained for explicit refresh; initial render uses the combined bootstrap |
| `server-unified.js` defaults | Alternative legacy entry point | Creates/defaults Merchant and blocks disabling it | Not a production entry point; quarantine and retirement handled in a later phase |
| Merchant mobile toolbar loader | Mobile shortcut injection | Mounted from a role alone, regardless of visible surface | Requires both `surface=profile` and `role=merchant` |

## Canonical state introduced in this slice

```text
surface = account | profile | admin | guest
activeRole = null outside profile surface
initial_surface = account
selected_profile_id = null on ordinary launch
```

Server bootstrap is authoritative for available profile and Admin destinations. The browser may select a destination for navigation, but it cannot create an entitlement.

## Slice 2 update

Profile feature decorators now require `surface=profile` before consuming `activeRole`. They no longer infer the visible workspace from `snapshot.account.active_role` and no longer perform private `/api/me` fallback requests. Account Home therefore remains isolated even when an older backend preference still names Merchant.

## Slice 3 update

The avatar drawer is now a destination switcher only: account identity, active profiles, assigned Admin access and one Account Settings entry. Account Settings is a dedicated workspace with focused Personal details, Security & access and Manage profiles routes. Password, verification and session controls mount only in the Security route and reuse the canonical bootstrap identity. Operational preferences remain inside the dedicated Profile Settings card of each active profile.

## Slice 4 update

Merchant is no longer treated as an undeletable bootstrap identity by any profile endpoint. Voluntary deactivation preserves the derived Profile ID and history, chooses another enabled profile preference or `null`, and never falls back to Merchant. Governed profiles with an unexpired active authorization can be reactivated without repeating onboarding. Account Settings presents exactly one lifecycle action for each state: Start onboarding, Continue onboarding, Disable or Reactivate.

## Slice 5 update

Shared external Money & Banking configuration now belongs to Account Settings rather than being rendered inside every Profile Settings screen. Account financial identity, tokenized payment methods and payout destinations use one dedicated account route. Profile Settings retains only the selected profile context, operational tools, planning/transfer functions and a clear link to the shared account banking route. Back navigation returns to the surface that opened Money & Banking.

## Slice 6 update

Profile Settings now opens as a route-owned center for the currently selected Profile surface. It cannot be opened for a different role or used as an implicit profile switcher. Each center shows the immutable derived Profile ID and provides explicit destinations for profile identity, profile-scoped money preferences, statements/documents, promotion tools and lifecycle status. Account Money & Banking remains a separate linked destination, while profile activation and deactivation remain in Account Settings. Back navigation restores the same active profile workspace.
