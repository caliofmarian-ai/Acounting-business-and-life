import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_STEPS,
  GUIDED_ONBOARDING_PROFILE_STEPS,
  GUIDED_ONBOARDING_PROFILE_VERSION
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const settings=read('public/profile-settings-ui.js');
const css=read('public/guided-onboarding.css');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('account and profile tutorials have independent persisted journey models',()=>{
  assert.deepEqual(GUIDED_ONBOARDING_STEPS,[
    'language','welcome','complete_account','area_status','account_settings','manage_profiles','choose_profile'
  ]);
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_STEPS,['profile_welcome','profile_settings']);
  assert.equal(GUIDED_ONBOARDING_PROFILE_VERSION,1);
  assert.match(core,/CREATE TABLE IF NOT EXISTS guided_onboarding_profile_progress/);
  assert.match(core,/PRIMARY KEY\(account_id,profile_role,journey_version\)/);
  assert.match(core,/profile_role IN \('customer','merchant','supplier','courier','service_provider'\)/);
  assert.doesNotMatch(JSON.stringify(GUIDED_ONBOARDING_STEPS),/profile_onboarding/);
});

test('started profiles receive their own rows without activating any profile',()=>{
  assert.match(core,/function profileRoleStarted/);
  assert.match(core,/ensureProfileProgressRows/);
  assert.match(core,/if\(!profileRoleStarted\(facts,role\)\)continue/);
  assert.match(core,/ON CONFLICT\(account_id,profile_role,journey_version\) DO NOTHING/);
  assert.doesNotMatch(core,/UPDATE profiles SET enabled=TRUE/);
  assert.doesNotMatch(core,/INSERT INTO profiles/);
  assert.doesNotMatch(core,/active_role=\$|SET active_role/);
});

test('legacy first-profile completion migrates only the profile that actually completed it',()=>{
  assert.match(core,/legacyCompletedRaw\.has\('profile_onboarding'\)/);
  assert.match(core,/migratedLegacyProfile&&role===legacyRole/);
  assert.match(core,/migrateCompleted\?GUIDED_ONBOARDING_PROFILE_STEPS:\[\]/);
  assert.doesNotMatch(core,/for\(const role of ROLE_ORDER\)[\s\S]*migrateCompleted=true/);
});

test('profile pause resume reset complete and step completion are isolated by role and version',()=>{
  for(const action of ['profile_complete_step','profile_pause','profile_resume','profile_reset','profile_complete']){
    assert.match(core,new RegExp(action));
  }
  assert.match(core,/WHERE account_id=\$6 AND profile_role=\$7 AND journey_version=\$8/);
  assert.match(core,/Activate or start this profile before opening its tutorial/);
  assert.doesNotMatch(core,/profile_complete_step[\s\S]{0,900}UPDATE guided_onboarding_progress/);
});

test('Mission Center shows account setup and all available profile tutorials separately',()=>{
  assert.match(ui,/profileJourneys\(\)/);
  assert.match(ui,/profileJourneyRow/);
  assert.match(ui,/mission\.account_journey/);
  assert.match(ui,/mission\.profile_tours/);
  assert.match(ui,/data-guide-profile-journey/);
  assert.match(ui,/profile_complete_step/);
  assert.match(ui,/profile_pause/);
  assert.match(ui,/profile_resume/);
  assert.match(ui,/profile_reset/);
  assert.match(css,/\.guidedJourneySection/);
});

test('a completed account tutorial does not hide an unfinished profile tutorial',()=>{
  assert.match(ui,/incompleteJourneyCount/);
  assert.match(ui,/guide\.status==='completed'\?0:1/);
  assert.match(ui,/profileJourneys\(\)\.filter\(profileJourneyActive\)/);
  assert.match(ui,/guide\.status==='completed'&&profile\?\.status==='active'/);
});

test('Profile Settings can reopen only the currently selected profile tutorial',()=>{
  assert.match(settings,/id="profileGuidedTutorial"/);
  assert.match(settings,/Open or restart the guided tutorial for this profile only/);
  assert.match(settings,/abl:guided-onboarding-open-profile/);
  assert.match(settings,/detail:\{role:selectedSettingsRole\}/);
  assert.match(ui,/document\.addEventListener\('abl:guided-onboarding-open-profile'/);
  assert.match(ui,/profile_reset/);
});

test('inactive profile journey asks the user to open that profile instead of switching automatically',()=>{
  assert.match(ui,/if\(!journey\?\.is_active_profile\)/);
  assert.match(ui,/Open \{role\} to continue/);
  const profileBlock=ui.slice(ui.indexOf('function profileJourneyDefinition'),ui.indexOf('function renderProfileJourney'));
  assert.doesNotMatch(profileBlock,/active-role|applyActiveRole|toggleProfile|roleAction.*click/);
});

test('English and Filipino packs include the independent-journey copy',()=>{
  const keys=[
    'mission.account_journey','mission.profile_tours','mission.paused','mission.ready',
    'profile_tour.row_title','profile_tour.step_welcome','profile_tour.step_settings',
    'profile_tour.open_profile_title','profile_tour.welcome_title','profile_tour.settings_title'
  ];
  for(const key of keys){
    assert.ok(en[key],`missing English key ${key}`);
    assert.ok(fil[key],`missing Filipino key ${key}`);
  }
});
