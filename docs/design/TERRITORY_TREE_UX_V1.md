# Territory Tree UX V1

## Design source

Approved Figma:
https://www.figma.com/design/vZpM2Fzaxc2Q7cWURivizw

Target nodes:
- Mobile: `2:2`
- Desktop: `2:88`

## Product rule

Business & Life operating territories are displayed as an explicit parent-child tree using the existing `territories.parent_id` relationship.

The tree is operational state, not the full PSGC reference registry.

Example PH pilot hierarchy:

- Region IV-A (CALABARZON) — planned
  - Cavite — planned
    - City of Bacoor — planned
      - launch barangay — onboarding

Barangays or other descendants appear only when they are explicitly opened as Business & Life operating territories. For the initial PH pilot, structural levels remain `planned`; only the actual launch barangay moves to `onboarding`. The national PSGC registry remains searchable separately and is loaded on demand.

## UI behavior

Each tree node shows:

- expand/collapse control when opened children exist;
- official name;
- territory type;
- PSGC code or legacy/custom code;
- lifecycle status;
- Browse children action;
- Manage action.

Lifecycle editing is moved out of every row and into a dedicated Territory Details panel.

Desktop:
- tree in the main column;
- sticky 360 px details panel.

Mobile:
- one-column tree;
- bounded branch indentation;
- details panel below the selected node flow.

## Safety and compatibility

- no territory data is recreated;
- no destructive migration is required;
- existing `parent_id`, `psgc_code`, lifecycle status and audit history remain authoritative;
- opening a child still uses the PSGC registry and server-side nearest-opened-ancestor resolution;
- scoped Admin views never silently hide a visible territory whose parent is outside the current scope: it appears under `SCOPED / UNLINKED ROOTS`;
- status changes continue through the audited Territory Status Control V1 endpoint.

## Lazy geography

The operating tree never materializes all PSGC geography.

`Browse children` and `Open child territory` query the existing PSGC search endpoint for only the requested parent's official children. This keeps the Admin experience usable on Android and avoids loading the national barangay inventory into the operating tree.
