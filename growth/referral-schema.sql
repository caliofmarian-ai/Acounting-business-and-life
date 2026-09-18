-- Business & Life referral/growth persistence contract.
-- Dedicated runtime modules may create only the subset they own when their fail-closed gates permit it.
-- Marketing referral attribution must remain separate from Issue #30 privileged-profile invitations.

CREATE TABLE IF NOT EXISTS referral_accounts (
  account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  CHECK (referral_code ~ '^r1_[A-Za-z0-9_-]{16}$')
);

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

-- This pending table is intentionally incapable of storing a referred account id,
-- qualification state or reward evidence. It is the 90-day pre-conversion boundary.
-- Conversion into referral_attributions remains HOLD until the separate converted
-- retention/deletion and lawful-purpose rules are approved.

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

CREATE INDEX IF NOT EXISTS referral_attributions_referrer_idx
  ON referral_attributions(referrer_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referral_attributions_campaign_idx
  ON referral_attributions(campaign, source, medium, created_at DESC);

ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS correlation_hash TEXT;
ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_policy_version TEXT;
ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_days INTEGER;
ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS retention_months INTEGER;
ALTER TABLE referral_attributions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_correlation_hash_unique
  ON referral_attributions(correlation_hash)
  WHERE correlation_hash IS NOT NULL;

-- `retention_days` is retained only for schema compatibility with pre-Owner-decision preparation.
-- Owner-approved pilot policy uses `retention_months = 12` and calendar-month expiry.

CREATE INDEX IF NOT EXISTS referral_attributions_expiry_idx
  ON referral_attributions(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_events (
  id BIGSERIAL PRIMARY KEY,
  attribution_id BIGINT REFERENCES referral_attributions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (event_name IN (
    'referral_landing_viewed',
    'referral_signup_started',
    'referral_signup_completed',
    'referral_qualified',
    'referral_rewarded',
    'referral_rejected'
  ))
);

CREATE TABLE IF NOT EXISTS referral_reward_grants (
  id BIGSERIAL PRIMARY KEY,
  attribution_id BIGINT NOT NULL REFERENCES referral_attributions(id) ON DELETE CASCADE,
  beneficiary_account_id BIGINT NOT NULL REFERENCES accounts(id),
  reward_policy_version TEXT NOT NULL,
  reward_kind TEXT NOT NULL,
  reward_amount NUMERIC,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_at TIMESTAMPTZ,
  UNIQUE (attribution_id, beneficiary_account_id, reward_policy_version, reward_kind),
  CHECK (status IN ('pending','granted','reversed','rejected'))
);

-- Intentionally absent:
-- - raw email addresses
-- - raw phone numbers
-- - contact/address-book uploads
-- - profile approval or permission-grant columns
-- Referral attribution cannot be used as an authorization source.
