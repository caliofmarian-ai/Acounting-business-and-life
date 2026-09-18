import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deliverReferralAnalyticsEvent,
  referralAnalyticsDeliveryState,
  sanitizeReferralAnalyticsEvent
} from '../growth/referral-analytics.js';

const safeLanding = {
  event: 'referral_landing_viewed',
  properties: {
    campaign: 'merchant_referral_v1',
    source: 'profile',
    medium: 'referral',
    source_profile_role: 'merchant',
    correlation_id: '4f7f8bbd-6f3f-45d5-9f7e-32e5f282ce2d'
  }
};

test('runtime referral analytics accepts only privacy-minimized properties', () => {
  const clean = sanitizeReferralAnalyticsEvent(safeLanding);
  assert.equal(clean.event, 'referral_landing_viewed');
  assert.equal(clean.properties.source_profile_role, 'merchant');
  assert.throws(
    () => sanitizeReferralAnalyticsEvent({
      ...safeLanding,
      properties: { ...safeLanding.properties, email: 'person@example.test' }
    }),
    /not allowed/
  );
  const qrOpen = sanitizeReferralAnalyticsEvent({
    event: 'referral_qr_opened',
    properties: {
      campaign: 'merchant_referral_v1',
      source_profile_role: 'merchant',
      correlation_id: '4f7f8bbd-6f3f-45d5-9f7e-32e5f282ce2d'
    }
  });
  assert.equal(qrOpen.event, 'referral_qr_opened');

  const signup = sanitizeReferralAnalyticsEvent({
    event: 'referral_signup_started',
    properties: {
      campaign: 'merchant_referral_v1',
      source: 'profile',
      source_profile_role: 'merchant',
      correlation_id: '4f7f8bbd-6f3f-45d5-9f7e-32e5f282ce2d'
    }
  });
  assert.equal(signup.event, 'referral_signup_started');
  assert.throws(
    () => sanitizeReferralAnalyticsEvent({ event: 'referral_rewarded', properties: {} }),
    /not enabled/
  );
});

test('delivery is fail-closed until analytics, retention, project identity and PostHog config are all ready', () => {
  assert.equal(referralAnalyticsDeliveryState({}).reason, 'disabled');
  assert.equal(referralAnalyticsDeliveryState({
    REFERRAL_ANALYTICS_ENABLED: 'true',
    POSTHOG_PROJECT_TOKEN: 'phc_test',
    POSTHOG_INGEST_HOST: 'https://eu.i.posthog.com'
  }).reason, 'retention_not_approved');
  assert.equal(referralAnalyticsDeliveryState({
    REFERRAL_ANALYTICS_ENABLED: 'true',
    REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true'
  }).reason, 'project_not_verified');
  assert.equal(referralAnalyticsDeliveryState({
    REFERRAL_ANALYTICS_ENABLED: 'true',
    REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true',
    REFERRAL_ANALYTICS_PROJECT_VERIFIED: 'true'
  }).reason, 'posthog_not_configured');
});

test('PostHog delivery uses correlation id, disables person profiles and forwards no raw contact PII', async () => {
  let captured;
  const result = await deliverReferralAnalyticsEvent(safeLanding, {
    env: {
      REFERRAL_ANALYTICS_ENABLED: 'true',
      REFERRAL_ANALYTICS_RETENTION_APPROVED: 'true',
      REFERRAL_ANALYTICS_PROJECT_VERIFIED: 'true',
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      POSTHOG_INGEST_HOST: 'https://eu.i.posthog.com'
    },
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.delivered, true);
  assert.equal(captured.url, 'https://eu.i.posthog.com/i/v0/e/');
  assert.equal(captured.body.distinct_id, safeLanding.properties.correlation_id);
  assert.equal(captured.body.properties.$process_person_profile, false);
  assert.equal('email' in captured.body.properties, false);
  assert.equal('phone' in captured.body.properties, false);
});

test('referral UI is wired to the same-origin analytics gateway, never directly to PostHog', () => {
  const helper = readFileSync(new URL('../public/referral/referral-analytics.js', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../public/referral/referral.js', import.meta.url), 'utf8');
  const promotion = readFileSync(new URL('../public/referral/promotion-center.html', import.meta.url), 'utf8');
  const authUi = readFileSync(new URL('../public/auth-ui.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server-auth.js', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../growth/referral-analytics.js', import.meta.url), 'utf8');

  assert.match(helper, /\/api\/growth\/referral-analytics\/account/);
  assert.match(helper, /\/api\/growth\/referral-analytics\/public/);
  assert.match(landing, /referral_qr_opened/);
  assert.match(landing, /location\.hash === '#qr'/);
  assert.match(landing, /history\.replaceState/);
  assert.match(landing, /referral_landing_viewed/);
  assert.match(landing, /referral_shared/);
  assert.match(promotion, /referral_link_created/);
  assert.match(promotion, /referral_shared/);
  assert.match(authUi, /referral_signup_started/);
  assert.match(server, /campaign: `\$\{role\}_referral_v1`/);
  assert.match(server, /source profile is not enabled/);
  assert.match(server, /referral-analytics\/account/);
  assert.match(server, /PUBLIC_REFERRAL_ANALYTICS_EVENTS = new Set\(\['referral_qr_opened'/);
  assert.match(server, /referral-analytics\/public/);
  assert.match(adapter, /'referral_qr_opened'/);
  assert.match(adapter, /REFERRAL_ANALYTICS_RETENTION_APPROVED/);
  assert.match(adapter, /REFERRAL_ANALYTICS_PROJECT_VERIFIED/);
  assert.doesNotMatch(helper, /POSTHOG_PROJECT_TOKEN|\.posthog\.com/);
});
