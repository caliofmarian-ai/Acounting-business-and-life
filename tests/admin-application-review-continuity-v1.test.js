import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('public/admin-console.js');
const governance=read('server-profile-governance.js');

test('Admin evidence preview keeps a usable popup handle before async private fetch',()=>{
  assert.match(admin,/window\.open\('about:blank','_blank'\)/);
  assert.match(admin,/popup\.opener=null/);
  assert.doesNotMatch(admin,/window\.open\('about:blank','_blank','noopener,noreferrer'\)/);
  assert.match(admin,/popup\.location\.replace\(url\)/);
});

test('application review URL survives refresh until Admin intentionally leaves the review',()=>{
  assert.match(admin,/function setAdminApplicationRoute\(id=null\)/);
  assert.match(admin,/url\.searchParams\.set\('application'/);
  assert.match(admin,/setAdminApplicationRoute\(applicationId\)/);
  assert.doesNotMatch(admin,/history\.replaceState\(\{\},'',location\.pathname\);\s*await openProfileApplicationFromContext/);
  assert.match(admin,/profileReviewBack'[\s\S]{0,200}setAdminApplicationRoute\(null\)/);
});

test('Keep under review preserves the exact application page',()=>{
  assert.match(admin,/if\(decision==='under_review'\)\{state\.active='members';state\.memberHubTab='requests';shell\(\);await openAdminApplication\(a\.id\)\}/);
  assert.match(admin,/else\{setAdminApplicationRoute\(null\)/);
});

test('Merchant review hides empty professional credentials and explains their purpose for Local Services',()=>{
  assert.match(admin,/credentials\.length\|\|a\.role==='service_provider'/);
  assert.match(admin,/Qualifications \/ credentials/);
  assert.match(admin,/Merchant business permits stay under Documents/);
});

test('same evidence content cannot be uploaded twice to one application',()=>{
  assert.match(governance,/pe\.sha256=\$2/);
  assert.match(governance,/DUPLICATE_APPLICATION_EVIDENCE/);
  assert.match(governance,/This exact document is already uploaded to this application/);
  assert.match(governance,/deletePrivateEvidence\(pool/);
});

test('historical duplicate application evidence is identified by content hash',()=>{
  assert.match(governance,/duplicate_of_id/);
  assert.match(governance,/pe2\.sha256=pe\.sha256/);
  assert.match(admin,/Duplicate of document #/);
});

test('Merchant application detail skips Local Services-only queries',()=>{
  assert.match(governance,/serviceProvider=application\.role==='service_provider'/);
  assert.match(governance,/const servicesPromise=serviceProvider/);
  assert.match(governance,/const credentialsPromise=serviceProvider/);
  assert.match(governance,/const requestedCategoriesPromise=serviceProvider&&requestedIds\.length/);
});
