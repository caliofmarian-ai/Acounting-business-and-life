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
    "let copy={},copyLocale='en-PH',copyLoadEpoch=0,sessionKey='session_A';const copyCache=new Map();\n" +
    "const sessionIdentity=()=>sessionKey;const token=()=>Boolean(sessionKey);\n" +
    "const normalizeLocale=value=>['en-PH','fil-PH'].includes(String(value||''))?String(value):'en-PH';\n" +
    "const activeLocale=()=>copyLocale;\n" + loader +
    "\nreturn { loadCopy,rotateSession:key=>{sessionKey=key}, state:()=>({copy,copyLocale,lang:document.documentElement.lang,cache:copyCache}) };"
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

 
// Guide API responses have an independent async race from locale-pack fetches.
// Execute the actual shipped GET/PUT functions rather than a rewritten mock.
const guideStart=ui.indexOf('function reconcileGuideSession(');
const guideEnd=ui.indexOf('\nfunction removeOverlay()',guideStart);
assert.ok(guideStart>=0&&guideEnd>guideStart,'shipped guide API functions must be extractable');
assert.match(ui,/let guideReadEpoch=0,guideMutationEpoch=0,guideMutationsPending=0,guideWriteTail=null;/);
assert.match(ui,/const sessionIdentity=\(\)=>String\(window\.ABLSession\?\.csrfToken\?\.\(\)\|\|''\);/);
assert.match(ui,/const request=guideWriteTail\?guideWriteTail\.then\(dispatch,dispatch\):dispatch\(\);/);
const guideFlow=ui.slice(guideStart,guideEnd);

function guideApiHarness({holdCopyLocale=null}={}){
  const requests=[],copies=[],renders=[],heldCopy=deferred();
  let authenticated=true,sessionKey='account_A';
  const factory=new Function('api','loadCopy','token','syncLauncher','decorateAccountSettings','scheduleRender','sessionIdentity',
    "let guide=null,guideReadEpoch=0,guideMutationEpoch=0,guideMutationsPending=0,guideWriteTail=null,copyLoadEpoch=0,guideSessionIdentity=null,guideSessionEpoch=0;\n"+
    "let copy={},copyLocale='en-PH',selectedProfileJourneyRole='',languagePickerReturnMode='',missionCenterOpen=false,lastAutoStep='';\n"+
    "const copyCache=new Map(),profileDraftSavedForRole=new Set();function removeOverlay(){};\n"+
    guideFlow+"\nreturn {refreshGuide,updateGuide,current:()=>guide};");
  const functions=factory(
    (path,options={})=>{
      assert.equal(path,'/api/onboarding/guide');
      const request=deferred();
      requests.push({method:options.method||'GET',...request});
      return request.promise;
    },
    locale=>{
      copies.push(locale);
      return locale===holdCopyLocale?heldCopy.promise:Promise.resolve();
    },
    ()=>authenticated,()=>{},()=>{},delay=>renders.push(delay),()=>sessionKey
  );
  return {...functions,requests,copies,renders,
    respond(index,value){assert.ok(requests[index]);requests[index].resolve(value)},
    reject(index,error){assert.ok(requests[index]);requests[index].reject(error)},
    logout(){authenticated=false;sessionKey=''},
    switchAccount(){sessionKey='account_B';authenticated=true},
    releaseCopy(){heldCopy.resolve()}
  };
}

test('old guide GET cannot undo a newer confirmed Filipino locale PUT',async()=>{
  const h=guideApiHarness();
  const old=h.refreshGuide({render:false});
  const update=h.updateGuide({action:'set_locale',locale:'fil-PH'},{render:false});
  assert.deepEqual(h.requests.map(x=>x.method),['GET','PUT']);
  h.respond(1,{preferred_locale:'fil-PH',version:'confirmed-newer'});await update;
  h.respond(0,{preferred_locale:'en-PH',version:'obsolete-get'});await old;
  assert.equal(h.current().preferred_locale,'fil-PH');
  assert.equal(h.current().version,'confirmed-newer');
  assert.deepEqual(h.copies,['fil-PH']);
});

test('older guide refresh cannot replace the newer GET response',async()=>{
  const h=guideApiHarness();
  const first=h.refreshGuide({render:false});
  const second=h.refreshGuide({render:false});
  h.respond(1,{preferred_locale:'fil-PH',version:'newer-read'});await second;
  h.respond(0,{preferred_locale:'en-PH',version:'older-read'});await first;
  assert.equal(h.current().version,'newer-read');
  assert.deepEqual(h.copies,['fil-PH']);
});

