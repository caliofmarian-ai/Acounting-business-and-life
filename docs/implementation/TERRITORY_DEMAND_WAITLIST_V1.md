# Territory Demand & Waitlist V1

## Canonical product rule

A Business & Life person account may be created in any official Philippine barangay represented in the current PSGC registry.

Business & Life operating-territory lifecycle controls only:

- operational profile onboarding;
- service availability;
- governed role invitations/authorizations.

It does **not** control whether a person is allowed to create an account.

## Registration geography

The barangay picker searches the full PSGC registry only after the person types.

It does not preload all barangays and does not show onboarding territories merely because the field received focus.

Search characteristics:

- minimum two meaningful characters/tokens;
- punctuation/whitespace tolerant;
- official barangay name, hierarchy path and PSGC code;
- maximum 15 results;
- exact name matches rank first;
- current operating status may be shown after/with the result, but does not filter out unopened geography.

Free text is never stored as canonical geography. The hidden PSGC code is set only after selecting an official result.

## Availability after selection

After the official barangay is selected, the application resolves the current Business & Life status:

- active;
- onboarding;
- planned;
- paused;
- suspended/restricted;
- closed;
- not opened.

A person in any of these states may complete account registration.

Only an exact barangay in `onboarding` or `active` can start operational profile onboarding.

## Expansion demand

Current geographic demand is derived from `account_geography_assignments`.

This means one current account contributes one current presence signal to its assigned barangay.

Demand rolls up through the official PSGC ancestry:

Barangay → City/Municipality → Province → Region.

Admin aggregate metrics include:

- distinct registered accounts;
- current assigned accounts updated in the last 7 days;
- current assigned accounts updated in the last 30 days;
- distinct accounts that expressed profile interest;
- role-interest breakdown.

No private address or per-user membership list is exposed in Territory Demand.

## Profile-interest signals

When a person tries to start an operational profile while the assigned barangay is unavailable, Business & Life records a deduplicated interest signal.

Roles:

- Customer;
- Merchant;
- Supplier;
- Delivery;
- Local Services.

The key is:

`account + country + barangay PSGC + role`.

Repeated attempts increment `attempt_count` and update `last_seen_at` rather than creating duplicate people in demand totals.

The onboarding attempt remains blocked until the exact barangay becomes `onboarding` or `active`.

## Admin decision support

Admin → Territories contains **Territory Demand**.

Demand is informative only.

V1 never:

- automatically opens a territory;
- changes a territory lifecycle status;
- grants an Admin assignment;
- activates a user profile.

Operational capacity, support, legal readiness and local operator coverage remain human/Admin decisions.

## Waitlist behavior

There is no separate duplicate user waitlist table.

The assigned barangay is already the authoritative waiting-area relationship.

When that area becomes available, accounts in the PSGC scope receive an operational notification.

For `onboarding` / `active`, the notification contains the action:

`manage_profiles`

which opens:

`Account Settings → Manage profiles`.

No marketing email is sent by default.

## Privacy

Demand analytics contain aggregate counts only.

Private street addresses remain in personal account data and never enter the territory-demand dashboard.

## PH pilot example

A person may register in an unopened barangay anywhere in the Philippines.

If that barangay is not operational:

1. account is created;
2. official PSGC geography is saved;
3. Business & Life explains the current area status;
4. operational onboarding remains unavailable;
5. the account contributes to expansion demand;
6. any attempted profile start contributes role-interest demand;
7. when the barangay later opens, the person is notified.
