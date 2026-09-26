# Preview PH Test Context V1

## Purpose

`preview.caliof.com` is the isolated internal QA surface for Business & Life. It must allow the Owner to test the Philippines edition from outside the Philippines without changing public production rules.

Physical/IP location is not the authority for QA territory membership. The tester explicitly chooses an official PSGC barangay.

## Runtime boundary

The QA Philippines test context can run only when all of the following are true:

- Railway service = `accounting-preview`;
- `APP_ENV=qa`;
- database name ends in `_qa` or `_test`;
- `QA_PH_TEST_CONTEXT=true`;
- PayMongo remains TEST;
- live payments remain disabled.

`accounting-business-life` fails startup validation if `QA_PH_TEST_CONTEXT` is enabled.

## QA data bootstrap

When enabled, startup ensures the QA database contains the pinned PH PSGC registry and the current pilot hierarchy:

- Region IV-A (CALABARZON) — `planned`;
- Cavite — `planned`;
- City of Bacoor — `planned`;
- Queens Row West — `onboarding`.

The bootstrap uses official PSGC identities. It never creates or activates user profiles and never grants Admin authority.

## Remote testing

The preview auth surface visibly states:

- testing country = Philippines;
- the tester's physical device location is not used as the Business & Life test territory;
- the tester must choose an official PH barangay from PSGC.

This makes it valid to test a Queens Row West account while physically in Ireland.

## Data isolation

No production data is copied into QA. The QA database remains separate from public `accounting`.

## Branch synchronization

Railway's existing `accounting-preview` service follows branch `delivery-routing-v2c`. The branch is now maintained as a synchronized preview pointer to the canonical `main` revision. Historical preview-specific commits were archived before the pointer was moved.
