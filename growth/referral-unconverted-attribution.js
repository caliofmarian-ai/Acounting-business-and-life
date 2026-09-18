import crypto from 'node:crypto';

export const UNCONVERTED_REFERRAL_RETENTION_DAYS = 90;

const PERSISTABLE_EVENTS = new Set([
  'referral_landing_viewed',
  'referral_signup_started'
]);
const PROFILE_ROLES = new Set([
  'customer',
  'merchant',
  'supplier',
  'courier',
  'service_provider'
]);

function isTrue(value) {
  return String(value || '').toLowerCase() === 'true';
}

function boundedToken(value, name, max = 100) {
  const token = String(value ?? '').trim();
  if (!token || token.length > max || !/^[A-Za-z0-9._~:-]+$/.test(token)) {
    throw new TypeError(`Invalid unconverted referral property: ${name}`);
  }
  return token;
}

export function unconvertedReferralPersistenceState(env = process.env) {
  const enabled = isTrue(env.REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED);
  const retentionApproved = isTrue(env.REFERRAL_ANALYTICS_RETENTION_APPROVED);
  const lawfulBasisApproved = isTrue(env.REFERRAL_ANALYTICS_LAWFUL_BASIS_APPROVED);
  const hmacSecret = String(env.REFERRAL_ATTRIBUTION_HMAC_SECRET || '');
  const secretConfigured = hmacSecret.length >= 32;

  let reason = 'ready';
  if (!enabled) reason = 'disabled';
  else if (!retentionApproved) reason = 'retention_not_approved';
  else if (!lawfulBasisApproved) reason = 'lawful_basis_not_approved';
  else if (!secretConfigured) reason = 'hmac_secret_not_configured';

  return Object.freeze({
    enabled,
    retentionApproved,
    lawfulBasisApproved,
    secretConfigured,
    persistable: enabled && retentionApproved && lawfulBasisApproved && secretConfigured,
    reason
  });
}

export function hashReferralCorrelation({ referralCode, sourceProfileRole, correlationId, secret }) {
  const code = boundedToken(referralCode, 'referral_code', 40);
  const role = boundedToken(sourceProfileRole, 'source_profile_role', 40);
  if (!PROFILE_ROLES.has(role)) throw new TypeError('Invalid unconverted referral source profile role');
  const correlation = boundedToken(correlationId, 'correlation_id', 80);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(correlation)) {
    throw new TypeError('Invalid unconverted referral correlation id');
  }
  const key = String(secret || '');
  if (key.length < 32) throw new TypeError('Referral attribution HMAC secret must be at least 32 characters');
  return crypto.createHmac('sha256', key)
    .update(`${code}:${role}:${correlation}`)
    .digest('hex');
}

export async function ensureUnconvertedReferralSchema(pool) {
  if (!pool?.query) throw new TypeError('database pool is required');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_pending_attributions (
      id BIGSERIAL PRIMARY KEY,
      referrer_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      referral_code_snapshot TEXT NOT NULL,
      correlation_hash TEXT NOT NULL UNIQUE,
      source_profile_role TEXT NOT NULL,
      campaign TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'profile',
      medium TEXT NOT NULL DEFAULT 'referral',
      first_landing_at TIMESTAMPTZ,
      signup_started_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_profile_role IN ('customer','merchant','supplier','courier','service_provider'))
    );
    CREATE INDEX IF NOT EXISTS referral_pending_attributions_expiry_idx
      ON referral_pending_attributions(expires_at);
    CREATE INDEX IF NOT EXISTS referral_pending_attributions_referrer_idx
      ON referral_pending_attributions(referrer_account_id, created_at DESC);
  `);
}

export async function purgeExpiredUnconvertedReferrals(pool) {
  if (!pool?.query) throw new TypeError('database pool is required');
  const result = await pool.query(
    'DELETE FROM referral_pending_attributions WHERE expires_at <= NOW()'
  );
  return Number(result?.rowCount || 0);
}

export async function persistUnconvertedReferralEvent(pool, input = {}, options = {}) {
  const env = options.env || process.env;
  const state = unconvertedReferralPersistenceState(env);
  if (!state.persistable) {
    return Object.freeze({ stored: false, reason: state.reason });
  }
  if (!pool?.query) throw new TypeError('database pool is required');

  const event = String(input.event || '').trim();
  if (!PERSISTABLE_EVENTS.has(event)) {
    return Object.freeze({ stored: false, reason: 'event_not_persistable' });
  }

  const referrerAccountId = Number(input.referrerAccountId);
  if (!Number.isInteger(referrerAccountId) || referrerAccountId < 1) {
    throw new TypeError('valid referrerAccountId is required');
  }

  const properties = input.properties || {};
  const role = boundedToken(properties.source_profile_role, 'source_profile_role', 40);
  if (!PROFILE_ROLES.has(role)) throw new TypeError('Invalid unconverted referral source profile role');
  const campaign = boundedToken(properties.campaign, 'campaign', 80);
  const source = boundedToken(properties.source || 'profile', 'source', 40);
  const medium = boundedToken(properties.medium || 'referral', 'medium', 40);
  const referralCode = boundedToken(input.referralCode, 'referral_code', 40);
  const correlationHash = hashReferralCorrelation({
    referralCode,
    sourceProfileRole: role,
    correlationId: properties.correlation_id,
    secret: env.REFERRAL_ATTRIBUTION_HMAC_SECRET
  });

  await ensureUnconvertedReferralSchema(pool);
  await purgeExpiredUnconvertedReferrals(pool);

  const firstLandingAt = event === 'referral_landing_viewed';
  const signupStartedAt = event === 'referral_signup_started';

  const result = await pool.query(
    `INSERT INTO referral_pending_attributions(
       referrer_account_id,referral_code_snapshot,correlation_hash,
       source_profile_role,campaign,source,medium,
       first_landing_at,signup_started_at,expires_at
     ) VALUES(
       $1,$2,$3,$4,$5,$6,$7,
       CASE WHEN $8::boolean THEN NOW() ELSE NULL END,
       CASE WHEN $9::boolean THEN NOW() ELSE NULL END,
       NOW() + INTERVAL '90 days'
     )
     ON CONFLICT(correlation_hash) DO UPDATE SET
       first_landing_at=COALESCE(referral_pending_attributions.first_landing_at, EXCLUDED.first_landing_at),
       signup_started_at=COALESCE(referral_pending_attributions.signup_started_at, EXCLUDED.signup_started_at),
       updated_at=NOW()
     RETURNING id,expires_at,first_landing_at,signup_started_at`,
    [
      referrerAccountId,
      referralCode,
      correlationHash,
      role,
      campaign,
      source,
      medium,
      firstLandingAt,
      signupStartedAt
    ]
  );

  return Object.freeze({
    stored: true,
    reason: 'stored',
    retentionDays: UNCONVERTED_REFERRAL_RETENTION_DAYS,
    row: result.rows?.[0] || null
  });
}
