import { hashReferralCorrelation, unconvertedReferralPersistenceState } from './referral-unconverted-attribution.js';
import { isValidReferralCode, PUBLIC_PROFILE_ROLES } from './referral-domain.js';

function isTrue(value) {
  return String(value || '').toLowerCase() === 'true';
}

function boundedToken(value, name, max = 100) {
  const token = String(value ?? '').trim();
  if (!token || token.length > max || !/^[A-Za-z0-9._~:-]+$/.test(token)) {
    throw new TypeError(`Invalid converted referral property: ${name}`);
  }
  return token;
}

export const OWNER_APPROVED_CONVERTED_RETENTION_MONTHS = 12;

function retentionMonthsFromEnv(env = process.env) {
  const value = Number.parseInt(String(env.REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_MONTHS || ''), 10);
  return Number.isInteger(value) && value >= 1 && value <= 120 ? value : null;
}

export function convertedReferralBindingState(env = process.env) {
  const enabled = isTrue(env.REFERRAL_ATTRIBUTION_CONVERTED_ENABLED);
  const pendingState = unconvertedReferralPersistenceState(env);
  const retentionApproved = isTrue(env.REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_APPROVED);
  const lawfulBasisApproved = isTrue(env.REFERRAL_ATTRIBUTION_CONVERTED_LAWFUL_BASIS_APPROVED);
  const retentionMonths = retentionMonthsFromEnv(env);
  const retentionPolicyMatchesOwner = retentionMonths === OWNER_APPROVED_CONVERTED_RETENTION_MONTHS;
  const policyVersion = String(env.REFERRAL_ATTRIBUTION_CONVERTED_POLICY_VERSION || '').trim();
  const attributionModel = String(env.REFERRAL_ATTRIBUTION_CONVERTED_MODEL || '').trim();
  const hmacSecret = String(env.REFERRAL_ATTRIBUTION_HMAC_SECRET || '');
  const secretConfigured = hmacSecret.length >= 32;
  const policyConfigured = /^[A-Za-z0-9._:-]{1,80}$/.test(policyVersion);
  const modelSupported = attributionModel === 'registration_context_v1';

  let reason = 'ready';
  if (!enabled) reason = 'disabled';
  else if (!pendingState.persistable) reason = `pending_${pendingState.reason}`;
  else if (!retentionApproved) reason = 'retention_not_approved';
  else if (!lawfulBasisApproved) reason = 'lawful_basis_not_approved';
  else if (!retentionMonths) reason = 'retention_months_not_configured';
  else if (!retentionPolicyMatchesOwner) reason = 'retention_policy_mismatch';
  else if (!policyConfigured) reason = 'policy_version_not_configured';
  else if (!attributionModel) reason = 'attribution_model_not_configured';
  else if (!modelSupported) reason = 'attribution_model_not_supported';
  else if (!secretConfigured) reason = 'hmac_secret_not_configured';

  return Object.freeze({
    enabled,
    pendingReady: pendingState.persistable,
    pendingReason: pendingState.reason,
    retentionApproved,
    lawfulBasisApproved,
    retentionMonths,
    retentionPolicyMatchesOwner,
    policyVersion: policyConfigured ? policyVersion : '',
    attributionModel,
    modelSupported,
    secretConfigured,
    bindable:
      enabled &&
      pendingState.persistable &&
      retentionApproved &&
      lawfulBasisApproved &&
      retentionPolicyMatchesOwner &&
      policyConfigured &&
      modelSupported &&
      secretConfigured,
    reason
  });
}

export function normalizeReferralConversionContext(input = {}) {
  const referralCode = String(input.referral_code || '').trim();
  const sourceProfileRole = String(input.source_profile_role || '').trim();
  const correlationId = String(input.correlation_id || '').trim();

  if (!isValidReferralCode(referralCode)) {
    throw new TypeError('Invalid referral conversion code');
  }
  if (!PUBLIC_PROFILE_ROLES.includes(sourceProfileRole)) {
    throw new TypeError('Invalid referral conversion source profile role');
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(correlationId)) {
    throw new TypeError('Invalid referral conversion correlation id');
  }

  return Object.freeze({
    referralCode,
    sourceProfileRole,
    correlationId
  });
}

