import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the actual shipped async loader with controlled browser fetches.
// No database, network, payment, or account is touched by these tests.
const ui = readFileSync(new URL('../public/guided-onboarding.js', import.meta.url), 'utf8');
const beginning = ui.indexOf('async function loadCopy(');
const ending = ui.indexOf('\n\nasync function api(', beginning);
assert.ok(beginning >= 0 && ending > beginning, 'shipped loader source must be extractable');
assert.match(ui, /const copyCache=new Map\(\);\s*let copyLoadEpoch=0;/);
const loader = ui.slice(beginning, ending);

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function harness() {
  const requests = [];
  const fetch = url => {
    const pending = deferred();
    requests.push({ url, ...pending });
    return pending.promise;
  };
  const document = { documentElement: { lang: 'en-PH' } };
  const factory = new Function('fetch', 'document',
    "let copy={},copyLocale='en-PH',copyLoadEpoch=0;const copyCache=new Map();\n" +
    "const normalizeLocale=value=>['en-PH','fil-PH'].includes(String(value||''))?String(value):'en-PH';\n" +
    "const activeLocale=()=>copyLocale;\n" + loader +
    "\nreturn { loadCopy, state:()=>({copy,copyLocale,lang:document.documentElement.lang,cache:copyCache}) };"
  );
  return { ...factory(fetch, document), requests, complete(index, pack, ok=true) {
    assert.ok(requests[index], 'expected an actual fetch request');
    requests[index].resolve({ ok, json: async () => pack });
  } };
}
const en = { 'meta.locale': 'en-PH', hello: 'Hello' };
const fil = { 'meta.locale': 'fil-PH', hello: 'Kumusta' };

test('latest language choice wins when older fetch resolves after it', async () => {
  const h = harness();
  const oldFil = h.loadCopy('fil-PH');
  const newEn = h.loadCopy('en-PH');
  assert.equal(h.requests.length, 2);
  h.complete(1, en); await newEn;
  assert.equal(h.state().copyLocale, 'en-PH');
  h.complete(0, fil); await oldFil;
  assert.deepEqual(h.state().copy, en);
  assert.equal(h.state().copyLocale, 'en-PH');
  assert.equal(h.state().lang, 'en-PH');
});

test('cached language switch invalidates an older in-flight fetch', async () => {
  const h = harness();
  const seed = h.loadCopy('en-PH');
  h.complete(0, en); await seed;
  const staleFil = h.loadCopy('fil-PH');
  await h.loadCopy('en-PH'); // cache hit still constitutes newer intent
  h.complete(1, fil); await staleFil;
  assert.equal(h.state().lang, 'en-PH');
  assert.equal(h.state().copy.hello, 'Hello');
});

test('stale failed fetch does not force English over later Filipino selection', async () => {
  const h = harness();
  const oldEn = h.loadCopy('en-PH');
  const newFil = h.loadCopy('fil-PH');
  h.complete(1, fil); await newFil;
  h.requests[0].reject(new Error('stale offline failure')); await oldEn;
  assert.equal(h.requests.length, 2, 'stale rejection must not spawn fallback');
  assert.equal(h.state().lang, 'fil-PH');
  assert.equal(h.state().copy.hello, 'Kumusta');
});

test('current failed Filipino fetch falls back to English', async () => {
  const h = harness();
  const pending = h.loadCopy('fil-PH');
  h.complete(0, null, false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, '/locales/guided-onboarding.en-PH.json');
  h.complete(1, en); await pending;
  assert.equal(h.state().lang, 'en-PH');
  assert.equal(h.state().copy.hello, 'Hello');
});

test('later explicit Filipino choice uses cached successful pack', async () => {
  const h = harness();
  const firstFil = h.loadCopy('fil-PH');
  const secondEn = h.loadCopy('en-PH');
  h.complete(1, en); await secondEn;
  h.complete(0, fil); await firstFil;
  assert.equal(h.state().copyLocale, 'en-PH');
  await h.loadCopy('fil-PH');
  assert.equal(h.requests.length, 2, 'cached pack avoids extra fetch');
  assert.equal(h.state().copyLocale, 'fil-PH');
  assert.equal(h.state().lang, 'fil-PH');
});