test('guide GET started during a pending write cannot race ahead of that write',async()=>{
  const h=guideApiHarness();
  const write=h.updateGuide({action:'set_locale',locale:'fil-PH'},{render:false});
  const read=h.refreshGuide({render:false});
  h.respond(1,{preferred_locale:'en-PH',version:'pre-write-get'});await read;
  assert.equal(h.current(),null);
  h.respond(0,{preferred_locale:'fil-PH',version:'confirmed'});await write;
  assert.equal(h.current().version,'confirmed');
  assert.deepEqual(h.copies,['fil-PH']);
});

test('guide refresh started after a completed write remains functional',async()=>{
  const h=guideApiHarness();
  const write=h.updateGuide({action:'set_locale',locale:'fil-PH'},{render:false});
  h.respond(0,{preferred_locale:'fil-PH'});await write;
  const read=h.refreshGuide({render:false});
  h.respond(1,{preferred_locale:'en-PH',version:'legitimate-new-read'});await read;
  assert.equal(h.current().version,'legitimate-new-read');
  assert.deepEqual(h.copies,['fil-PH','en-PH']);
});

test('guide GET loses UI authority if a PUT begins while translations are pending',async()=>{
  const h=guideApiHarness({holdCopyLocale:'en-PH'});
  const old=h.refreshGuide();
  h.respond(0,{preferred_locale:'en-PH'});await drainMicrotasks();
  assert.deepEqual(h.copies,['en-PH']);
  const write=h.updateGuide({action:'set_locale',locale:'fil-PH'});
  h.respond(1,{preferred_locale:'fil-PH',version:'newer'});await write;
  h.releaseCopy();await old;
  assert.equal(h.current().preferred_locale,'fil-PH');
  assert.deepEqual(h.renders,[20],'superseded GET must not schedule another render');
});

test('guide read resolving after logout is ignored without activating copy',async()=>{
  const h=guideApiHarness();
  const old=h.refreshGuide({render:false});
  h.logout();
  h.respond(0,{preferred_locale:'fil-PH',private_account_fixture:true});
  await old;
  assert.equal(h.current(),null);
  assert.deepEqual(h.copies,[]);
});

test('overlapping guide PUTs dispatch in user order; an older locale cannot replace the newer one',async()=>{
  const h=guideApiHarness();
  const first=h.updateGuide({action:'set_locale',locale:'fil-PH'});
  const later=h.updateGuide({action:'set_locale',locale:'en-PH'});
  assert.deepEqual(h.requests.map(r=>r.method),['PUT'],'the second PUT must wait for first write acknowledgement');
  h.respond(0,{preferred_locale:'fil-PH',version:'older'});
  await drainMicrotasks();
  assert.equal(h.requests.length,2,'newer PUT must dispatch after prior write');
  assert.deepEqual(h.copies,[],'superseded first PUT must not paint an outdated locale');
  h.respond(1,{preferred_locale:'en-PH',version:'newer'});
  await Promise.all([first,later]);
  assert.equal(h.current().preferred_locale,'en-PH');
  assert.equal(h.current().version,'newer');
  assert.deepEqual(h.copies,['en-PH']);
  assert.deepEqual(h.renders,[20]);
});

test('failed earlier guide PUT does not poison a queued subsequent update',async()=>{
  const h=guideApiHarness();
  const failed=h.updateGuide({action:'set_locale',locale:'fil-PH'},{render:false});
  // Attach rejection handling immediately, before the deliberate async failure.
  // The final Promise.allSettled still verifies that the original PUT rejected.
  failed.catch(()=>{});
  const valid=h.updateGuide({action:'set_locale',locale:'en-PH'},{render:false});
  assert.equal(h.requests.length,1);
  h.reject(0,new Error('synthetic temporary PUT rejection'));
  await drainMicrotasks();
  assert.equal(h.requests.length,2,'subsequent PUT still starts after failure');
  h.respond(1,{preferred_locale:'en-PH',version:'retry-success'});
  const outcomes=await Promise.allSettled([failed,valid]);
  assert.equal(outcomes[0].status,'rejected');
  assert.equal(outcomes[1].status,'fulfilled');
  assert.equal(h.current().version,'retry-success');
  assert.deepEqual(h.copies,['en-PH']);
  const read=h.refreshGuide({render:false});
  assert.equal(h.requests.length,3,'after both writes finish a regular refresh must work');
  h.respond(2,{preferred_locale:'en-PH',version:'normal-read'});await read;
  assert.equal(h.current().version,'normal-read');
});

