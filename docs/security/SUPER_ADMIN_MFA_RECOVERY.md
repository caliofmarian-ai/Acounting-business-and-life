# Super Admin MFA — enrollment and recovery

Status: P0 security control for issue #760.

## Security boundary

Super Admin keeps normal account sign-in, but privileged Admin APIs fail closed until a second factor has been verified for the current session.

Protected Admin surfaces include:

- `/api/admin/**`
- `/api/governance/admin/**`
- `/api/legal/admin/**`
- `/api/payments/admin/**`
- `/api/accounting/admin/**`

Read-only Admin access requires MFA on the current session. Mutating Admin requests require a fresh MFA verification within the same short step-up window used for other sensitive actions.

## Factor

The factor is RFC-compatible TOTP:

- SHA-1 HMAC as required by mainstream authenticator apps;
- 6 digits;
- 30-second period;
- one-step clock tolerance;
- last accepted counter persisted to prevent replay of the same TOTP.

The raw TOTP secret is never stored. It is encrypted with AES-256-GCM. The key is derived with domain separation from `SUPER_ADMIN_MFA_ENCRYPTION_KEY`; when that variable is absent, the existing `TOKEN_SECRET` is used as key material so the control can deploy without a second secret rollout. The production key material must remain stable.

Enrollment exposes the secret only through a no-store QR response. It is not returned in JSON, written to logs or stored in plaintext.

## Recovery codes

Enrollment generates ten single-use recovery codes. They are returned once after successful TOTP confirmation and must be saved offline.

Only keyed hashes are stored. Using a recovery code:

1. consumes it atomically;
2. marks the current session MFA-verified;
3. emits an auth security event;
4. allows the operator to open **Account protection → Reset authenticator**;
5. requires a fresh MFA session before reset;
6. invalidates the old factor and all remaining recovery codes when the reset begins.

A new QR enrollment and a new recovery-code set are then required.

## Rate limits and audit

MFA enrollment, challenge and reset use database-backed rate-limit windows, not process memory. This keeps the lock effective after restarts and across multiple instances.

Security events record enrollment start/success/failure, challenge success/failure, rate limiting, Admin blocking and reset start. Events contain account/session metadata and method only; they do not contain TOTP secrets, OTP values or recovery codes.

## Lost-factor runbook

1. Sign in with the normal account credential.
2. Open Admin.
3. Choose **Recovery code** in the MFA dialog.
4. Enter one unused recovery code.
5. Open **Account Settings → Security & access → Account protection**.
6. Select **Reset authenticator**.
7. Scan the new QR code with the replacement authenticator.
8. Enter the new 6-digit code.
9. Save the newly generated recovery codes offline.
10. Confirm Admin opens and a mutating Admin action requires a fresh MFA verification after the sensitive-action window expires.

If no authenticator and no unused recovery code remain, do not bypass the control or edit the MFA database manually. Recovery requires an explicit owner-controlled security procedure with auditable identity verification before any factor reset.

## Production verification

For release evidence:

- verify the Super Admin account cannot load protected Admin APIs before enrollment;
- enroll on Android from the Security/Admin MFA dialog;
- verify QR/TOTP activation;
- verify the same TOTP cannot be replayed;
- verify a recovery code works once and fails on reuse;
- reset the authenticator through Account protection;
- verify a normal Customer/Merchant/Supplier/Courier/Local Services session does not receive an MFA requirement;
- verify protected Admin reads require MFA and protected Admin mutations require fresh MFA;
- attach Production evidence to #758 and #760.
