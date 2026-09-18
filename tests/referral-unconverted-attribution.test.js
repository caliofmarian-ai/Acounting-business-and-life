import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNCONVERTED_REFERRAL_RETENTION_DAYS,
  hashReferralCorrelation,
  persistUnconvertedReferralEvent,
  unconvertedReferralPersistenceState
} from '../growth/referral-unconverted-attribution.js';

const eventInput = {
  referrerAccountId: 7,
  referralCode: 'r1_abcdefghijklmnop',
  event: 'referral_landing_viewed',
  properties: {
    source_profile_role: 'merchant',
    campaign: 'merchant_referral_v1',
    source: 'profile',
    medium: 'referral',
    correlation_id: '4f7f8bbd-6f3f-45d5-9f7e-32e5f282ce2d'
  }
};

const readyEnv = {
  REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED: 'true',
  REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true',
  REFERRAL_ANALYTICS_LAWFUL_BASIS_APPROVED: 'true',
  REFERRAL_ATTRIBUTION_HMAC_SECRET: 'test-only-secret-with-at-least-32-characters'
};

test('pending attribution is fail-closed behind activation, retention, lawful-basis and secret gates', () => {
  const guardrails = JSON.parse(readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8'));
  assert.equal(guardrails.retention.unconvertedReferralEventDays, UNCONVERTED_REFERRAL_RETENTION_DAYS);
  assert.equal(guardrails.pendingAttribution.enabledByDefault, false);
  assert.equal(guardrails.pendingAttribution.convertedAccountBindingAllowed, false);
  assert.equal(guardrails.pendingAttribution.rawCorrelationIdStored, false);
  assert.equal(unconvertedReferralPersistenceState({}).reason, 'disabled');
  assert.equal(unconvertedReferralPersistenceState({
    REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED: 'true'
  }).reason, 'retention_not_approved');
  assert.equal(unconvertedReferralPersistenceState({
    REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED: 'true',
    REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true'
  }).reason, 'lawful_basis_not_approved');
  assert.equal(unconvertedReferralPersistenceState({
    REFERRAL_ATTRIBUTION_UNCONVERTED_ENABLED: 'true',
    REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true',
    REFERRAL_ANALYTICS_LAWFUL_BASIS_APPROVED: 'true'
  }).reason, 'hmac_secret_not_configured');

  const ready = unconvertedReferralPersistenceState(readyEnv);
  assert.equal(ready.persistable, true);
  assert.equal(UNCONVERTED_REFERRAL_RETENTION_DAYS, 90);
});

test('correlation identity is HMAC pseudonymized and referral/profile scoped', () => {
  const first = hashReferralCorrelation({
    referralCode: eventInput.referralCode,
    sourceProfileRole: 'merchant',
    correlationId: eventInput.properties.correlation_id,
    secret: readyEnv.REFERRAL_ATTRIBUTION_HMAC_SECRET
  });
  const repeat = hashReferralCorrelation({
    referralCode: eventInput.referralCode,
    sourceProfileRole: 'merchant',
    correlationId: eventInput.properties.correlation_id,
    secret: readyEnv.REFERRAL_ATTRIBUTION_HMAC_SECRET
  });
  const otherRole = hashReferralCorrelation({
    referralCode: eventInput.referralCode,
    sourceProfileRole: 'customer',
    correlationId: eventInput.properties.correlation_id,
    secret: readyEnv.REFERRAL_ATTRIBUTION_HMAC_SECRET
  });

  assert.equal(first, repeat);
  assert.notEqual(first, otherRole);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes(eventInput.properties.correlation_id), false);
});

test('disabled pending attribution performs no database work', async () => {
  let calls = 0;
  const pool = { query: async () => { calls += 1; throw new Error('must not be called'); } };
  const result = await persistUnconvertedReferralEvent(pool, eventInput, { env: {} });
  assert.equal(result.stored, false);
  assert.equal(result.reason, 'disabled');
  assert.equal(calls, 0);
});

test('enabled pending attribution stores only pseudonymous session evidence with fixed 90-day expiry', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).startsWith('DELETE FROM referral_pending_attributions')) {
        return { rowCount: 0, rows: [] };
      }
      if (String(sql).includes('RETURNING id,expires_at')) {
        return {
          rowCount: 1,
          rows: [{
            id: 11,
            expires_at: '2026-12-17T00:00:00.000Z',
            first_landing_at: '2026-09-18T00:00:00.000Z',
            signup_started_at: null
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    }
  };

  const result = await persistUnconvertedReferralEvent(pool, eventInput, { env: readyEnv });
  assert.equal(result.stored, true);
  assert.equal(result.retentionDays, 90);
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS referral_pending_attributions/);
  assert.match(calls[1].sql, /expires_at <= NOW\(\)/);
  assert.match(calls[2].sql, /INTERVAL '90 days'/);
  assert.match(calls[2].sql, /ON CONFLICT\(correlation_hash\)/);

  const insertParams = calls[2].params;
  assert.equal(insertParams.includes(eventInput.properties.correlation_id), false);
  assert.equal(insertParams.includes('person@example.test'), false);
  assert.match(insertParams[2], /^[a-f0-9]{64}$/);
});

test('later funnel stages are not persisted before converted-attribution policy exists', async () => {
  let calls = 0;
  const pool = { query: async () => { calls += 1; return { rowCount: 0, rows: [] }; } };
  const result = await persistUnconvertedReferralEvent(pool, {
    ...eventInput,
    event: 'referral_signup_completed'
  }, { env: readyEnv });

  assert.equal(result.stored, false);
  assert.equal(result.reason, 'event_not_persistable');
  assert.equal(calls, 0);
});
