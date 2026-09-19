import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const settings=read('public/profile-settings-ui.js');
const css=read('public/profile-settings.css');

test('profile settings opens only for the currently selected Profile surface',()=>{
  assert.match(settings,/state\?\.surface!==['"]profile['"]/);
  assert.match(settings,/requested!==state\.activeRole/);
  assert.match(settings,/Open the profile first, then use its Settings card/);
  assert.doesNotMatch(settings,/data-settings-role/);
});

test('each profile settings center preserves profile identity and explicit destinations',()=>{
  assert.match(settings,/PROFILE_SETTINGS_COPY/);
  assert.match(settings,/Profile ID:/);
  assert.match(settings,/data-profile-settings-view="identity"/);
  assert.match(settings,/data-profile-settings-view="finance"/);
  assert.match(settings,/data-profile-settings-view="status"/);
  assert.match(settings,/Statements &amp; documents/);
  assert.match(css,/\.profileSettingsMenu/);
});

test('profile lifecycle remains an Account Settings responsibility',()=>{
  assert.match(settings,/openAccountSettings\?\.\(['"]profiles['"]\)/);
  assert.match(settings,/does not delete your personal account or change Admin assignments/);
});
