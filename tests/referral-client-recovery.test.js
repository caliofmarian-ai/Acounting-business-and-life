import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const analyticsSource = read('public/referral/referral-analytics.js').replace(/^export /gm, '');
const sessionSource = read('public/session-security.js');
const landing = read('public/referral/index.html');
const sampleEvent = {
  event: 'referral_landing_viewed',
  referralCode: 'r1_0123456789abcdef',
  properties: { campaign: 'merchant_referral_v1', source: 'profile', medium: 'referral', source_profile_role: 'merchant' }
};

function client(fetchImpl, { csrf = '', secure = false } = {}) {
  const storage = new Map();
  const context = vm.createContext({
    fetch: fetchImpl, URL, Request, Headers,
    crypto: { randomUUID: () => '01234567-89ab-4cde-8fab-0123456789ab' },
    location: new URL('https://example.test/referral/?profile=merchant'),
    document: { cookie: csrf ? `__Host-abl_csrf=${csrf}` : '', dispatchEvent() {} },
    localStorage: { getItem: () => null, removeItem() {} },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  });
  context.window = context;
  if (secure) vm.runInContext(sessionSource, context);
  vm.runInContext(`${analyticsSource}\nglobalThis.capture = captureReferralEvent;`, context);
  return context.capture;
}

test('referral client rejects HTTP 202 events that the gateway did not accept', async () => {
  for (const reason of ['invalid_referral', 'unknown_referral']) {
    const capture = client(async () => ({ ok: true, status: 202, json: async () => ({ accepted: false, delivered: false, reason }) }));
    assert.equal(await capture(sampleEvent), false, reason);
  }
});

test('referral client distinguishes gateway acceptance from disabled external delivery', async () => {
  for (const reason of ['disabled', 'retention_not_approved', 'project_not_verified', 'posthog_not_configured', 'delivery_error']) {
    const capture = client(async () => ({ ok: true, status: 202, json: async () => ({ accepted: true, delivered: false, reason }) }));
    assert.equal(await capture(sampleEvent), true, reason);
  }
  const delivered = client(async () => ({ ok: true, status: 202, json: async () => ({ accepted: true, delivered: true }) }));
  assert.equal(await delivered(sampleEvent), true);
});

test('referral client fails safely for denied, malformed or unavailable responses', async () => {
  const responses = [
    { ok: false, status: 403, json: async () => ({ error: 'CSRF validation failed' }) },
    { ok: true, status: 202, json: async () => ({}) },
    { ok: true, status: 202, json: async () => ({ accepted: 'true' }) },
    { ok: true, status: 202, json: async () => { throw new SyntaxError('Invalid JSON'); } }
  ];
  for (const response of responses) assert.equal(await client(async () => response)(sampleEvent), false);
  assert.equal(await client(async () => { throw new TypeError('Network unavailable'); })(sampleEvent), false);
});

test('public referral landing loads shared session security before sending signed-in events', async () => {
  const bootstrap = landing.indexOf('<script src="/session-security.js"></script>');
  const referral = landing.indexOf('<script type="module" src="/referral/referral.js"></script>');
  assert.ok(bootstrap >= 0 && bootstrap < referral, 'session security must precede the referral module');
  for (const csrf of ['synthetic-referral-csrf', '']) {
    let request;
    const capture = client(async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202, json: async () => ({ accepted: true, delivered: false, reason: 'disabled' }) };
    }, { csrf, secure: true });
    assert.equal(await capture(sampleEvent), true);
    assert.equal(request.url, '/api/growth/referral-analytics/public');
    assert.equal(request.options.headers.get('X-CSRF-Token'), csrf || null);
    assert.equal(request.options.headers.has('Authorization'), false);
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(JSON.parse(request.options.body).referral_code, sampleEvent.referralCode);
  }
});

test('authenticated referral response is bound to the authenticated account', async () => {
  const server = read('server-auth.js');
  const route = server.slice(server.indexOf("app.get('/api/growth/referral',"), server.indexOf("app.post('/api/growth/referral-analytics/account',"));
  let handler;
  const context = vm.createContext({
    URL,
    auth: Symbol('auth'),
    app: { get: (_path, _auth, fn) => { handler = fn; } },
    pool: { query: async sql => sql.includes('SELECT display_name')
      ? { rowCount: 1, rows: [{ display_name: 'Example', active_role: 'merchant' }] }
      : { rowCount: 1, rows: [{}] } },
    normalizeReferralProfileRole: value => value,
    ensureAccountReferral: async (_pool, accountId) => {
      assert.equal(accountId, 42);
      return { referral_code: sampleEvent.referralCode };
    },
    referralRequestOrigin: () => 'https://example.test',
    buildLiveReferralPayload: ({ code, profileRole }) => ({ code, profileRole, referralUrl: 'https://example.test/referral/?utm_campaign=merchant_referral_v1' }),
    buildLocalReferralQr: async () => ({ marker: 'qr' })
  });
  vm.runInContext(route, context);
  let result;
  await handler({ accountId: 42, query: { profile: 'merchant', account_id: '999' } }, { json: value => { result = value; } }, error => { throw error; });
  assert.equal(result.account_id, 42);
  assert.equal(result.profileRole, 'merchant');
  assert.equal(result.code, sampleEvent.referralCode);
  assert.equal(result.qr.marker, 'qr');
  assert.equal(new URL(result.referralUrl).searchParams.has('account_id'), false);
});
