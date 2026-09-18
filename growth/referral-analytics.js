const PUBLIC_PROFILE_ROLES = new Set(['customer','merchant','supplier','courier','service_provider']);
const CHANNELS = new Set(['native_share','copy_link','whatsapp','telegram','sms','email','qr','other']);

export const RUNTIME_REFERRAL_EVENTS = Object.freeze([
  'referral_link_created',
  'referral_shared',
  'referral_landing_viewed'
]);

const RUNTIME_EVENTS = new Set(RUNTIME_REFERRAL_EVENTS);
const ALLOWED_PROPERTIES = new Set([
  'campaign',
  'source',
  'medium',
  'source_profile_role',
  'channel',
  'creative_variant',
  'cta_variant',
  'landing_variant',
  'correlation_id'
]);

const REQUIRED = Object.freeze({
  referral_link_created: ['campaign','source_profile_role','correlation_id'],
  referral_shared: ['channel','campaign','source_profile_role','correlation_id'],
  referral_landing_viewed: ['campaign','source','medium','source_profile_role','correlation_id']
});

function boundedToken(value, name, max = 80) {
  const token = String(value ?? '').trim();
  if (!token || token.length > max || !/^[A-Za-z0-9._~:-]+$/.test(token)) {
    throw new TypeError(`Invalid referral analytics property: ${name}`);
  }
  return token;
}

function normalizeProperties(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Referral analytics properties must be an object');
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_PROPERTIES.has(key)) {
      throw new TypeError(`Referral analytics property is not allowed: ${key}`);
    }
    if (value === undefined || value === null || value === '') continue;
    output[key] = boundedToken(value, key);
  }

  if (output.source_profile_role && !PUBLIC_PROFILE_ROLES.has(output.source_profile_role)) {
    throw new TypeError('Invalid referral analytics source profile role');
  }
  if (output.channel && !CHANNELS.has(output.channel)) {
    throw new TypeError('Invalid referral analytics channel');
  }
  if (output.correlation_id && !/^[A-Za-z0-9_-]{16,80}$/.test(output.correlation_id)) {
    throw new TypeError('Invalid referral analytics correlation id');
  }
  return output;
}

export function sanitizeReferralAnalyticsEvent(input = {}) {
  const event = String(input.event ?? '').trim();
  if (!RUNTIME_EVENTS.has(event)) {
    throw new TypeError('Referral analytics event is not enabled in the current runtime slice');
  }
  const properties = normalizeProperties(input.properties);
  for (const key of REQUIRED[event]) {
    if (!properties[key]) throw new TypeError(`Referral analytics event ${event} requires ${key}`);
  }
  return Object.freeze({ event, properties: Object.freeze(properties) });
}

function safePostHogHost(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function referralAnalyticsDeliveryState(env = process.env) {
  const enabled = String(env.REFERRAL_ANALYTICS_ENABLED || '').toLowerCase() === 'true';
  const retentionApproved = String(env.REFERRAL_ANALYTICS_RETENTION_APPROVED || '').toLowerCase() === 'true';
  const projectToken = String(env.POSTHOG_PROJECT_TOKEN || '').trim();
  const ingestHost = safePostHogHost(env.POSTHOG_INGEST_HOST);
  const configured = Boolean(projectToken && ingestHost);

  let reason = 'ready';
  if (!enabled) reason = 'disabled';
  else if (!retentionApproved) reason = 'retention_not_approved';
  else if (!configured) reason = 'posthog_not_configured';

  return Object.freeze({
    enabled,
    retentionApproved,
    configured,
    deliverable: enabled && retentionApproved && configured,
    reason,
    ingestHost
  });
}

export async function deliverReferralAnalyticsEvent(input, options = {}) {
  const event = sanitizeReferralAnalyticsEvent(input);
  const env = options.env || process.env;
  const state = referralAnalyticsDeliveryState(env);
  if (!state.deliverable) {
    return Object.freeze({ accepted: true, delivered: false, reason: state.reason, event: event.event });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  const response = await fetchImpl(`${state.ingestHost}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: String(env.POSTHOG_PROJECT_TOKEN).trim(),
      distinct_id: event.properties.correlation_id,
      event: event.event,
      properties: {
        ...event.properties,
        $process_person_profile: false
      }
    }),
    signal: options.signal || AbortSignal.timeout(2500)
  });

  if (!response?.ok) {
    throw new Error(`PostHog referral analytics capture failed (${response?.status || 'unknown'})`);
  }

  return Object.freeze({ accepted: true, delivered: true, reason: 'delivered', event: event.event });
}
