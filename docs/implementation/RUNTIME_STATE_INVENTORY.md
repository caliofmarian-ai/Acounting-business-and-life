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
