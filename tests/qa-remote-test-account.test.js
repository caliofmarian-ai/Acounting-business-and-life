import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaRemoteTestAccountConfig,isQaRemoteTestEmail,qaRemoteTestAccountState} from '../qa-remote-test-account.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const runtime=read('runtime-safety.js');
const auth=read('server-auth.js');
const hardening=read('server-auth-hardening.js');
const ui=read('public/auth-hardening-ui.js');
const shell=read('public/shell.js');

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true',
  QA_PH_TEST_CONTEXT:'true',
  QA_REMOTE_TEST_EMAIL:'owner.remote.qa@example.test'
};

test('remote PH override is disabled when no designated QA email exists',()=>{
  const cfg=qaRemoteTestAccountConfig({...safe,QA_REMOTE_TEST_EMAIL:''});
  assert.equal(cfg.enabled,false);
  assert.equal(isQaRemoteTestEmail('owner.remote.qa@example.test',{...safe,QA_REMOTE_TEST_EMAIL:''}),false);
});

test('only the exact designated QA email receives the remote-test marker',()=>{
  assert.equal(isQaRemoteTestEmail('OWNER.REMOTE.QA@example.test',safe),true);
  assert.equal(isQaRemoteTestEmail('other@example.test',safe),false);
  assert.deepEqual(qaRemoteTestAccountState({email:'owner.remote.qa@example.test'},safe),{
    enabled:true,mode:'designated_remote_ph_test',country_code:'PH'
  });
  assert.equal(qaRemoteTestAccountState({email:'other@example.test'},safe).enabled,false);
});

test('production rejects any configured QA remote-test identity',()=>{
  const production={
    ...safe,
    RAILWAY_SERVICE_NAME:'accounting-business-life',
    APP_ENV:'production',
    DATABASE_URL:'postgresql://user:secret@example.test/accounting',
    AUTH_PREVIEW_SHOW_LINK:'false',
    QA_PH_TEST_CONTEXT:'false'
  };
  assert.throws(()=>qaRemoteTestAccountConfig(production),/production cannot configure a QA remote test account/);
  assert.match(runtime,/production cannot configure a QA remote test account/);
});

test('server accepts qa_remote_test only for the designated email and records explicit source',()=>{
  assert.match(auth,/qaRemoteRequested/);
  assert.match(auth,/isQaRemoteTestEmail\(email\)/);
  assert.match(auth,/Remote PH testing is available only to the designated QA test account/);
  assert.match(auth,/qa_remote_ph_test/);
  assert.match(auth,/qaRemoteTestAccountState/);
});

test('public preview status never claims a global location bypass',()=>{
  assert.match(hardening,/remote_override_scope:'designated_account_only'/);
  assert.doesNotMatch(hardening,/device_location_authoritative:false/);
  assert.match(ui,/Standard location rules remain active/);
  assert.match(ui,/all other accounts follow normal location controls/);
});

test('remote QA control appears only when infrastructure configured it and remains server-gated',()=>{
  assert.match(ui,/remote_override_configured/);
  assert.match(ui,/regQaRemoteTest/);
  assert.match(ui,/qa_remote_test:Boolean\(document\.getElementById\('regQaRemoteTest'\)\?\.checked\)/);
  assert.match(shell,/qa_remote_test:Boolean\(snapshot\?\.qa_remote_test\?\.enabled\)/);
});
