import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('all six private evidence surfaces use the shared object boundary',()=>{
  const incident=read('server-incidents.js');
  const support=read('server-admin-operations.js');
  const delivery=read('server-delivery.js');
  const governance=read('server-profile-governance.js');
  const services=read('server-services.js');

  for(const [label,source] of [
    ['Incident',incident],['Support',support],['Courier',delivery],['Governance',governance],['Local Services',services]
  ]){
    assert.match(source,/storePrivateEvidence/,`${label} must use storePrivateEvidence`);
    assert.match(source,/private_evidence_object_id/,`${label} must persist an opaque evidence reference`);
    assert.match(source,/readPrivateEvidence/,`${label} must proxy authorized reads`);
    assert.match(source,/sendPrivateEvidence/,`${label} must send safe binary responses`);
  }

  assert.match(services,/sourceType:'service_provider_cv'/);
  assert.match(services,/sourceType:'service_credential'/);
  assert.match(support,/classification:a\.kind==='audio'\?'support_voice_evidence':'support_attachment'/);
});

test('new private uploads store NULL in legacy data-url columns',()=>{
  const files=[
    ['server-incidents.js',/evidence_data_url,private_evidence_object_id[\s\S]{0,250}VALUES\([^)]*NULL/],
    ['server-admin-operations.js',/data_url,private_evidence_object_id[\s\S]{0,350}VALUES\([^)]*NULL/],
    ['server-delivery.js',/evidence_data_url,private_evidence_object_id,verification_status[\s\S]{0,300}VALUES\([^)]*NULL/],
    ['server-profile-governance.js',/evidence_data_url,private_evidence_object_id[\s\S]{0,300}VALUES\([^)]*NULL/],
    ['server-services.js',/evidence_data_url,private_evidence_object_id,verification_status[\s\S]{0,350}VALUES\([^)]*NULL/]
  ];
  for(const [name,pattern] of files)assert.match(read(name),pattern,name+' must not persist new base64 evidence');
  assert.match(read('server-services.js'),/SET cv_private_data_url=NULL,cv_private_evidence_object_id=\$1/);
});

test('private profile JSON excludes raw CV bytes',()=>{
  const services=read('server-services.js');
  assert.match(services,/has_private_cv/);
  const block=services.match(/async function privateProfile\(accountId\)\{[\s\S]*?async function privateProfileHome/);
  assert.ok(block);
  assert.doesNotMatch(block[0],/SELECT \* FROM service_provider_profiles/);
});

test('legacy migration clears raw columns only in updates that also bind an object id',()=>{
  const migration=read('private-evidence-migration.js');
  for(const marker of [
    'SET private_evidence_object_id=$1,evidence_data_url=NULL',
    'SET private_evidence_object_id=$1,data_url=NULL',
    'SET cv_private_evidence_object_id=$1,cv_private_data_url=NULL'
  ])assert.ok(migration.includes(marker),'missing migration clear-after-object marker: '+marker);
  assert.match(migration,/if\(Number\(error\?\.status\)===503\)throw error/);
});

test('browser evidence viewers no longer expect base64 JSON from private routes',()=>{
  const admin=read('public/admin-console.js');
  const support=read('public/admin-operations-ui.js');
  const incidents=read('public/incidents-ui.js');
  const governance=read('public/profile-governance-ui.js');

  assert.match(admin,/adminPrivateBlob/);
  assert.match(support,/privateAttachmentBlob/);
  assert.match(incidents,/incidentEvidenceBlob/);
  assert.match(governance,/URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(admin,/popup\.location\.href=d\.evidence_data_url/);
  assert.doesNotMatch(admin,/popup\.location\.href=d\.data_url/);
});
