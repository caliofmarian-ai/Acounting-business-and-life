# Account Geographic Assignment V1

## Purpose

Every personal Business & Life account in the Philippines edition is linked to one official PSGC barangay.

This is **account geography**, not an automatic operating authorization.

The model separates:

1. private street/home address — personal contact data;
2. official barangay membership — PSGC reference geography;
3. Business & Life operating territory — platform lifecycle state.

A person's private street address is never copied into the Admin territory catalogue.

## Canonical account geography

The table `account_geography_assignments` stores:

- account id;
- country code;
- official 10-digit PSGC barangay code;
- PSGC source version;
- official barangay name;
- official hierarchy path;
- assignment source;
- timestamps.

Only a PSGC record whose geographic level is `barangay` can be assigned.

Changes are recorded in `account_geography_events` with previous and new PSGC codes. Street addresses are not included in these events.

## Registration

### Email registration

A personal email/password registration must select an official Philippine barangay from the PSGC registry.

The server validates the submitted PSGC code. Client-entered names do not establish geography.

Account creation does **not** automatically activate Customer, Merchant, Supplier, Delivery or Local Services.

### Google registration

Google authentication may create the person account before a barangay is known because Google does not supply authoritative PSGC geography.

The account remains valid, but Account Settings presents a required area-completion gate. Operational profile onboarding or activation cannot proceed until the person selects an official barangay.

## Availability resolution

The account snapshot returned by `/api/me` includes a `geography` object.

It reports:

- assigned barangay;
- PSGC code and hierarchy;
- exact Business & Life territory, when the barangay has been opened;
- nearest opened ancestor scope when the barangay itself is not opened;
- whether operational onboarding is currently available;
- a user-facing availability message.

Operational onboarding is available only when the **exact assigned barangay** has an operating territory in `onboarding` or `active`.

A planned Region, Province or City does not make all descendant barangays operational.

## Status communication

User-facing copy distinguishes:

- `active` — Business & Life is active in the barangay;
- `onboarding` — the barangay is open for onboarding;
- `planned` — planned but not open yet;
- `paused` — temporarily paused;
- `suspended` — currently restricted;
- `closed` — currently closed;
- no exact operating territory — not opened yet, with nearest opened parent context when available.

The Notification system uses:

- `territory.area_available`;
- `territory.area_status`.

A geography notice is created when a person selects/changes their barangay. When an operating territory is opened or its status changes, affected accounts in that PSGC scope and descendant barangays are notified in-app; push follows account notification settings when applicable.

Notification delivery failure never rolls back account creation or geography assignment.

## Profile onboarding

Personal accounts do not choose arbitrary operating territories.

Merchant, Supplier, Delivery and Local Services onboarding resolve the account's assigned barangay server-side. Submitted `territory_id` values cannot move a personal account into a different operating area.

Invitations must match the recipient's assigned open barangay before acceptance.

Company-managed test accounts preserve a QA compatibility fallback when no PSGC area has been assigned. If a test account is explicitly assigned a barangay, the assigned geography takes precedence.

Customer activation also requires completed account geography for personal accounts.

## Privacy and safety

V1 deliberately does not:

- infer home geography from IP;
- publish private street addresses;
- expose private address data in the Territory Tree;
- auto-open a territory because a person registers there;
- auto-activate a profile from geography alone;
- allow a user to self-select an unrelated operating territory.

## PH pilot

The intended hierarchy remains:

- Region IV-A (CALABARZON) — planned;
- Cavite — planned;
- City of Bacoor — planned;
- actual launch barangay — onboarding.

Only members assigned to an exact `onboarding` or `active` barangay can start operational onboarding there.
