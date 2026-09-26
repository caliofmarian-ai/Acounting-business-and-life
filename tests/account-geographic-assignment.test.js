import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {geographyAvailabilityMessage,normalizeHomePsgcCode} from '../account-geography.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('server-auth.js');
const authUi=read('public/auth-ui.js');
const shell=read('public/shell.js');
const governance=read('server-profile-governance.js');
const governanceUi=read('public/profile-governance-ui.js');
const notifications=read('notification-core.js');

test('account geography is official barangay PSGC membership separate from operational territory',()=>{
  const core=read('account-geography.js');
  assert.match(core,/CREATE TABLE IF NOT EXISTS account_geography_assignments/);
  assert.match(core,/CHECK\(geographic_level='barangay'\)/);
  assert.match(core,/resolveOfficialBarangay/);
  assert.match(core,/geographic_level='barangay'/);
  assert.match(core,/exact_territory/);
  assert.match(core,/nearest_opened_scope/);
  assert.equal(normalizeHomePsgcCode('0402103028'),'0402103028');
  assert.equal(normalizeHomePsgcCode('bad'),'');
});

test('availability copy explains planned paused restricted closed and unopened areas',()=>{
  const base={psgc_code:'1234567890',name:'Example Barangay'};
  assert.match(geographyAvailabilityMessage({...base,exact_territory:{status:'planned'}}),/planned but not open/i);
  assert.match(geographyAvailabilityMessage({...base,exact_territory:{status:'paused'}}),/temporarily paused/i);
  assert.match(geographyAvailabilityMessage({...base,exact_territory:{status:'suspended'}}),/restricted/i);
  assert.match(geographyAvailabilityMessage({...base,exact_territory:{status:'closed'}}),/closed/i);
  assert.match(geographyAvailabilityMessage({...base,exact_territory:null,nearest_opened_scope:{name:'Parent City',status:'planned'}}),/nearest Business & Life scope.*Parent City.*planned/i);
});

test('email registration requires and validates official barangay without activating a profile',()=>{
  const start=auth.indexOf("app.post('/api/auth/register'");
  const block=auth.slice(start,auth.indexOf("app.post('/api/auth/login'",start));
  assert.match(block,/home_psgc_code/);
  assert.match(block,/Choose your official barangay before creating your account/);
  assert.match(block,/saveAccountGeography\(client,accountId/);
  assert.doesNotMatch(block,/INSERT INTO profiles/);
  assert.match(authUi,/Your barangay \(official PSGC\)/);
  assert.match(authUi,/authHomePsgcCode/);
  assert.match(authUi,/\/api\/auth\/geography\/search/);
});

test('Google-created personal accounts can complete geography in Account Settings before profiles',()=>{
  const google=read('server-auth-hardening.js');
  assert.match(google,/INSERT INTO accounts\(display_name,email,active_role,email_verified_at,auth_status\)/);
  assert.match(shell,/accountGeographyEditor/);
  assert.match(shell,/\/api\/me\/geography/);
  assert.match(shell,/official barangay before activating a profile/);
  assert.match(shell,/snapshot\?\.geography\?\.assigned/);
});

test('personal onboarding is automatically scoped to the assigned open barangay',()=>{
  assert.match(governance,/assignedOnboardingTerritory/);
  assert.match(governance,/requireAssignedOpenBarangay/);
  assert.match(governance,/This invitation is for a different Business & Life area than your assigned barangay/);
  assert.match(governanceUi,/Your operational area comes from your account/);
  assert.match(governanceUi,/Your profile will use your assigned barangay automatically/);
  assert.match(governanceUi,/Personal accounts never see this selector/);
  assert.match(governanceUi,/Test fallback only/);
});

test('personal territory discovery returns at most the assigned onboarding or active barangay',()=>{
  const route=governance.slice(governance.indexOf("app.get('/api/governance/territories'"),governance.indexOf("app.post('/api/governance/invitations",governance.indexOf("app.get('/api/governance/territories'")));
  assert.match(route,/accountGeographySnapshot/);
  assert.match(route,/geo\.exact_territory\.id/);
  assert.match(route,/status IN \('onboarding','active'\)/);
  assert.match(route,/return res\.json\(\[\]\)/);
});

test('account and territory lifecycle emit in-app area status notifications',()=>{
  assert.match(auth,/emitAccountGeographyNotice/);
  assert.match(auth,/territory\.area_available/);
  assert.match(auth,/territory\.area_status/);
  assert.match(governance,/accountIdsInPsgcScope/);
  assert.match(governance,/Territory opening member notification suppressed/);
  assert.match(governance,/Territory member notification suppressed/);
  assert.match(notifications,/territory\.area_available/);
  assert.match(notifications,/territory\.area_status/);
});

test('private address and public operating area remain separate UX concepts',()=>{
  assert.match(authUi,/Primary address \(private\)/);
  assert.match(authUi,/does not publish your home address/);
  assert.match(shell,/It does not publish your private street address/);
  assert.doesNotMatch(governance,/address.*account_geography_assignments/);
});
