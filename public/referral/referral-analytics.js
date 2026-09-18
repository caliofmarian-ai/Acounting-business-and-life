const CORRELATION_KEY = 'abl_referral_correlation_id';
let memoryCorrelation = '';

function newCorrelationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return 'r_' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 18);
}

export function referralCorrelationId() {
  try {
    const existing = sessionStorage.getItem(CORRELATION_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) return existing;
    const created = newCorrelationId();
    sessionStorage.setItem(CORRELATION_KEY, created);
    return created;
  } catch {
    if (!memoryCorrelation) memoryCorrelation = newCorrelationId();
    return memoryCorrelation;
  }
}

export async function captureReferralEvent({
  event,
  properties = {},
  referralCode = '',
  authenticated = false,
  token = ''
} = {}) {
  const correlation_id = referralCorrelationId();
  const endpoint = authenticated
    ? '/api/growth/referral-analytics/account'
    : '/api/growth/referral-analytics/public';
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated && token) headers.Authorization = 'Bearer ' + token;

  const body = {
    event,
    properties: { ...properties, correlation_id }
  };
  if (!authenticated) body.referral_code = referralCode;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive: true
    });
    return response.ok;
  } catch {
    return false;
  }
}
