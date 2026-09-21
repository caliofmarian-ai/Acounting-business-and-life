import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('QA acceptance snapshots manual review credentials before temporary automation login',()=>{
  assert.match(qa,/SELECT id,account_mode,test_role,email_verified_at,password_salt,password_hash/);
  assert.match(qa,/originalAutomationCredentials\.set\(accountId/);
  assert.match(qa,/salt:row\.password_salt\?\?null/);
  assert.match(qa,/hash:row\.password_hash\?\?null/);
});

test('QA acceptance restores manual review credentials even after a failed wave',()=>{
  assert.match(qa,/async function restoreAutomationCredentials\(pool\)/);
  assert.match(qa,/SET password_salt=\$1,password_hash=\$2,updated_at=NOW\(\)/);
  assert.match(qa,/finally\{[\s\S]*restoreAutomationCredentials\(pool\)/);
  assert.match(qa,/return finalResult/);
});