// Fetch completion and JSON decoding are separate await boundaries. Hold the
// body promise explicitly so these cases cannot pass by resolving both at once.
function pendingJson(h, index) {
  assert.ok(h.requests[index], 'expected a pending fetch');
  const body = deferred(), started = deferred();
  h.requests[index].resolve({ ok: true, json() {
    started.resolve();
    return body.promise;
  } });
  return { ...body, started: started.promise };
}
const drainMicrotasks = () => new Promise(resolve => setImmediate(resolve));

test('late JSON body cannot overwrite a language chosen after headers arrived', { timeout: 1000 }, async () => {
  const h = harness(), oldFil = h.loadCopy('fil-PH');
  const body = pendingJson(h, 0); await body.started;
  const newEn = h.loadCopy('en-PH');
  h.complete(1, en); await newEn;
  body.resolve(fil); await oldFil;
  assert.deepEqual(h.state().copy, en);
  assert.equal(h.state().copyLocale, 'en-PH');
  assert.equal(h.state().lang, 'en-PH');
});

test('stale Filipino JSON rejection cannot launch an English fallback', { timeout: 1000 }, async () => {
  const h = harness(), oldFil = h.loadCopy('fil-PH');
  const body = pendingJson(h, 0); await body.started;
  const newFil = h.loadCopy('fil-PH');
  h.complete(1, fil); await newFil;
  body.reject(new SyntaxError('synthetic stale JSON failure')); await drainMicrotasks();
  assert.equal(h.requests.length, 2, 'stale failed Filipino body must not start fallback');
  await oldFil;
  assert.deepEqual(h.state().copy, fil);
  assert.equal(h.state().lang, 'fil-PH');
});

test('older same-locale response cannot replace a newer cached pack', { timeout: 1000 }, async () => {
  const h = harness(), oldFil = h.loadCopy('fil-PH'), newFil = h.loadCopy('fil-PH');
  const newer = { ...fil, hello: 'Newer Filipino copy' };
  h.complete(1, newer); await newFil;
  h.complete(0, fil); await oldFil;
  assert.deepEqual(h.state().cache.get('fil-PH'), newer);
  const switchEn = h.loadCopy('en-PH'); h.complete(2, en); await switchEn;
  await h.loadCopy('fil-PH');
  assert.equal(h.requests.length, 3, 'switch back must use the retained newer cache');
  assert.deepEqual(h.state().copy, newer);
  assert.equal(h.state().copyLocale, 'fil-PH');
});

test('an English fallback already decoding JSON yields to a newer Filipino choice', { timeout: 1000 }, async () => {
  const h = harness(), original = h.loadCopy('fil-PH');
  h.complete(0, null, false); await drainMicrotasks();
  assert.equal(h.requests[1].url, '/locales/guided-onboarding.en-PH.json');
  const fallback = pendingJson(h, 1); await fallback.started;
  const newer = h.loadCopy('fil-PH'); h.complete(2, fil); await newer;
  fallback.resolve(en); await original;
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.state().copy, fil);
  assert.equal(h.state().copyLocale, 'fil-PH');
  assert.equal(h.state().lang, 'fil-PH');
});

test('current Filipino JSON decoding failure still uses English fallback', { timeout: 1000 }, async () => {
  const h = harness(), pending = h.loadCopy('fil-PH');
  const body = pendingJson(h, 0); await body.started;
  body.reject(new SyntaxError('synthetic current JSON failure')); await drainMicrotasks();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, '/locales/guided-onboarding.en-PH.json');
  h.complete(1, en); await pending;
  assert.deepEqual(h.state().copy, en);
  assert.equal(h.state().lang, 'en-PH');
});

test('current English decoding failure ends safely without recursive fallback', { timeout: 1000 }, async () => {
  const h = harness(), seed = h.loadCopy('fil-PH'); h.complete(0, fil); await seed;
  const pending = h.loadCopy('en-PH'), body = pendingJson(h, 1); await body.started;
  body.reject(new SyntaxError('synthetic English JSON failure')); await pending;
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.state().copy, {});
  assert.equal(h.state().copyLocale, 'en-PH');
  assert.equal(h.state().lang, 'en-PH');
});
