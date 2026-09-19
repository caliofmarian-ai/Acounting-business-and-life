import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('server-auth.js');
const unified=read('server-unified.js');
const identity=read('identity-server.js');
const shell=read('public/shell.js');

test('Merchant is optional in every profile endpoint',()=>{
  for(const source of [auth,unified,identity]){
    assert.doesNotMatch(source,/bootstrap Merchant profile cannot be disabled/);
    assert.doesNotMatch(source,/bootstrap merchant profile stays enabled/);
  }
  assert.doesNotMatch(shell,/>Required</);
});

test('deactivation never falls back to Merchant automatically',()=>{
  assert.doesNotMatch(unified,/active_role='merchant'/);
  assert.doesNotMatch(identity,/active_role='merchant'/);
  for(const source of [auth,unified,identity])assert.match(source,/next\.rows\[0\]\?\.role\|\|null|nextRole\.rows\[0\]\?\.role\|\|null/);
});

test('approved governed profiles can be reactivated without repeating onboarding',()=>{
  assert.match(auth,/profile_authorizations/);
  assert.match(auth,/status='active'/);
  assert.match(auth,/expires_at IS NULL OR expires_at>NOW\(\)/);
  assert.match(auth,/SET enabled=TRUE,visibility=\$3,status='active'/);
  assert.match(shell,/data-profile-reactivate/);
  assert.match(shell,/Profile reactivated\./);
});

test('profile cards expose one lifecycle action for each state',()=>{
  assert.match(shell,/Disabled · ID and history preserved/);
  assert.match(shell,/Continue onboarding/);
  assert.match(shell,/Start onboarding/);
  assert.match(shell,/label=enabled\?'Disable':reactivable\?'Reactivate'/);
});
