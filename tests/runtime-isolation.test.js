import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRuntimeSafety} from '../runtime-safety.js';

const preview={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa?sslmode=require',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  AUTH_PREVIEW_SHOW_LINK:'true'
};

test('QA runtime accepts an isolated database and test-only payments',()=>{
  assert.equal(validateRuntimeSafety(preview).databaseName,'accounting_qa');
});

test('QA runtime refuses the production database, production environment, and live payments',()=>{
  assert.throws(()=>validateRuntimeSafety({...preview,DATABASE_URL:'postgresql://user:secret@example.test/accounting'}),/isolated/);
  assert.throws(()=>validateRuntimeSafety({...preview,APP_ENV:'production'}),/APP_ENV=qa/);
  assert.throws(()=>validateRuntimeSafety({...preview,PAYMONGO_MODE:'live'}),/test mode only/);
  assert.throws(()=>validateRuntimeSafety({...preview,PAYMONGO_LIVE_ENABLED:'true'}),/live payments disabled/);
});

test('production refuses QA data and preview-only verification links',()=>{
  const production={
    RAILWAY_SERVICE_NAME:'accounting-business-life',
    APP_ENV:'production',
    DATABASE_URL:'postgresql://user:secret@example.test/accounting',
    PAYMONGO_MODE:'test',
    PAYMONGO_LIVE_ENABLED:'false',
    AUTH_PREVIEW_SHOW_LINK:'false'
  };
  assert.equal(validateRuntimeSafety(production).databaseName,'accounting');
  assert.throws(()=>validateRuntimeSafety({...production,DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa'}),/production cannot use/);
  assert.throws(()=>validateRuntimeSafety({...production,AUTH_PREVIEW_SHOW_LINK:'true'}),/preview verification links/);
});
