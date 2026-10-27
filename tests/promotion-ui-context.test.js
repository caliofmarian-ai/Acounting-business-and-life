import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReferralController, enabledReferralProfiles, resolvePresentation, readPresentation,
  writePresentation, presentationPageUrl, validateReferralIdentity
} from '../public/referral/promotion-ui-core.js';
import { PROMOTION_COPY } from '../public/referral/promotion-copy.js';

const options = { templates: ['poster', 'story'], variants: ['personal_share_v1', 'clarity_v1'] };
const snapshot = (id = 21) => ({ account: { id, active_role: 'merchant', preferred_locale: 'fil-PH' }, profiles: [
  { role: 'merchant', enabled: true }, { role: 'customer', enabled: true }, { role: 'supplier', enabled: false }, { role: 'admin', enabled: true }
] });
const identity = (role, id = 21) => {
  const code = 'r1_abcdefghijklmnop';
  const referralUrl = 'https://caliof.com/referral/?ref=' + code + '&profile=' + role + '&utm_campaign=' + role + '_referral_v1';
  return { account_id: id, profileRole: role, code, referralUrl, campaign: role + '_referral_v1', qr: { referralUrl, marker: 'qr', dataUrl: 'data:image/png;base64,AAAA' } };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const requests = [], states = [], ready = [];
  let csrf = 'session-a', authenticated = true;
  const controller = createReferralController({
    session: { ready: Promise.resolve(), authenticated: () => authenticated, csrfToken: () => csrf },
    fetchImpl(path, init) { const pending = deferred(); requests.push({ path, init, ...pending }); return pending.promise; },
    onState: state => states.push(state),
    onContext: (data, { requestedProfile, profiles }) => profiles.includes(requestedProfile) ? requestedProfile : data.account.active_role,
    onReady: data => ready.push(data)
  });
  const respond = (index, body, status = 200) => requests[index].resolve({ ok: status < 400, status, json: async () => body });
  return { controller, requests, states, ready, respond, changeSession(value) { csrf = value; }, signOut() { authenticated = false; } };
}

test('presentation resolves only enabled public profiles and follows the account language', () => {
  assert.deepEqual(enabledReferralProfiles(snapshot()), ['customer', 'merchant']);
  const selection = resolvePresentation({ snapshot: snapshot(), query: { profile: 'supplier' }, ...options });
  assert.equal(selection.profile, 'merchant');
  assert.equal(selection.unavailableRequestedProfile, true);
  assert.equal(selection.locale, 'fil-PH');
  assert.equal(selection.format, 'png');
  assert.equal(selection.variant, 'personal_share_v1');
  assert.equal(selection.artwork, 'local-business');
});

test('saved presentation data is allowlisted and isolated by account, with no identity data', () => {
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k) };
  writePresentation(storage, 21, { profile: 'merchant', locale: 'fil-PH', template: 'story', variant: 'clarity_v1', format: 'jpg', artwork: 'community', referralUrl: 'private', referralCode: 'private', name: 'private', csrf: 'secret', imageUrl: 'private' }, options);
  assert.deepEqual(readPresentation(storage, 21, options), { profile: 'merchant', locale: 'fil-PH', template: 'story', variant: 'clarity_v1', format: 'jpg', artwork: 'community' });
  assert.deepEqual(readPresentation(storage, 22, options), {});
  assert.doesNotMatch([...values.values()][0], /private|secret|referral|csrf|name/);
  assert.deepEqual(readPresentation({ getItem: () => '{broken' }, 21, options), {});
});

test('choice links preserve all supported options and reject arbitrary destinations and values', () => {
  const link = presentationPageUrl('/referral/marketing-kit.html', { profile: 'merchant', locale: 'fil-PH', template: 'story', variant: 'clarity_v1', format: 'png', artwork: 'miniature', return: 'https://other.test' }, options);
  const query = new URL(link, 'https://caliof.com').searchParams;
  assert.equal(query.get('template'), 'story');
  assert.equal(query.get('variant'), 'clarity_v1');
  assert.equal(query.get('locale'), 'fil-PH');
  assert.equal(query.get('artwork'), 'miniature');
  assert.equal(query.has('return'), false);
  assert.throws(() => presentationPageUrl('https://other.test/', {}, options));
});

