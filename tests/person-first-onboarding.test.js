import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('new email and Google registrations create a person account without an automatic role',()=>{
  const auth=read('server-auth.js'),google=read('server-auth-hardening.js');
  const register=auth.slice(auth.indexOf("app.post('/api/auth/register'"),auth.indexOf("app.post('/api/auth/login'"));
  assert.match(register,/active_role,password_salt/);
  assert.match(register,/VALUES\(\$1,\$2,\$3,\$4,NULL/);
  assert.doesNotMatch(register,/INSERT INTO profiles/);
  assert.match(google,/active_role,email_verified_at,auth_status\) VALUES\(\$1,\$2,NULL,NOW\(\),'active'\)/);
});

test('Customer activation requires completed identity and verified email',()=>{
  const auth=read('server-auth.js');
  const start=auth.indexOf("app.post('/api/profiles/customer/activate'");
  const block=auth.slice(start,auth.indexOf("app.get('/api/context/:role'",start));
  assert.match(block,/display_name,email,address,email_verified_at/);
  assert.match(block,/Verify your email before activating Customer/);
  assert.match(block,/INSERT INTO profiles\(account_id,role,enabled,visibility,status\)/);
});

test('operational profiles start disabled onboarding and need Admin approval',()=>{
  const server=read('server-profile-governance.js'),ui=read('public/profile-governance-ui.js');
  assert.match(server,/api\/governance\/profiles\/:role\/start/);
  assert.match(server,/profile_onboarding_started/);
  assert.match(server,/FALSE,'private','application_started'/);
  assert.match(ui,/Start onboarding/);
  assert.match(ui,/Passenger transport is a separate future authorization/);
});
