import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const auth=read('public/auth-ui.js');

test('stale auth tokens never leave preview on an empty authenticated shell',()=>{
  assert.match(shell,/response\.status === 401/);
  assert.match(shell,/localStorage\.removeItem\('abl_token'\)/);
  assert.match(shell,/document\.getElementById\('shell'\)\?\.classList\.add\('hidden'\)/);
  assert.match(shell,/document\.getElementById\('login'\)\?\.classList\.remove\('hidden'\)/);
  assert.match(shell,/abl:auth-expired/);
});

test('expired sessions open the modern email sign-in flow',()=>{
  assert.match(auth,/function showExpiredSessionLogin\(\)/);
  assert.match(auth,/openAuth\('login'\)/);
  assert.match(auth,/error\.status=r\.status/);
  assert.match(auth,/if\(error\?\.status===401\)showExpiredSessionLogin\(\)/);
  assert.match(auth,/addEventListener\('abl:auth-expired',showExpiredSessionLogin\)/);
});
