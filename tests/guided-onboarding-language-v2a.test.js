import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const css=read('public/guided-onboarding.css');
const server=read('server-auth.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('language is an explicit first onboarding mission, never silently completed from a default locale',()=>{
  assert.match(core,/GUIDED_ONBOARDING_STEPS=Object\.freeze\(\[\s*'language'/);
  assert.match(core,/locale_confirmed BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(core,/if\(progress\.locale_confirmed\)completed\.add\('language'\)/);
  assert.match(core,/if\(step==='language'\)throw/);
  assert.match(ui,/renderLanguageCoach/);
  assert.match(ui,/Later \/ Mamaya/);
});

test('only supported onboarding locales can be persisted to the account preference',()=>{
  assert.match(core,/GUIDED_ONBOARDING_LOCALES=Object\.freeze\(\['en-PH','fil-PH'\]\)/);
  assert.match(core,/action==='set_locale'/);
  assert.match(core,/Unsupported onboarding language/);
  assert.match(core,/UPDATE accounts SET preferred_locale=\$1,updated_at=NOW\(\) WHERE id=\$2/);
  assert.match(server,/ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'en-PH'/);
  assert.match(server,/test_role,preferred_locale,\(password_hash IS NOT NULL\)/);
});

test('locale choice does not mutate country, profile, business, currency or payment configuration',()=>{
  const start=core.indexOf("}else if(action==='set_locale')");
  const end=core.indexOf("}else if(action==='select_profile')",start);
  const block=core.slice(start,end);
  assert.match(block,/preferred_locale/);
  assert.doesNotMatch(block,/active_role|identity_country_code|businesses|currency|payment|profiles SET/);
});

test('guided onboarding owns complete English and Filipino copy packs with English fallback',()=>{
  const required=[
    'launcher.title','common.getting_started','step.language','language.title','welcome.title',
    'step.complete_account','area.title','area.available','area.not_open','settings.title','profiles.choose_title',
    'profile.vehicle_title','profile.ack_title','profile.submit_title','mission.title',
    'settings_tutorial.title','role.customer','role.merchant','role.supplier','role.courier','role.service_provider'
  ];
  for(const key of required){
    assert.ok(en[key],`missing English onboarding key ${key}`);
    assert.ok(fil[key],`missing Filipino onboarding key ${key}`);
  }
  assert.equal(en['meta.locale'],'en-PH');
  assert.equal(fil['meta.locale'],'fil-PH');
  assert.match(ui,/if\(normalized!=='en-PH'\)return loadCopy\('en-PH'\)/);
});

test('language chooser is touch-safe and can use device locale only as a suggestion',()=>{
  assert.match(ui,/suggestedLocale/);
  assert.match(ui,/navigator\.languages/);
  assert.match(ui,/startsWith\('fil'\)\|\|x\.startsWith\('tl'\)/);
  assert.match(ui,/data-guide-locale="en-PH"/);
  assert.match(ui,/data-guide-locale="fil-PH"/);
  assert.match(css,/\.guidedLanguageChoices button\{[^}]*min-height:62px/);
  assert.match(ui,/Language does not change your country, barangay, profile, currency or payment settings/);
});

test('localized onboarding keeps internal geography and expansion mechanics out of customer copy',()=>{
  assert.match(ui,/tr\('area\.available'/);
  assert.match(ui,/tr\('area\.not_open'/);
  assert.doesNotMatch(ui,/territory-demand signals/);
  assert.doesNotMatch(ui,/derives the PSGC barangay/);
  assert.match(en['account.complete_body'],/check whether Business & Life is available in your area/);
  assert.match(fil['account.complete_body'],/available ang Business & Life sa iyong lugar/);
});

test('Mission Center lets a user reopen the language chooser after selection',()=>{
  assert.match(ui,/if\(step==='language'\)return renderLanguageCoach\(\)/);
  assert.match(ui,/stepLabel\(step\)/);
});


test('language can be changed back to English from every active coach and Mission Center',()=>{
  assert.match(ui,/data-guide-language-switch/);
  assert.match(ui,/Change tutorial language/);
  assert.match(ui,/English \/ Filipino/);
  assert.match(ui,/renderLanguageCoach\(\{returnToCurrent:true\}\)/);
  assert.match(ui,/languagePickerReturnMode='mission'/);
  assert.match(ui,/Back \/ Bumalik/);
  assert.match(ui,/await updateGuide\(\{action:'set_locale',locale:button\.dataset\.guideLocale\}/);
  assert.match(ui,/if\(mode==='mission'\)\{missionCenterOpen=true;renderMissionCenter\(\);return\}/);
  assert.match(css,/\.guidedLanguageSwitch\{[^}]*min-height:40px/);
  assert.match(css,/@media\(max-width:419px\)\{[^}]*\.guidedLanguageSwitch\{min-height:44px/);
});

test('language recovery control uses self-identifying labels independent of current locale',()=>{
  assert.match(ui,/<strong>English<\/strong>/);
  assert.match(ui,/<strong>Filipino \/ Tagalog<\/strong>/);
  assert.match(ui,/English \(Philippines\)/);
  assert.match(ui,/Filipino \/ Tagalog para sa Pilipinas/);
  assert.doesNotMatch(ui,/data-guide-language-switch[^>]*>[^<]*(?:English only|Filipino only)/);
});

test('changing tutorial language rerenders current journey without mutating profile or payment state',()=>{
  assert.match(ui,/const mode=languagePickerReturnMode/);
  assert.match(ui,/await loadCopy\(button\.dataset\.guideLocale\)/);
  assert.match(ui,/renderGuide\(\)/);
  const start=core.indexOf("}else if(action==='set_locale')");
  const end=core.indexOf("}else if(action==='select_profile')",start);
  const block=core.slice(start,end);
  assert.match(block,/preferred_locale/);
  assert.doesNotMatch(block,/active_role|profiles SET|payment|currency|businesses/);
});
