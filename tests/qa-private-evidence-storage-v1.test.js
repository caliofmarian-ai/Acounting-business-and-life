import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qaAcceptanceConfig,PRIVATE_EVIDENCE_STORAGE_V1_WAVE} from '../qa-acceptance.js';

const safe={
  RAILWAY_SERVICE_NAME:'accounting-preview',
  APP_ENV:'qa',
  DATABASE_URL:'postgresql://user:secret@example.test/accounting_qa',
  PAYMONGO_MODE:'test',
  PAYMONGO_LIVE_ENABLED:'false',
  OWNER_MIGRATION_ENABLED:'false',
  QA_AUTOMATION_SECRET:'x'.repeat(48),
  QA_ACCEPTANCE_WAVE:PRIVATE_EVIDENCE_STORAGE_V1_WAVE
};

test('private evidence Railway acceptance wave is registered only on isolated QA runtime',()=>{
  const cfg=qaAcceptanceConfig(safe);
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.wave,'private_evidence_storage_v1');
});

test('private evidence acceptance covers clean storage quarantine authorization headers and migration',()=>{
  const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
  for(const marker of [
    'PRIVATE_EVIDENCE_STORAGE_V1_WAVE',
    'Private evidence EICAR quarantine',
    'Cross-account private evidence read did not fail closed.',
    'content-disposition',
    'x-content-type-options',
    'cache-control',
    'migratePrivateEvidenceV1',
    'Legacy private evidence migration is not idempotent',
    'private_evidence_access_audit'
  ])assert.ok(source.includes(marker),'missing private evidence QA marker: '+marker);
});
