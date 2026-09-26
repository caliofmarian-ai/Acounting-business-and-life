import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaPhTestContextConfig} from '../qa-ph-test-context.js';
import {validateRuntimeSafety} from '../runtime-safety.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const qa=read('qa-ph-test-context.js');
const paymongo=read('server-paymongo.js');
const hardening=read('server-auth-hardening.js');
const ui=read('public/auth-hardening-ui.js');
const css=read('public/auth-hardening.css');

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true',
  QA_PH_TEST_CONTEXT:'true'
};

test('QA Philippines test context is isolated to accounting-preview QA data',()=>{
  const config=qaPhTestContextConfig(safe);
  assert.equal(config.enabled,true);
  assert.equal(config.country_code,'PH');
  assert.equal(config.runtime.databaseName,'accounting_qa');
  assert.throws(()=>qaPhTestContextConfig({...safe,RAILWAY_SERVICE_NAME:'accounting-business-life',APP_ENV:'production',DATABASE_URL:'postgresql://user:secret@example.test/accounting'}),/only on isolated accounting-preview QA data/);
});

test('production runtime fails closed if QA Philippines test context is accidentally enabled',()=>{
  const production={
    RAILWAY_SERVICE_NAME:'accounting-business-life',
    APP_ENV:'production',
    DATABASE_URL:'postgresql://user:secret@example.test/accounting',
    PAYMONGO_MODE:'test',
    PAYMONGO_LIVE_ENABLED:'false',
    AUTH_PREVIEW_SHOW_LINK:'false',
    QA_PH_TEST_CONTEXT:'true'
  };
  assert.throws(()=>validateRuntimeSafety(production),/production cannot enable QA Philippines test context/);
});

test('QA pilot bootstrap uses official PSGC and exact structural lifecycle hierarchy',()=>{
  assert.match(qa,/syncPhGeographicRegistry/);
  assert.match(qa,/0400000000/);
  assert.match(qa,/0402100000/);
  assert.match(qa,/0402103000/);
  assert.match(qa,/0402103028/);
  assert.match(qa,/Queens Row West/);
  assert.match(qa,/status:'planned'/);
  assert.match(qa,/status:'onboarding'/);
  assert.doesNotMatch(qa,/INSERT INTO profiles/);
  assert.doesNotMatch(qa,/platform_admin_assignments/);
});

test('QA PH test context is initialized only after the embedded application chain is ready',()=>{
  assert.match(paymongo,/ensureQaPhTestContext/);
  assert.match(paymongo,/QA_PH_TEST_CONTEXT_READY/);
  const start=paymongo.indexOf('startEmbeddedPaymentCore()');
  const init=paymongo.indexOf('return initDb()',start);
  assert.ok(start>=0&&init>start);
});

test('preview authentication explicitly explains remote Philippines test geography',()=>{
  assert.match(hardening,/qa_preview_context/);
  assert.match(hardening,/device_location_authoritative:false/);
  assert.match(ui,/Philippines QA test context/);
  assert.match(ui,/physical device location is not used as the Business & Life test territory/);
  assert.match(css,/\.modernQaContext/);
});

test('QA context disabled by default creates no test geography side effect',()=>{
  const config=qaPhTestContextConfig({...safe,QA_PH_TEST_CONTEXT:'false'});
  assert.equal(config.enabled,false);
});
