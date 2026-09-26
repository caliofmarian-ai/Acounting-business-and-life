import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GUIDED_ONBOARDING_JOURNEY,GUIDED_ONBOARDING_STEPS} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const server=read('server-auth.js');
const ui=read('public/guided-onboarding.js');
const css=read('public/guided-onboarding.css');
const shell=read('public/shell.js');
const governanceUi=read('public/profile-governance-ui.js');
const modernAuth=read('public/auth-hardening-ui.js');
const modernCss=read('public/auth-hardening.css');
const doc=read('docs/design/GUIDED_ONBOARDING_MISSIONS_V1.md');

test('guided onboarding journey is versioned and covers account through first-profile onboarding',()=>{
  assert.equal(GUIDED_ONBOARDING_JOURNEY,'first_account_first_profile_v1');
  assert.deepEqual(GUIDED_ONBOARDING_STEPS,[
    'welcome','complete_account','area_status','account_settings','manage_profiles','choose_profile','profile_onboarding'
  ]);
  assert.match(core,/CREATE TABLE IF NOT EXISTS guided_onboarding_progress/);
  assert.match(core,/PRIMARY KEY\(account_id,journey_key\)/);
  assert.match(core,/completed_steps JSONB/);
  assert.match(core,/auto_start_enabled BOOLEAN/);
});

test('Account/Auth owns persistent guide endpoints and loads the coachmark assets',()=>{
  assert.match(server,/\/api\/onboarding\/guide/);
  assert.match(server,/guidedOnboardingSnapshot/);
  assert.match(server,/updateGuidedOnboarding/);
  assert.match(server,/\/guided-onboarding\.css/);
  assert.match(server,/\/guided-onboarding\.js/);
  assert.match(server,/ensureGuidedOnboardingSchema/);
});

test('guide supports skip resume reset and persisted completion without authorization side effects',()=>{
  assert.match(core,/action==='pause'/);
  assert.match(core,/action==='resume'/);
  assert.match(core,/action==='reset'/);
  assert.match(core,/action==='complete_step'/);
  assert.doesNotMatch(core,/profile_authorizations/);
  assert.doesNotMatch(core,/admin_assignments/);
  assert.doesNotMatch(core,/UPDATE profiles SET enabled=TRUE/);
});

test('company-managed test accounts are excluded from personal first-run guidance',()=>{
  assert.match(core,/if\(facts\.company_test\)/);
  assert.match(core,/eligible:false/);
  assert.match(core,/auto_start_enabled:false/);
});

test('coachmark follows real UI targets and does not duplicate protected actions',()=>{
  assert.match(ui,/guidedSpotlight/);
  assert.match(ui,/scrollIntoView/);
  assert.match(doc,/real UI target/i);
  assert.match(ui,/#accountHomeSettings/);
  assert.match(ui,/\[data-account-settings-view="profiles"\]/);
  assert.match(ui,/\.profileRoleList/);
  assert.match(ui,/#govApplicationForm/);
  assert.match(ui,/submitGovApp/);
  assert.doesNotMatch(ui,/INSERT INTO/);
});

test('profile selection remains neutral and follows whichever role the user chooses',()=>{
  for(const role of ['customer','merchant','supplier','courier','service_provider'])assert.match(ui,new RegExp(role));
  assert.match(ui,/Business & Life does not choose a role for you/);
  assert.match(ui,/selected_profile_role/);
  assert.doesNotMatch(ui,/recommendedProfile|defaultProfileRole|bestProfile/);
});

test('profile tutorial uses existing role-specific fields without inventing optional evidence requirements',()=>{
  assert.match(ui,/appBusiness/);
  assert.match(ui,/appHeadline/);
  assert.match(ui,/appAbout/);
  assert.match(ui,/data-req-cat/);
  assert.match(ui,/courierVehicleType/);
  assert.match(ui,/appAck/);
  assert.match(doc,/Optional evidence remains optional/);
});

test('Mission Center and launcher preserve user control',()=>{
  assert.match(ui,/Skip for now/);
  assert.match(ui,/Resume tutorial/);
  assert.match(ui,/Restart tutorial/);
  assert.match(ui,/guidedOnboardingLauncher/);
  assert.match(ui,/guidedMissionCenter/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/pointer-events:none/);
  assert.match(ui,/role="dialog"/);
});

test('real governance actions notify the guide only after successful transitions',()=>{
  assert.match(governanceUi,/reason:'application_saved'/);
  assert.match(governanceUi,/reason:'application_submitted'/);
  assert.match(governanceUi,/reason:'application_started'/);
  assert.match(governanceUi,/reason:'invitation_accepted'/);
  assert.match(ui,/abl:guided-onboarding-refresh/);
});

test('modern registration sends official barangay PSGC required by account geography',()=>{
  assert.match(modernAuth,/regBarangaySearch/);
  assert.match(modernAuth,/regHomePsgcCode/);
  assert.match(modernAuth,/\/api\/auth\/geography\/search/);
  assert.match(modernAuth,/home_psgc_code:document\.getElementById\('regHomePsgcCode'\)\.value/);
  assert.match(modernAuth,/Primary address <span>private<\/span>/);
  assert.match(modernCss,/\.modernGeoPicker/);
});

test('Figma reference is canonical for the coachmark and mission visual direction',()=>{
  assert.match(doc,/PHzcLeL0a8biPACZNf8yBf/);
  assert.match(doc,/Mobile coachmark on Account Home/);
  assert.match(doc,/Mobile Mission Center/);
  assert.match(doc,/Desktop first-profile guidance/);
});

test('Account Settings remains the home for restarting the guide',()=>{
  assert.match(ui,/guidedOnboardingSettingsCard/);
  assert.match(ui,/data-guide-settings-action/);
  assert.match(shell,/data-account-settings-view="profiles"/);
});