test('artwork choices are restricted to approved IDs with query then account preference precedence', () => {
  for (const id of ['local-business', 'community', 'miniature']) {
    assert.equal(resolvePresentation({ snapshot: snapshot(), query: { artwork: id }, saved: { artwork: 'community' }, ...options }).artwork, id);
  }
  for (const invalid of ['https://external.test/image.png', '/referral/assets/custom.webp', 'missing', '<svg>']) {
    assert.equal(resolvePresentation({ snapshot: snapshot(), query: { artwork: invalid }, saved: { artwork: 'miniature' }, ...options }).artwork, 'miniature');
    assert.equal(resolvePresentation({ snapshot: snapshot(), query: { artwork: invalid }, saved: { artwork: invalid }, ...options }).artwork, 'local-business');
    assert.equal(new URL(presentationPageUrl('/referral/marketing-kit.html', { artwork: invalid }, options), 'https://caliof.com').searchParams.has('artwork'), false);
  }
});

test('referral identity must match both authenticated account and selected profile', () => {
  assert.equal(validateReferralIdentity(identity('merchant'), { accountId: 21, profile: 'merchant' }).profileRole, 'merchant');
  assert.throws(() => validateReferralIdentity(identity('merchant', 22), { accountId: 21, profile: 'merchant' }), /does not match/);
  assert.throws(() => validateReferralIdentity(identity('customer'), { accountId: 21, profile: 'merchant' }), /does not match/);
  assert.throws(() => validateReferralIdentity({ ...identity('merchant'), referralUrl: 'javascript:alert(1)' }, { accountId: 21, profile: 'merchant' }), /Invalid/);
  const wrongQr = identity('merchant'); wrongQr.qr.referralUrl += '&wrong=1';
  assert.equal(validateReferralIdentity(wrongQr, { accountId: 21, profile: 'merchant' }).qrDataUrl, '');
  for (const referralUrl of [
    identity('merchant').referralUrl.replace('https://caliof.com', 'https://someone@caliof.com'),
    identity('merchant').referralUrl.replace('/referral/', '/other/'),
    identity('merchant').referralUrl + '&ref=r1_abcdefghijklmnop',
    identity('merchant').referralUrl + '&profile=customer'
  ]) assert.throws(() => validateReferralIdentity({ ...identity('merchant'), referralUrl }, { accountId: 21, profile: 'merchant' }), /Invalid/);
});

test('authenticated referral payload may use the configured canonical origin across app aliases', () => {
  const payload = identity('merchant');
  payload.referralUrl = payload.referralUrl.replace('caliof.com', 'canonical.example.test');
  payload.qr.referralUrl = payload.referralUrl;
  assert.equal(new URL(validateReferralIdentity(payload, { accountId: 21, profile: 'merchant' }).referralUrl).origin, 'https://canonical.example.test');
});

test('new profile loading clears the loaded identity before the next network response', async () => {
  const f = fixture();
  const first = f.controller.load('merchant'); await tick(); f.respond(0, snapshot()); await tick(); f.respond(1, identity('merchant')); await first;
  assert.equal(f.controller.getCurrent().profile, 'merchant');
  const next = f.controller.load('customer');
  assert.equal(f.controller.getCurrent(), null);
  assert.equal(f.states.at(-1).phase, 'loading');
  await tick(); f.respond(2, snapshot()); await tick(); f.respond(3, identity('customer')); await next;
  f.controller.dispose();
});

test('out-of-order older success never replaces the newest selected profile', async () => {
  const f = fixture();
  const older = f.controller.load('customer'); await tick(); f.respond(0, snapshot()); await tick();
  const newer = f.controller.load('merchant'); await tick(); f.respond(2, snapshot()); await tick();
  f.respond(3, identity('merchant')); await newer;
  f.respond(1, identity('customer')); await older;
  assert.equal(f.controller.getCurrent().profile, 'merchant');
  assert.deepEqual(f.ready.map(value => value.profile), ['merchant']);
  assert.equal(f.requests[1].init.signal.aborted, true);
  f.controller.dispose();
});

test('a late 403 cannot erase a newer successful referral', async () => {
  const f = fixture();
  const older = f.controller.load('customer'); await tick(); f.respond(0, snapshot()); await tick();
  const newer = f.controller.load('merchant'); await tick(); f.respond(2, snapshot()); await tick(); f.respond(3, identity('merchant')); await newer;
  f.respond(1, { error: 'This profile is not enabled' }, 403); await older;
  assert.equal(f.controller.getCurrent().profile, 'merchant');
  assert.equal(f.states.at(-1).phase, 'ready');
  f.controller.dispose();
});