export async function ensureConvertedReferralSchema(pool) {
  if (!pool?.query) throw new TypeError('database pool is required');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_attributions (
      id BIGSERIAL PRIMARY KEY,
      referrer_account_id BIGINT NOT NULL REFERENCES accounts(id),
      referred_account_id BIGINT UNIQUE REFERENCES accounts(id),
      referral_code_snapshot TEXT NOT NULL,
      source_profile_role TEXT,
      campaign TEXT NOT NULL DEFAULT 'organic',
      source TEXT NOT NULL DEFAULT 'profile',
      medium TEXT NOT NULL DEFAULT 'referral',
      state TEXT NOT NULL DEFAULT 'created',
      rejection_reason TEXT,
      first_clicked_at TIMESTAMPTZ,
      signed_up_at TIMESTAMPTZ,
      qualified_at TIMESTAMPTZ,
      rewarded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_profile_role IS NULL OR source_profile_role IN ('customer','merchant','supplier','courier','service_provider')),
      CHECK (state IN ('created','clicked','signed_up','qualified','rewarded','rejected')),
      CHECK (referred_account_id IS NULL OR referred_account_id <> referrer_account_id)
    );
    ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS correlation_hash TEXT;
    ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_policy_version TEXT;
    ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_days INTEGER;
    ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_months INTEGER;
    ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_correlation_hash_unique
      ON referral_attributions(correlation_hash)
      WHERE correlation_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS referral_attributions_expiry_idx
      ON referral_attributions(expires_at)
      WHERE expires_at IS NOT NULL;
  `);
}

export async function purgeExpiredConvertedReferrals(pool) {
  if (!pool?.query) throw new TypeError('database pool is required');
  const result = await pool.query(
    `DELETE FROM referral_attributions
      WHERE expires_at IS NOT NULL
        AND expires_at <= NOW()
        AND state NOT IN ('rewarded')`
  );
  return Number(result?.rowCount || 0);
}

export async function bindReferralSignupConversion(pool, input = {}, options = {}) {
  const env = options.env || process.env;
  const state = convertedReferralBindingState(env);
  if (!state.bindable) {
    return Object.freeze({ bound: false, reason: state.reason });
  }
  if (!pool?.query) throw new TypeError('database pool is required');

  const referredAccountId = Number(input.referredAccountId);
  if (!Number.isInteger(referredAccountId) || referredAccountId < 1) {
    throw new TypeError('valid referredAccountId is required');
  }

  const context = normalizeReferralConversionContext(input.context);
  const correlationHash = hashReferralCorrelation({
    referralCode: context.referralCode,
    sourceProfileRole: context.sourceProfileRole,
    correlationId: context.correlationId,
    secret: env.REFERRAL_ATTRIBUTION_HMAC_SECRET
  });

  await ensureConvertedReferralSchema(pool);
  await purgeExpiredConvertedReferrals(pool);

  const pending = await pool.query(
    `SELECT id,referrer_account_id,referral_code_snapshot,source_profile_role,
            campaign,source,medium,expires_at
       FROM referral_pending_attributions
      WHERE correlation_hash=$1
        AND referral_code_snapshot=$2
        AND source_profile_role=$3
        AND expires_at > NOW()
      LIMIT 1`,
    [correlationHash, context.referralCode, context.sourceProfileRole]
  );
  if (!pending.rowCount) {
    return Object.freeze({ bound: false, reason: 'pending_attribution_not_found' });
  }

  const row = pending.rows[0];
  const referrerAccountId = Number(row.referrer_account_id);

  if (referrerAccountId === referredAccountId) {
    await pool.query('DELETE FROM referral_pending_attributions WHERE id=$1', [row.id]);
    return Object.freeze({
      bound: false,
      reason: 'self_referral',
      rejected: true
    });
  }

  const existing = await pool.query(
    `SELECT id,referrer_account_id,referred_account_id,referral_code_snapshot,
            source_profile_role,campaign,source,medium,state,
            retention_policy_version,retention_days,retention_months,expires_at
       FROM referral_attributions
      WHERE referred_account_id=$1
      LIMIT 1`,
    [referredAccountId]
  );

  if (existing.rowCount) {
    const prior = existing.rows[0];
    const sameAttribution =
      Number(prior.referrer_account_id) === referrerAccountId &&
      String(prior.referral_code_snapshot) === context.referralCode;

    await pool.query('DELETE FROM referral_pending_attributions WHERE id=$1', [row.id]);

    if (sameAttribution) {
      return Object.freeze({
        bound: true,
        reason: 'already_bound',
        idempotent: true,
        attributionId: Number(prior.id),
        referrerAccountId,
        referredAccountId,
        campaign: prior.campaign,
        source: prior.source,
        medium: prior.medium,
        sourceProfileRole: prior.source_profile_role
      });
    }

    return Object.freeze({
      bound: false,
      reason: 'referred_account_already_attributed',
      rejected: true
    });
  }

  let inserted;
  try {
    inserted = await pool.query(
      `INSERT INTO referral_attributions(
         referrer_account_id,referred_account_id,referral_code_snapshot,
         source_profile_role,campaign,source,medium,state,signed_up_at,
         correlation_hash,retention_policy_version,retention_months,expires_at
       ) VALUES(
         $1,$2,$3,$4,$5,$6,$7,'signed_up',NOW(),
         $8,$9,$10,NOW()+($10::int * INTERVAL '1 month')
       )
       RETURNING id,state,signed_up_at,expires_at`,
      [
        referrerAccountId,
        referredAccountId,
        context.referralCode,
        row.source_profile_role,
        boundedToken(row.campaign, 'campaign', 80),
        boundedToken(row.source || 'profile', 'source', 40),
        boundedToken(row.medium || 'referral', 'medium', 40),
        correlationHash,
        state.policyVersion,
        state.retentionMonths
      ]
    );
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const raced = await pool.query(
      `SELECT id,referrer_account_id,referral_code_snapshot,
              source_profile_role,campaign,source,medium,state
         FROM referral_attributions
        WHERE referred_account_id=$1 OR correlation_hash=$2
        ORDER BY id
        LIMIT 1`,
      [referredAccountId, correlationHash]
    );
    if (!raced.rowCount) throw error;
    const prior = raced.rows[0];
    const sameAttribution =
      Number(prior.referrer_account_id) === referrerAccountId &&
      String(prior.referral_code_snapshot) === context.referralCode;
    await pool.query('DELETE FROM referral_pending_attributions WHERE id=$1', [row.id]);
    return Object.freeze({
      bound: sameAttribution,
      reason: sameAttribution ? 'already_bound' : 'conversion_conflict',
      idempotent: sameAttribution,
      rejected: !sameAttribution,
      attributionId: Number(prior.id)
    });
  }

  await pool.query('DELETE FROM referral_pending_attributions WHERE id=$1', [row.id]);

  return Object.freeze({
    bound: true,
    reason: 'bound',
    idempotent: false,
    attributionId: Number(inserted.rows[0].id),
    referrerAccountId,
    referredAccountId,
    campaign: row.campaign,
    source: row.source,
    medium: row.medium,
    sourceProfileRole: row.source_profile_role,
    retentionMonths: state.retentionMonths,
    retentionPolicyVersion: state.policyVersion,
    expiresAt: inserted.rows[0].expires_at
  });
}
