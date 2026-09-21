import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const hardening=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');

test('email verification uses canonical optional V2 session resolution',()=>{
  assert.match(hardening,/async function optionalV2\(req\)/);
  assert.match(hardening,/resolveV2SessionToken\(pool,TOKEN_SECRET,token\)/);
  assert.match(hardening,/const session = await optionalV2\(req\);/);
  assert.doesNotMatch(hardening,/\bresolveV2\(req\)/);
});

test('email verification still supports signed-out and audit session classification',()=>{
  assert.match(hardening,/verificationSession = !session/);
  assert.match(hardening,/'signed_out'/);
  assert.match(hardening,/'same_account'/);
  assert.match(hardening,/'different_account'/);
});
