import crypto from 'node:crypto';

export const PUBLIC_PROFILE_ROLES = Object.freeze([
  'customer',
  'merchant',
  'supplier',
  'courier',
  'service_provider'
]);

export const REFERRAL_STATES = Object.freeze([
  'created',
  'clicked',
  'signed_up',
  'qualified',
  'rewarded',
  'rejected'
]);

const REFERRAL_CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;
const SAFE_TOKEN_RE = /[^A-Za-z0-9._~-]/g;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function safeToken(value, fallback) {
  const raw = String(value ?? '').trim();
  const normalized = raw.replace(SAFE_TOKEN_RE, '-').replace(/-+/g, '-').slice(0, 80);
  return normalized || fallback;
}

export function generateReferralCode({ accountId, secret }) {
  const id = required(accountId, 'accountId');
  const key = required(secret, 'secret');
  if (key.length < 16) throw new TypeError('secret must be at least 16 characters');
  const digest = crypto
    .createHmac('sha256', key)
    .update(`business-and-life:referral:v1:${id}`)
    .digest('base64url')
    .slice(0, 16);
  return `r1_${digest}`;
}

export function isValidReferralCode(code) {
  return REFERRAL_CODE_RE.test(String(code ?? ''));
}

export function buildReferralUrl({
  origin,
  code,
  campaign = 'organic',
  source = 'profile',
  medium = 'referral',
  profileRole
}) {
  if (!isValidReferralCode(code)) throw new TypeError('invalid referral code');
  const url = new URL('/referral/', required(origin, 'origin'));
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('origin must use http or https');

  url.searchParams.set('ref', code);
  url.searchParams.set('utm_campaign', safeToken(campaign, 'organic'));
  url.searchParams.set('utm_source', safeToken(source, 'profile'));
  url.searchParams.set('utm_medium', safeToken(medium, 'referral'));

  if (profileRole != null) {
    const role = required(profileRole, 'profileRole');
    if (!PUBLIC_PROFILE_ROLES.includes(role)) throw new TypeError('unknown public profile role');
    url.searchParams.set('profile', role);
  }

  return url.toString();
}

export function buildSharePayload({
  url,
  inviterDisplayName = '',
  appName = 'Business & Life'
}) {
  const parsed = new URL(required(url, 'url'));
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new TypeError('url must use http or https');

  const name = String(inviterDisplayName ?? '').trim().slice(0, 80);
  return Object.freeze({
    title: appName,
    text: name
      ? `${name} invited you to try ${appName}.`
      : `You are invited to try ${appName}.`,
    url: parsed.toString()
  });
}

export function referralAttributionEnvelope({
  code,
  campaign = 'organic',
  source = 'profile',
  medium = 'referral',
  profileRole = null
}) {
  if (!isValidReferralCode(code)) throw new TypeError('invalid referral code');
  if (profileRole != null && !PUBLIC_PROFILE_ROLES.includes(profileRole)) {
    throw new TypeError('unknown public profile role');
  }

  return Object.freeze({
    referralCode: code,
    campaign: safeToken(campaign, 'organic'),
    source: safeToken(source, 'profile'),
    medium: safeToken(medium, 'referral'),
    sourceProfileRole: profileRole,
    grantsProfiles: false,
    grantsPermissions: false
  });
}

const EVENT_TARGET = Object.freeze({
  click: 'clicked',
  signup: 'signed_up',
  qualify: 'qualified',
  reward: 'rewarded'
});

const ALLOWED = Object.freeze({
  created: new Set(['clicked', 'signed_up']),
  clicked: new Set(['signed_up']),
  signed_up: new Set(['qualified']),
  qualified: new Set(['rewarded']),
  rewarded: new Set(),
  rejected: new Set()
});

export function transitionReferral(
  current,
  event,
  { referrerAccountId, referredAccountId, occurredAt = new Date().toISOString() } = {}
) {
  const state = current?.state ?? 'created';
  if (!REFERRAL_STATES.includes(state)) throw new TypeError('unknown referral state');

  const target = EVENT_TARGET[event];
  if (!target) throw new TypeError('unknown referral event');

  const referrer = referrerAccountId == null ? null : String(referrerAccountId);
  const referred = referredAccountId == null ? null : String(referredAccountId);

  if (referrer && referred && referrer === referred) {
    return Object.freeze({
      ...current,
      state: 'rejected',
      rejectionReason: 'self_referral',
      rejectedAt: occurredAt,
      idempotent: state === 'rejected'
    });
  }

  if (state === target) return Object.freeze({ ...current, idempotent: true });
  if (state === 'rewarded' || state === 'rejected') return Object.freeze({ ...current, idempotent: true });
  if (!ALLOWED[state].has(target)) {
    throw new RangeError(`invalid referral transition: ${state} -> ${target}`);
  }

  const timestampField = {
    clicked: 'clickedAt',
    signed_up: 'signedUpAt',
    qualified: 'qualifiedAt',
    rewarded: 'rewardedAt'
  }[target];

  return Object.freeze({
    ...current,
    state: target,
    [timestampField]: current?.[timestampField] ?? occurredAt,
    idempotent: false
  });
}

export function publicReferralIdentity({ code, profileRole = null }) {
  if (!isValidReferralCode(code)) throw new TypeError('invalid referral code');
  if (profileRole != null && !PUBLIC_PROFILE_ROLES.includes(profileRole)) {
    throw new TypeError('unknown public profile role');
  }
  return Object.freeze({ code, profileRole });
}
