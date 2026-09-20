import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireSafeQaRuntime } from '../scripts/provision-company-test-accounts.js';

const safeEnv = {
  RAILWAY_SERVICE_NAME: 'accounting-preview',
  APP_ENV: 'qa',
  DATABASE_URL: 'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE: 'test',
  PAYMONGO_LIVE_ENABLED: 'false',
  AUTH_PREVIEW_SHOW_LINK: 'false',
  OWNER_MIGRATION_ENABLED: 'false'
};

test('controlled company test fixture provisioning is QA-only', () => {
  const state = requireSafeQaRuntime(safeEnv);
  assert.equal(state.previewService, true);
  assert.equal(state.databaseName, 'accounting_qa');

  assert.throws(
    () => requireSafeQaRuntime({ ...safeEnv, RAILWAY_SERVICE_NAME: 'accounting-business-life', APP_ENV: 'production', DATABASE_URL: 'postgresql://user:secret@example.test/accounting' }),
    /isolated QA|production/i
  );
  assert.throws(
    () => requireSafeQaRuntime({ ...safeEnv, DATABASE_URL: 'postgresql://user:secret@example.test/accounting' }),
    /isolated|QA/i
  );
  assert.throws(
    () => requireSafeQaRuntime({ ...safeEnv, PAYMONGO_MODE: 'live', PAYMONGO_LIVE_ENABLED: 'true' }),
    /TEST mode|live/i
  );
});

test('fixture script creates identities without silently granting privileges or verification', () => {
  const source = readFileSync(new URL('../scripts/provision-company-test-accounts.js', import.meta.url), 'utf8');
  assert.match(source, /email_verified_at=NULL/);
  assert.match(source, /privileges_granted: false/);
  assert.match(source, /test_role='super_admin'/);
  assert.match(source, /account_mode='company_test'/);
  assert.doesNotMatch(source, /INSERT INTO platform_admin_assignments/i);
  assert.doesNotMatch(source, /INSERT INTO profile_authorizations/i);
});
