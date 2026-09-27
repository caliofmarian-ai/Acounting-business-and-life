import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Session Security V2 has an isolated Preview acceptance wave',()=>{
  assert.match(qa,/const SESSION_SECURITY_V2_WAVE='session_security_v2'/);
  assert.match(qa,/ACCEPTANCE_WAVES=new Set\([^;]*SESSION_SECURITY_V2_WAVE/);
  assert.match(qa,/config\.wave===SESSION_SECURITY_V2_WAVE/);
  assert.match(qa,/runSessionSecurityV2Acceptance\(\{pool,base,secret:config\.secret\}\)/);
});

test('Session Security V2 acceptance proves cookie auth CSRF logout and one-time rotation',()=>{
  const start=qa.indexOf('async function runSessionSecurityV2Acceptance');
  const end=qa.indexOf('export async function runQaAcceptanceIfRequested',start);
  const block=qa.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/browserLogin\.json\?\.token/);
  assert.match(block,/__Host-abl_session/);
  assert.match(block,/__Host-abl_csrf/);
  assert.match(block,/CSRF_VALIDATION_FAILED/);
  assert.match(block,/\/api\/auth\/logout/);
  assert.match(block,/\/api\/auth\/session\/migrate/);
  assert.match(block,/migration replay denial/);
  assert.match(block,/migration_replay_denied:true/);
});
