import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bindReferralSignupConversion,
  convertedReferralBindingState,
  normalizeReferralConversionContext
} from '../growth/referral-conversion-binding.js';

const context = {
  referral_code: 'r1_abcdefghijklmnop',
  source_profile_role: 'merchant',
  correlation_id: '4f7f8bbd-6f3f-45d5-9f7e-32e5f282ce2d'
};

const readyEnv = {
  REFERRAL_ATTRIBUTION_CONVERTED_ENABLED: 'true',
  REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_APPROVED: 'true',
  REFERRAL_ATTRIBUTION_CONVERTED_LAWFUL_BASIS_APPROVED: 'true',
  REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_DAYS: '120',
  REFERRAL_ATTRIBUTION_CONVERTED_POLICY_VERSION: 'test-policy-v1',
  REFERRAL_ATTRIBUTION_HMAC_SECRET: 'test-only-secret-with-at-least-32-characters'
};

test('converted referral binding is fail-closed behind all explicit gates', () => {
  const guardrails = JSON.parse(readFileSync(new URL('../growth/privacy-guardrails.json', import.meta.url), 'utf8'));
  assert.equal(guardrails.convertedAttribution.enabledByDefault, false);
  assert.equal(guardrails.convertedAttribution.retentionDays, null);
  assert.equal(guardrails.convertedAttribution.selfReferralRejected, true);
  assert.equal(guardrails.convertedAttribution.duplicateAccountAttributionRejected, true);
  assert.equal(guardrails.convertedAttribution.rewardStateAllowed, false);
  assert.equal(convertedReferralBindingState({}).reason, 'disabled');
  assert.equal(convertedReferralBindingState({
    REFERRAL_ATTRIBUTION_CONVERTED_ENABLED: 'true'
  }).reason, 'retention_not_approved');
  assert.equal(convertedReferralBindingState({
    REFERRAL_ATTRIBUTION_CONVERTED_ENABLED: 'true',
    REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_APPROVED: 'true'
  }).reason, 'lawful_basis_not_approved');
  assert.equal(convertedReferralBindingState({
    REFERRAL_ATTRIBUTION_CONVERTED_ENABLED: 'true',
    REFERRAL_ATTRIBUTION_CONVERTED_RETENTION_APPROVED: 'true',
    REFERRAL_ATTRIBUTION_CONVERTED_LAWFUL_BASIS_APPROVED: 'true'
  }).reason, 'retention_days_not_configured');
  assert.equal(convertedReferralBindingState({
    ...readyEnv,
    REFERRAL_ATTRIBUTION_CONVERTED_POLICY_VERSION: ''
  }).reason, 'policy_version_not_configured');
  assert.equal(convertedReferralBindingState({
    ...readyEnv,
    REFERRAL_ATTRIBUTION_HMAC_SECRET: ''
  }).reason, 'hmac_secret_not_configured');
  assert.equal(convertedReferralBindingState(readyEnv).bindable, true);
});

test('conversion context accepts only canonical referral identity fields', () => {
  const normalized = normalizeReferralConversionContext(context);
  assert.equal(normalized.referralCode, context.referral_code);
  assert.equal(normalized.sourceProfileRole, 'merchant');
  assert.equal(normalized.correlationId, context.correlation_id);
  assert.throws(
    () => normalizeReferralConversionContext({ ...context, referral_code: 'bad' }),
    /Invalid referral conversion code/
  );
  assert.throws(
    () => normalizeReferralConversionContext({ ...context, source_profile_role: 'admin' }),
    /source profile role/
  );
});

test('disabled converted binding performs zero database work', async () => {
  let calls = 0;
  const pool = { query: async () => { calls += 1; throw new Error('must not query'); } };
  const result = await bindReferralSignupConversion(pool, {
    referredAccountId: 10,
    context
  }, { env: {} });

  assert.equal(result.bound, false);
  assert.equal(result.reason, 'disabled');
  assert.equal(calls, 0);
});

test('self referral is rejected and pending evidence is consumed', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('CREATE TABLE IF NOT EXISTS referral_attributions')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.startsWith('DELETE FROM referral_attributions')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM referral_pending_attributions') && text.includes('correlation_hash=$1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 41,
            referrer_account_id: 10,
            referral_code_snapshot: context.referral_code,
            source_profile_role: 'merchant',
            campaign: 'merchant_referral_v1',
            source: 'profile',
            medium: 'referral'
          }]
        };
      }
      if (text.startsWith('DELETE FROM referral_pending_attributions')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error('unexpected query: ' + text);
    }
  };

  const result = await bindReferralSignupConversion(pool, {
    referredAccountId: 10,
    context
  }, { env: readyEnv });

  assert.equal(result.bound, false);
  assert.equal(result.reason, 'self_referral');
  assert.equal(result.rejected, true);
  assert.equal(calls.some(call => call.text.includes('INSERT INTO referral_attributions')), false);
});

test('valid pending referral binds once with explicit retention metadata', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('CREATE TABLE IF NOT EXISTS referral_attributions')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.startsWith('DELETE FROM referral_attributions')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM referral_pending_attributions') && text.includes('correlation_hash=$1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 51,
            referrer_account_id: 7,
            referral_code_snapshot: context.referral_code,
            source_profile_role: 'merchant',
            campaign: 'merchant_referral_v1',
            source: 'profile',
            medium: 'referral'
          }]
        };
      }
      if (text.includes('FROM referral_attributions') && text.includes('referred_account_id=$1') && !text.includes(' OR ')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('INSERT INTO referral_attributions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 61,
            state: 'signed_up',
            signed_up_at: '2026-09-18T19:00:00.000Z',
            expires_at: '2027-01-16T19:00:00.000Z'
          }]
        };
      }
      if (text.startsWith('DELETE FROM referral_pending_attributions')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error('unexpected query: ' + text);
    }
  };

  const result = await bindReferralSignupConversion(pool, {
    referredAccountId: 10,
    context
  }, { env: readyEnv });

  assert.equal(result.bound, true);
  assert.equal(result.reason, 'bound');
  assert.equal(result.idempotent, false);
  assert.equal(result.referrerAccountId, 7);
  assert.equal(result.referredAccountId, 10);
  assert.equal(result.sourceProfileRole, 'merchant');
  assert.equal(result.retentionDays, 120);
  assert.equal(result.retentionPolicyVersion, 'test-policy-v1');

  const insert = calls.find(call => call.text.includes('INSERT INTO referral_attributions'));
  assert.ok(insert);
  assert.match(insert.text, /state,signed_up_at/);
  assert.match(insert.text, /retention_policy_version,retention_days,expires_at/);
  assert.equal(insert.params.includes(context.correlation_id), false);
});

test('registration carries referral context but only emits signup-completed after successful binding', () => {
  const authUi = readFileSync(new URL('../public/auth-ui.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server-auth.js', import.meta.url), 'utf8');
  const analytics = readFileSync(new URL('../growth/referral-analytics.js', import.meta.url), 'utf8');

  assert.match(authUi, /await trackReferralSignupStarted\(\)/);
  assert.match(authUi, /referral_conversion:referralConversion/);
  assert.match(authUi, /correlation_id:referralCorrelationId\(\)/);
  assert.match(server, /bindReferralSignupConversion/);
  assert.match(server, /if \(binding\.bound && !binding\.idempotent\)/);
  assert.match(server, /event: 'referral_signup_completed'/);
  assert.match(analytics, /'referral_signup_completed'/);
});
