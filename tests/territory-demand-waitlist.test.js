import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const demand=read('territory-demand-core.js');
const auth=read('server-auth.js');
const governance=read('server-profile-governance.js');
const adminProxy=read('server-admin-operations.js');
const adminUi=read('public/admin-console.js');

test('registration remains allowed for any official barangay regardless of operating status',()=>{
  const start=auth.indexOf("app.post('/api/auth/register'");
  const end=auth.indexOf("app.post('/api/auth/login'",start);
  const block=auth.slice(start,end);
  assert.match(block,/geographyAvailabilityForCode/);
  assert.match(block,/saveAccountGeography/);
  assert.doesNotMatch(block,/requireAssignedOpenBarangay/);
  assert.doesNotMatch(block,/operational_onboarding_available.*return res\.status/);
});

test('territory demand stores deduplicated role interest with attempt history',()=>{
  assert.match(demand,/CREATE TABLE IF NOT EXISTS territory_profile_interest_signals/);
  assert.match(demand,/PRIMARY KEY\(account_id,country_code,psgc_code,profile_role\)/);
  assert.match(demand,/attempt_count=territory_profile_interest_signals\.attempt_count\+1/);
  assert.match(demand,/first_seen_at/);
  assert.match(demand,/last_seen_at/);
});

test('unavailable profile attempts are counted without granting onboarding',()=>{
  assert.match(auth,/recordUnavailableProfileInterest/);
  assert.match(auth,/role:'customer'/);
  assert.match(governance,/recordUnavailableProfileInterest/);
  assert.match(governance,/assignedOnboardingTerritory\(me,req\.body\?\.territory_id,'service_provider'\)/);
  assert.match(governance,/assignedOnboardingTerritory\(me,req\.body\?\.territory_id,role\)/);
  assert.match(governance,/requireAssignedOpenBarangay/);
});

test('Admin demand view is aggregate only and rolls account demand through geography',()=>{
  assert.match(demand,/WITH RECURSIVE lineage/);
  assert.match(demand,/COUNT\(DISTINCT l\.account_id\)::int registered_accounts/);
  assert.match(demand,/new_accounts_7d/);
  assert.match(demand,/new_accounts_30d/);
  assert.match(demand,/profile_interest_accounts/);
  assert.match(demand,/role_interest/);
  assert.doesNotMatch(demand,/display_name|email|address/);
  assert.match(governance,/\/api\/governance\/admin\/territory-demand/);
  assert.match(adminProxy,/\/api\/governance\/admin\/territory-demand/);
  assert.match(adminUi,/Territory Demand/);
  assert.match(adminUi,/Demand informs expansion\. It never opens a territory automatically/);
});

test('area-opening notification carries a Manage profiles action but no marketing email',()=>{
  assert.match(governance,/action:'manage_profiles'/);
  assert.match(governance,/emailDefault:false/);
  assert.match(governance,/territory\.area_available/);
});

test('typed barangay search does not preload onboarding territories',()=>{
  const geo=read('account-geography.js');
  assert.match(geo,/if\(!q\)return\{source_version:version,items:\[\]\}/);
  assert.doesNotMatch(geo,/if\(!q\)\{[\s\S]*t\.status IN \('onboarding','active'\)/);
});