test('a newer PUT may proceed while an older response is waiting for its locale pack',async()=>{
  const h=guideApiHarness({holdCopyLocale:'fil-PH'});
  const first=h.updateGuide({action:'set_locale',locale:'fil-PH'});
  h.respond(0,{preferred_locale:'fil-PH',version:'first'});
  await drainMicrotasks();
  assert.deepEqual(h.copies,['fil-PH']);
  const later=h.updateGuide({action:'set_locale',locale:'en-PH'});
  assert.equal(h.requests.length,2,'write queue must not wait for older locale download');
  h.respond(1,{preferred_locale:'en-PH',version:'second'});
  await later;
  h.releaseCopy();await first;
  assert.equal(h.current().version,'second');
  assert.equal(h.current().preferred_locale,'en-PH');
  assert.deepEqual(h.renders,[20],'first stale completion cannot rerender');
});

test('confirmed guide PUT arriving after logout cannot activate private tutorial state',async()=>{
  const h=guideApiHarness();
  const write=h.updateGuide({action:'set_locale',locale:'fil-PH'});
  h.logout();
  h.respond(0,{preferred_locale:'fil-PH',account_marker:'private-fixture'});
  await write;
  assert.equal(h.current(),null);
  assert.deepEqual(h.copies,[]);
  assert.deepEqual(h.renders,[]);
});

test('an A guide GET finishing under authenticated B cannot show private A guidance',async()=>{
  const h=guideApiHarness();
  const old=h.refreshGuide();
  h.switchAccount();
  h.respond(0,{preferred_locale:'fil-PH',private_owner:'account_A'});
  const result=await old;
  assert.equal(result,null);
  assert.equal(h.current(),null);
  assert.deepEqual(h.copies,[]);
  assert.deepEqual(h.renders,[]);
});

test('an A guide PUT response after B login cannot commit old private guide',async()=>{
  const h=guideApiHarness();
  const old=h.updateGuide({action:'set_locale',locale:'fil-PH'});
  h.switchAccount();
  h.respond(0,{preferred_locale:'fil-PH',private_owner:'account_A'});
  assert.equal(await old,null);
  assert.equal(h.current(),null);
  assert.deepEqual(h.copies,[]);
});

test('queued old-account PUT never dispatches under B; new B PUT is independent',async()=>{
  const h=guideApiHarness();
  const first=h.updateGuide({action:'set_locale',locale:'fil-PH'},{render:false});
  const queued=h.updateGuide({action:'set_locale',locale:'en-PH'},{render:false});
  assert.equal(h.requests.length,1);
  h.switchAccount();
  const fresh=h.updateGuide({action:'set_locale',locale:'en-PH'},{render:false});
  assert.equal(h.requests.length,2,'B write must not wait for A pending request');
  h.respond(1,{preferred_locale:'en-PH',private_owner:'account_B'});await fresh;
  h.respond(0,{preferred_locale:'fil-PH',private_owner:'account_A'});
  const result=await Promise.allSettled([first,queued]);
  assert.equal(result[0].status,'fulfilled');
  assert.equal(result[1].status,'rejected','queued A write must fail before API dispatch');
  assert.match(String(result[1].reason?.message),/session changed/);
  assert.equal(h.requests.length,2,'no queued A POST is sent under B');
  assert.equal(h.current().private_owner,'account_B');
});

test('old A guide state is cleared on session transition before new B read resolves',async()=>{
  const h=guideApiHarness();
  const old=h.refreshGuide({render:false});
  h.respond(0,{preferred_locale:'en-PH',private_owner:'account_A'});await old;
  assert.equal(h.current().private_owner,'account_A');
  h.switchAccount();
  const fresh=h.refreshGuide({render:false});
  assert.equal(h.current(),null,'previous account guide must be discarded synchronously');
  h.respond(1,{preferred_locale:'fil-PH',private_owner:'account_B'});await fresh;
  assert.equal(h.current().private_owner,'account_B');
});

test('old locale-pack response cannot activate across a rotated account session',async()=>{
  const h=harness();
  const old=h.loadCopy('fil-PH');
  h.rotateSession('session_B');
  h.complete(0,fil);await old;
  assert.equal(h.state().copyLocale,'en-PH');
  assert.deepEqual(h.state().copy,{});
  assert.equal(h.state().cache.has('fil-PH'),false,'old account cache must not be populated');
});
