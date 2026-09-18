import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/profile-governance-ui.js',import.meta.url),'utf8');

test('Governance reuses canonical shell identity and caches drawer context',()=>{
  assert.match(ui,/GOV_CACHE_MS=30000/);
  assert.match(ui,/window\.BusinessLifeProfileState\?\.snapshot/);
  assert.match(ui,/if\(!force&&govState&&govFetchedAt&&Date\.now\(\)-govFetchedAt<GOV_CACHE_MS\)return govState/);
  assert.match(ui,/govRefreshPromise/);
  assert.match(ui,/if\(govRefreshPromise\)return govRefreshPromise/);
});

test('drawer and foreground refreshes use cache instead of forcing three requests',()=>{
  assert.match(ui,/abl:drawer-rendered',\(\)=>\{refreshGov\(\)\.then/);
  assert.match(ui,/visibilitychange',\(\)=>\{if\(!document\.hidden&&gtok\(\)\)refreshGov\(\)\.catch/);
  assert.match(ui,/const mePromise=govMe\?Promise\.resolve\(govMe\):gapi\('\/api\/me'\)/);
});

test('Governance mutations force fresh state after writes',()=>{
  const forced=(ui.match(/refreshGov\(true\)/g)||[]).length;
  assert.ok(forced>=8,'expected mutation paths to force governance refresh');
  assert.match(ui,/invitations\/\$\{inv\.id\}\/accept[\s\S]{0,180}refreshGov\(true\)/);
  assert.match(ui,/applications\/\$\{a\.id\}\/submit[\s\S]{0,180}refreshGov\(true\)/);
  assert.match(ui,/Application .*approved[\s\S]{0,500}refreshGov\(true\)/);
});
