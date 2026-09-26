# Territory Status Control V1

## Purpose

Business & Life operating territories have an explicit lifecycle independent from their official PSGC identity.

Changing a territory status never changes:

- country code;
- PSGC code;
- official name;
- geographic type;
- source/version provenance;
- parent geography;
- historical orders, applications, authorizations or audit records.

## Statuses

- `planned` — structural/known territory, not accepting onboarding;
- `onboarding` — accepting governed profile onboarding/invitations;
- `active` — operational territory accepting onboarding and live operation;
- `paused` — temporarily not accepting new onboarding;
- `suspended` — administratively suspended; reason required;
- `closed` — closed lifecycle state; reason required.

Only `onboarding` and `active` appear in governed profile onboarding and invitation selectors.

## Admin control

Admin → Territories exposes an Operating status selector for each opened territory.

The write route is:

`PATCH /api/governance/admin/territories/:id/status`

It requires the scoped `territory.manage` permission for that territory.

Every actual status change records a `territory_status_changed` governance audit event with:

- territory id;
- official name;
- PSGC code when available;
- before status;
- after status;
- operator reason/note.

## Safety rules

- status changes do not cascade to child territories;
- a structural parent may remain `planned` while a child is `onboarding` or `active`;
- `closed` is rejected while a non-closed direct child territory exists;
- existing invitations cannot be accepted after their territory leaves `onboarding`/`active`;
- existing applications/authorizations are not silently deleted or rewritten.

## Initial PH pilot hierarchy

The intended first hierarchy is:

- Region IV-A (CALABARZON) — `planned`;
- Cavite — `planned`;
- City of Bacoor — `planned`;
- the actual launch barangay — `onboarding`.

This keeps the official administrative hierarchy visible while limiting onboarding to the smallest real launch scope.