test('account/session change during a response retires the response and exits loading', async () => {
  const f = fixture();
  const request = f.controller.load('merchant'); await tick(); f.respond(0, snapshot()); await tick();
  f.changeSession('session-b'); f.respond(1, identity('merchant')); await request;
  assert.equal(f.controller.getCurrent(), null);
  assert.equal(f.ready.length, 0);
  assert.equal(f.states.at(-1).code, 'session_changed');
  f.controller.dispose();
});

test('auth expiry during a read leaves no usable referral and exposes sign-in state', async () => {
  const f = fixture();
  const request = f.controller.load('merchant'); await tick(); f.respond(0, snapshot()); await tick();
  f.signOut(); f.respond(1, identity('merchant')); await request;
  assert.equal(f.ready.length, 0);
  assert.equal(f.states.at(-1).phase, 'signed_out');
  assert.equal(f.controller.getCurrent(), null);
  f.controller.dispose();
});

test('server response from a different account fails closed even with a matching role', async () => {
  const f = fixture();
  const request = f.controller.load('merchant'); await tick(); f.respond(0, snapshot()); await tick(); f.respond(1, identity('merchant', 22)); await request;
  assert.equal(f.ready.length, 0);
  assert.equal(f.states.at(-1).code, 'invalid_response');
  f.controller.dispose();
});

test('no enabled profiles makes no referral request and does not activate a profile', async () => {
  const f = fixture();
  const request = f.controller.load(); await tick(); f.respond(0, { account: { id: 21 }, profiles: [] }); await request;
  assert.equal(f.requests.length, 1);
  assert.equal(f.states.at(-1).phase, 'empty');
  assert.equal(f.requests[0].init.method, undefined);
  f.controller.dispose();
});

test('an already loaded referral cannot be used after a session switch', async () => {
  const f = fixture();
  const request = f.controller.load('merchant'); await tick(); f.respond(0, snapshot()); await tick(); f.respond(1, identity('merchant')); await request;
  f.changeSession('session-b');
  assert.equal(f.controller.getCurrent(), null);
  assert.equal(f.states.at(-1).code, 'session_changed');
  f.controller.dispose();
});

test('both interface languages have exactly the same nonempty copy keys', () => {
  assert.deepEqual(Object.keys(PROMOTION_COPY['en-PH']).sort(), Object.keys(PROMOTION_COPY['fil-PH']).sort());
  for (const locale of Object.values(PROMOTION_COPY)) for (const value of Object.values(locale)) assert.equal(typeof value === 'string' && value.trim().length > 0, true);
});

test('request deadline includes session readiness before any account fetch', async t => {
  const states = [];
  const controller = createReferralController({
    timeoutMs: 5, session: { ready: new Promise(() => {}), authenticated: () => true },
    fetchImpl: () => { assert.fail('account fetch cannot precede session readiness'); }, onState: state => states.push(state)
  });
  t.after(() => controller.dispose());
  await controller.load();
  assert.equal(controller.getPhase(), 'error');
  assert.equal(states.at(-1).code, 'timeout');
});

test('response-body AbortError becomes a retryable timeout instead of permanent loading', async t => {
  const states = [];
  const controller = createReferralController({
    timeoutMs: 5, session: { ready: Promise.resolve(), authenticated: () => true, csrfToken: () => 'session' },
    fetchImpl: async (_path, { signal }) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Body aborted'), { name: 'AbortError' })), { once: true });
    }) }),
    onState: state => states.push(state)
  });
  t.after(() => controller.dispose());
  await controller.load();
  assert.equal(controller.getPhase(), 'error');
  assert.equal(states.at(-1).code, 'timeout');
  assert.equal(controller.getCurrent(), null);
});

test('an unresponsive fetch still retires at the request deadline', async t => {
  const states = [];
  const controller = createReferralController({
    timeoutMs: 5, session: { ready: Promise.resolve(), authenticated: () => true, csrfToken: () => 'session' },
    fetchImpl: () => new Promise(() => {}), onState: state => states.push(state)
  });
  t.after(() => controller.dispose());
  await controller.load();
  assert.equal(states.at(-1).code, 'timeout');
});
