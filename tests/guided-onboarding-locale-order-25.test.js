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
