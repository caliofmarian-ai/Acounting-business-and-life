import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CONTROLLED_ROLE_FIXTURE_CONTRACT,
  controlledBusinessTerritoryAction,
  controlledCourierEvidencePdf,
  controlledRoleFixtureConfig,
  controlledRoleFixtureGateRequired,
  deriveControlledRolePassword,
  runControlledRoleFixturesIfRequested
} from '../controlled-role-fixtures.js';

const revision='1234567890abcdef1234567890abcdef12345678';
const secret='controlled-role-fixture-secret-that-is-long-enough';
const base={
  CONTROLLED_ROLE_FIXTURE_WAVE:'operational_v1',
  CONTROLLED_ROLE_FIXTURE_ACK:'non_settling_private_v1',
  CONTROLLED_ROLE_FIXTURE_SECRET:secret,
  RAILWAY_GIT_COMMIT_SHA:revision,
  AUTH_PREVIEW_SHOW_LINK:'false',
  OWNER_MIGRATION_ENABLED:'false',
  QA_PH_TEST_CONTEXT:'false',
  QA_REMOTE_TEST_EMAIL:''
};
const preview={
  ...base,RAILWAY_SERVICE_NAME:'accounting-preview',APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',PAYMONGO_LIVE_ENABLED:'false'
};
const production={
  ...base,RAILWAY_SERVICE_NAME:'accounting-business-life',APP_ENV:'production',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting',
  PAYMONGO_MODE:'live',PAYMONGO_LIVE_ENABLED:'true',QA_ACCEPTANCE_WAVE:''
};

test('controlled role fixture gate is explicit and defaults off',async()=>{
  assert.equal(controlledRoleFixtureGateRequired({}),false);
  assert.equal(controlledRoleFixtureGateRequired(preview),true);
  const skipped=await runControlledRoleFixturesIfRequested({pool:null,port:0,env:{}});
  assert.deepEqual(skipped,{status:'SKIPPED',wave:''});
});

test('controlled role fixture runtime policy accepts only named Preview or Production',()=>{
  const previewConfig=controlledRoleFixtureConfig(preview);
  assert.equal(previewConfig.environment,'preview');
  assert.equal(previewConfig.psgcCode,'0402103028');
  assert.equal(previewConfig.revision,revision);

  const productionConfig=controlledRoleFixtureConfig(production);
  assert.equal(productionConfig.environment,'production');

  assert.throws(()=>controlledRoleFixtureConfig({...preview,CONTROLLED_ROLE_FIXTURE_ACK:'wrong'}),/acknowledgement/i);
  assert.throws(()=>controlledRoleFixtureConfig({...preview,CONTROLLED_ROLE_FIXTURE_SECRET:'short'}),/32 characters/i);
  assert.throws(()=>controlledRoleFixtureConfig({...preview,RAILWAY_SERVICE_NAME:'another-service'}),/named Preview or Production/i);
  assert.throws(()=>controlledRoleFixtureConfig({...preview,DATABASE_URL:'postgresql://user:secret@example.test/accounting'}),/isolated|QA database/i);
  assert.throws(()=>controlledRoleFixtureConfig({...preview,PAYMONGO_MODE:'live',PAYMONGO_LIVE_ENABLED:'true'}),/TEST mode|live payments/i);
  assert.throws(()=>controlledRoleFixtureConfig({...production,QA_ACCEPTANCE_WAVE:'profile_lifecycle_atomic_v1'}),/cannot run with a QA/i);
  assert.throws(()=>controlledRoleFixtureConfig({...production,RAILWAY_GIT_COMMIT_SHA:'main'}),/immutable deployment revision/i);
});

test('credentials are deterministic only for the three controlled role aliases',()=>{
  const supplier=deriveControlledRolePassword(secret,'dropi.deliveries+testsupplier@gmail.com');
  assert.equal(supplier,deriveControlledRolePassword(secret,'dropi.deliveries+testsupplier@gmail.com'));
  assert.notEqual(supplier,deriveControlledRolePassword(secret,'dropi.deliveries+testcourier@gmail.com'));
  assert.ok(supplier.length>=40);
  assert.throws(()=>deriveControlledRolePassword(secret,'dropi.deliveries+testmerchant@gmail.com'),/restricted/i);
  assert.throws(()=>deriveControlledRolePassword(secret,'person@example.com'),/restricted/i);
});

test('legacy Preview businesses are preserved while Production rejects territory drift',()=>{
  assert.equal(controlledBusinessTerritoryAction({
    environment:'preview',currentTerritoryId:9,fixtureTerritoryId:12
  }),'preserve_preview');
  assert.equal(controlledBusinessTerritoryAction({
    environment:'production',currentTerritoryId:null,fixtureTerritoryId:12
  }),'assign');
  assert.equal(controlledBusinessTerritoryAction({
    environment:'production',currentTerritoryId:12,fixtureTerritoryId:12
  }),'keep');
  assert.equal(controlledBusinessTerritoryAction({
    environment:'production',currentTerritoryId:9,fixtureTerritoryId:12
  }),'reject');
});

test('fixture contract is isolated, private and non-settling by construction',()=>{
  assert.deepEqual(CONTROLLED_ROLE_FIXTURE_CONTRACT.roles.map(item=>item.role),[
    'supplier','courier','service_provider'
  ]);
  assert.deepEqual(CONTROLLED_ROLE_FIXTURE_CONTRACT.roles.map(item=>item.email),[
    'dropi.deliveries+testsupplier@gmail.com',
    'dropi.deliveries+testcourier@gmail.com',
    'dropi.deliveries+testservice@gmail.com'
  ]);
  const source=readFileSync(new URL('../controlled-role-fixtures.js',import.meta.url),'utf8');
  assert.match(source,/settlement_mode='blocked'/);
  assert.match(source,/visibility='private'/);
  assert.match(source,/cross-role access was not denied/);
  assert.match(source,/credential_secret_persisted:false/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*config\.secret/);
  assert.doesNotMatch(source,/INSERT INTO (?:transactions|payment_intents|orders|deliveries)\b/i);
});

test('Courier evidence is a valid private PDF declaration without personal identity claims',()=>{
  const pdf=controlledCourierEvidencePdf({psgcCode:'0402103028',areaName:'Queens Row West'});
  assert.equal(pdf.subarray(0,5).toString('ascii'),'%PDF-');
  const text=pdf.toString('utf8');
  assert.match(text,/Company-managed test identity/);
  assert.match(text,/Vehicle class: motorcycle/);
  assert.match(text,/0402103028/);
  assert.match(text,/non-settling/);
  assert.match(text,/no natural person/i);
  assert.doesNotMatch(text,/driver.?license|home address|phone number/i);
});
