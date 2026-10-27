import { DEFAULT_PROMOTION_ARTWORK_ID, PROMOTION_ARTWORK_IDS } from './promotion-brand.js';

export const PUBLIC_REFERRAL_ROLES = Object.freeze(['customer', 'merchant', 'supplier', 'courier', 'service_provider']);
export const PROMOTION_LOCALES = Object.freeze(['en-PH', 'fil-PH']);
export const PROMOTION_FORMATS = Object.freeze(['png', 'jpg', 'svg']);
const CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;
const PREFERENCE_PREFIX = 'abl_referral_presentation_v1:';
const PAGE_PATHS = new Set(['/referral/promotion-center.html', '/referral/marketing-kit.html']);

export function normalizePromotionLocale(value) {
  return PROMOTION_LOCALES.includes(value) ? value : 'en-PH';
}

export function enabledReferralProfiles(snapshot) {
  const enabled = new Set((snapshot?.profiles || []).filter(profile => profile?.enabled === true).map(profile => profile.role));
  return PUBLIC_REFERRAL_ROLES.filter(role => enabled.has(role));
}

export function sanitizePresentation(input = {}, { templates = [], variants = [] } = {}) {
  const out = {};
  if (PUBLIC_REFERRAL_ROLES.includes(input.profile)) out.profile = input.profile;
  if (PROMOTION_LOCALES.includes(input.locale)) out.locale = input.locale;
  if (templates.includes(input.template)) out.template = input.template;
  if (variants.includes(input.variant)) out.variant = input.variant;
  if (PROMOTION_FORMATS.includes(input.format)) out.format = input.format;
  if (PROMOTION_ARTWORK_IDS.includes(input.artwork)) out.artwork = input.artwork;
  return out;
}

export function readPresentation(storage, accountId, allowed) {
  if (!Number.isSafeInteger(Number(accountId)) || Number(accountId) < 1) return {};
  try {
    const raw = JSON.parse(storage?.getItem(PREFERENCE_PREFIX + Number(accountId)) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? sanitizePresentation(raw, allowed) : {};
  } catch { return {}; }
}

export function writePresentation(storage, accountId, input, allowed) {
  if (!Number.isSafeInteger(Number(accountId)) || Number(accountId) < 1) return;
  try { storage?.setItem(PREFERENCE_PREFIX + Number(accountId), JSON.stringify(sanitizePresentation(input, allowed))); } catch {}
}

export function resolvePresentation({ query = {}, saved = {}, snapshot, templates = [], variants = [] } = {}) {
  const options = { templates, variants };
  const requested = sanitizePresentation(query, options);
  const previous = sanitizePresentation(saved, options);
  const profiles = enabledReferralProfiles(snapshot);
  const profile = [requested.profile, previous.profile, snapshot?.account?.active_role, ...profiles].find(role => profiles.includes(role)) || '';
  return {
    profile,
    locale: requested.locale || previous.locale || normalizePromotionLocale(snapshot?.account?.preferred_locale),
    template: requested.template || previous.template || templates[0] || '',
    variant: requested.variant || previous.variant || (variants.includes('personal_share_v1') ? 'personal_share_v1' : variants[0] || ''),
    format: requested.format || previous.format || 'png',
    artwork: requested.artwork || previous.artwork || DEFAULT_PROMOTION_ARTWORK_ID,
    unavailableRequestedProfile: Boolean(requested.profile && !profiles.includes(requested.profile))
  };
}

export function presentationPageUrl(path, choices, allowed) {
  if (!PAGE_PATHS.has(path)) throw new TypeError('Unknown promotion page');
  const params = new URLSearchParams(sanitizePresentation(choices, allowed));
  return path + (params.size ? '?' + params.toString() : '');
}

export function validateReferralIdentity(data, { accountId, profile }) {
  if (!data || Number(data.account_id) !== Number(accountId) || data.profileRole !== profile || !CODE_RE.test(String(data.code || ''))) {
    throw Object.assign(new Error('Referral identity does not match the current account and profile'), { code: 'invalid_response' });
  }
  let url;
  try { url = new URL(data.referralUrl); } catch { throw Object.assign(new Error('Invalid referral URL'), { code: 'invalid_response' }); }
  // This authenticated same-origin API owns the configured public origin. A custom
  // domain may correctly return its canonical referral URL on another app alias.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/referral/' || url.hash || url.searchParams.get('ref') !== data.code || url.searchParams.getAll('ref').length !== 1 || url.searchParams.get('profile') !== profile || url.searchParams.getAll('profile').length !== 1) {
    throw Object.assign(new Error('Invalid referral URL'), { code: 'invalid_response' });
  }
  const qr = data.qr;
  const qrDataUrl = qr?.referralUrl === data.referralUrl && qr?.marker === 'qr' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(qr?.dataUrl || '')) && qr.dataUrl.length <= 500000
    ? qr.dataUrl : '';
  return Object.freeze({ ...data, referralUrl: url.toString(), qrDataUrl });
}

