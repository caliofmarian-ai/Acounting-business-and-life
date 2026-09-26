# Preview PH Test Context V1

## Purpose

`preview.caliof.com` is the isolated internal QA surface for Business & Life. It must allow the Owner to test the Philippines edition from outside the Philippines without changing public production rules.

The QA surface does not globally disable location controls. Standard IP/GPS/location policy remains applicable to ordinary accounts. A remote Philippines exception may be granted only to one explicitly designated QA test account.

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

The preview auth surface visibly states that standard location controls remain active.

Remote testing from Ireland uses a separate preview-only control:

- `QA_REMOTE_TEST_EMAIL` designates exactly one personal QA account;
- the account must explicitly request the remote QA override;
- the server rejects the request for every other email;
- the account still selects an official PH barangay from PSGC;
- `/api/me` identifies whether the authenticated account has the designated QA remote-test capability.

Without `QA_REMOTE_TEST_EMAIL`, no account receives this exception.

## Data isolation

No production data is copied into QA. The QA database remains separate from public `accounting`.

## Branch synchronization

Railway's existing `accounting-preview` service follows branch `delivery-routing-v2c`. The branch is now maintained as a synchronized preview pointer to the canonical `main` revision. Historical preview-specific commits were archived before the pointer was moved.


## Location-policy boundary

`QA_PH_TEST_CONTEXT` bootstraps reference geography and pilot territory data only. It is **not** a global IP/GPS bypass.

`QA_REMOTE_TEST_EMAIL` is the only infrastructure switch that designates the remote test identity. Production rejects this variable, and preview never exposes the configured email publicly.
