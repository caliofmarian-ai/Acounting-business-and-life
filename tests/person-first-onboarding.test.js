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

test('every app entry opens the person account chooser and Merchant can be disabled',()=>{
  const auth=read('server-auth.js'),shell=read('public/shell.js');
  assert.doesNotMatch(auth,/bootstrap Merchant profile cannot be disabled/);
  assert.match(shell,/let activeSurface = 'account'/);
  assert.match(shell,/function renderAccountHome\(\)/);
  assert.match(shell,/You choose every time/);
  assert.match(shell,/renderAccountHome\(\);\n\s*publishProfileState\(\)/);
  assert.doesNotMatch(shell,/locked=role==='merchant'/);
});

test('the public registration form starts email verification once and explains the result',()=>{
  const ui=read('public/auth-ui.js');
  assert.match(ui,/submit\.disabled=true/);
  assert.match(ui,/if\(!isRegistration\)\{location\.reload\(\);return\}/);
  assert.match(ui,/authFetch\('\/api\/auth\/email-verification\/request'/);
  assert.match(ui,/delivery_status==='sent'/);
  assert.match(ui,/preview_verify_url/);
  assert.match(ui,/request a new verification link from Account Settings/);
});

test('a person with no active role sees a truthful first-profile checklist',()=>{
  const shell=read('public/shell.js');
  const start=shell.indexOf('function applyActiveRole()');
  const block=shell.slice(start,shell.indexOf('function publishProfileState',start));
  assert.match(block,/No Customer, Merchant, Supplier, Delivery or Local Services profile is active/);
  assert.match(block,/account\.email_verified_at/);
  assert.match(block,/accountDetailsReady\(account\)/);
  assert.match(shell,/function accountDetailsReady\(account=snapshot\?\.account\).*account\?\.address/);
  assert.match(block,/Account Settings/);
  assert.doesNotMatch(block,/enableOrSwitch\(/);
});