/** A deadline also covers body parsing and browser APIs that do not reject on abort. */
export function waitForPromotionOperation(operation, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || Object.assign(new Error('Operation aborted'), { name: 'AbortError' }));
    if (signal.aborted) { Promise.resolve(operation).catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function errorCode(error) {
  if (error?.status === 401) return 'signed_out';
  if (error?.status === 403) return 'profile_unavailable';
  if (error?.name === 'AbortError') return 'timeout';
  return error?.code === 'invalid_response' ? 'invalid_response' : 'temporary';
}

/** A loaded referral is usable only within the exact account, browser session and selection that fetched it. */
export function createReferralController({ fetchImpl, session, onState = () => {}, onContext = () => '', onReady = () => {}, timeoutMs = 12000 }) {
  let generation = 0;
  let pending = null;
  let loaded = null;
  let disposed = false;
  let phase = 'idle';
  const fingerprint = () => String(session?.csrfToken?.() || '');
  const authenticated = () => Boolean(session?.authenticated?.());
  const current = ticket => {
    if (disposed || ticket.generation !== generation || ticket.controller.signal.aborted) return false;
    if (!authenticated() || ticket.session !== fingerprint()) {
      invalidate(authenticated() ? 'session_changed' : 'signed_out');
      return false;
    }
    return true;
  };

  function publish(next, details = {}) {
    phase = next;
    onState({ phase: next, ...details });
  }
  function invalidate(reason = 'session_changed') {
    generation += 1;
    pending?.controller.abort();
    pending = null;
    loaded = null;
    if (!disposed) publish(reason === 'signed_out' ? 'signed_out' : 'unavailable', { code: reason });
  }
  async function json(path, ticket) {
    const signal = ticket.controller.signal;
    const response = await waitForPromotionOperation(fetchImpl(path, { cache: 'no-store', signal }), signal);
    let data;
    try { data = await waitForPromotionOperation(response.json(), signal); }
    catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw signal.reason || error;
      if (response.ok) throw Object.assign(new Error('Invalid response body'), { code: 'invalid_response' });
      data = {};
    }
    if (!response.ok) throw Object.assign(new Error('Referral request failed'), { status: response.status });
    return data;
  }
  async function load(requestedProfile = '') {
    if (disposed) return;
    generation += 1;
    pending?.controller.abort();
    loaded = null;
    const ticket = { generation, controller: new AbortController(), session: '', profile: '', accountId: null };
    pending = ticket;
    publish('loading');
    let timeout;
    try {
      timeout = setTimeout(() => ticket.controller.abort(), timeoutMs);
      await waitForPromotionOperation(session?.ready || Promise.resolve(), ticket.controller.signal);
      if (disposed || ticket.generation !== generation) return;
      if (!authenticated()) { publish('signed_out', { code: 'signed_out' }); return; }
      ticket.session = fingerprint();
      const snapshot = await json('/api/me', ticket);
      if (!current(ticket)) return;
      const accountId = Number(snapshot?.account?.id);
      if (!Number.isSafeInteger(accountId) || accountId < 1) throw Object.assign(new Error('Invalid account identity'), { code: 'invalid_response' });
      ticket.accountId = accountId;
      const profiles = enabledReferralProfiles(snapshot);
      const selection = onContext(snapshot, { requestedProfile, profiles });
      if (!current(ticket)) return;
      if (!profiles.length) { publish('empty', { code: 'no_profiles' }); return; }
      ticket.profile = profiles.includes(selection) ? selection : profiles[0];
      const data = await json('/api/growth/referral?profile=' + encodeURIComponent(ticket.profile), ticket);
      if (!current(ticket)) return;
      const identity = validateReferralIdentity(data, { accountId, profile: ticket.profile });
      clearTimeout(timeout);
      timeout = null;
      const snapshotValue = Object.freeze({ identity, account: snapshot.account, profile: ticket.profile, session: ticket.session });
      loaded = snapshotValue;
      // DOM work may decode images. It must check this same guard after every await.
      await onReady(snapshotValue, () => current(ticket) && loaded === snapshotValue);
      if (!current(ticket) || loaded !== snapshotValue) return;
      publish('ready');
      return snapshotValue;
    } catch (error) {
      if (disposed || ticket.generation !== generation) return;
      loaded = null;
      if (!authenticated() || (ticket.session && ticket.session !== fingerprint())) {
        invalidate(authenticated() ? 'session_changed' : 'signed_out');
      } else {
        const code = errorCode(error);
        publish(code === 'signed_out' ? 'signed_out' : 'error', { code });
      }
    } finally {
      clearTimeout(timeout);
      if (pending === ticket) pending = null;
    }
  }
  function getCurrent() {
    if (!loaded || !['ready', 'loading'].includes(phase)) return null;
    if (!authenticated() || loaded.session !== fingerprint()) { invalidate(authenticated() ? 'session_changed' : 'signed_out'); return null; }
    return loaded;
  }
  function dispose() { disposed = true; generation += 1; pending?.controller.abort(); pending = null; loaded = null; }
  return Object.freeze({ load, invalidate, getCurrent, dispose, getPhase: () => phase });
}
