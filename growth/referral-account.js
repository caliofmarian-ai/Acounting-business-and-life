import crypto from 'node:crypto';
import {
  PUBLIC_PROFILE_ROLES,
  buildReferralUrl,
  buildSharePayload,
  isValidReferralCode
} from './referral-domain.js';

export async function ensureReferralAccountSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_accounts (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rotated_at TIMESTAMPTZ,
      CHECK (referral_code ~ '^r1_[A-Za-z0-9_-]{16}$')
    )
  `);
}

export function createOpaqueReferralCode() {
  const code = `r1_${crypto.randomBytes(12).toString('base64url')}`;
  if (!isValidReferralCode(code)) throw new Error('Generated referral code is invalid');
  return code;
}

export async function ensureAccountReferral(pool, accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id < 1) throw new TypeError('valid accountId is required');

  const existing = await pool.query(
    `SELECT referral_code,created_at,rotated_at FROM referral_accounts WHERE account_id=$1`,
    [id]
  );
  if (existing.rowCount) return existing.rows[0];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createOpaqueReferralCode();
    try {
      const inserted = await pool.query(
        `INSERT INTO referral_accounts(account_id,referral_code)
         VALUES($1,$2)
         ON CONFLICT(account_id) DO NOTHING
         RETURNING referral_code,created_at,rotated_at`,
        [id, code]
      );
      if (inserted.rowCount) return inserted.rows[0];

      const raced = await pool.query(
        `SELECT referral_code,created_at,rotated_at FROM referral_accounts WHERE account_id=$1`,
        [id]
      );
      if (raced.rowCount) return raced.rows[0];
    } catch (err) {
      if (err?.code !== '23505') throw err;
    }
  }
  throw new Error('Could not allocate a referral code');
}

export function normalizeReferralProfileRole(role, fallback = 'customer') {
  const value = String(role || fallback || '').trim();
  if (!PUBLIC_PROFILE_ROLES.includes(value)) throw new TypeError('unknown public profile role');
  return value;
}

export function buildLiveReferralPayload({
  code,
  origin,
  profileRole,
  inviterDisplayName = ''
}) {
  if (!isValidReferralCode(code)) throw new TypeError('invalid referral code');
  const role = normalizeReferralProfileRole(profileRole);
  const url = buildReferralUrl({
    origin,
    code,
    profileRole: role,
    campaign: `${role}_referral_v1`,
    source: 'profile',
    medium: 'referral'
  });
  return Object.freeze({
    code,
    profileRole: role,
    referralUrl: url,
    share: buildSharePayload({
      url,
      inviterDisplayName,
      appName: 'Business & Life'
    }),
    grantsProfiles: false,
    grantsPermissions: false
  });
}
