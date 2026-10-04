import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const onboarding=read('public/guided-onboarding.js');
const accounting=read('public/business-accounting-ui.js');
const auth=read('server-auth.js');
const unified=read('server-unified.js');
const qa=read('qa-acceptance.js');

function block(source,start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from);
  assert.ok(from>=0,start+' must exist');
  assert.ok(to>from,end+' must follow '+start);
  return source.slice(from,to);
}

test('profile switching closes the previous surface before the first network wait',()=>{
  const transition=block(shell,'function beginProfileTransition','function profileTransitionIsCurrent');
  assert.match(transition,/activeSurface='transition';\s*activeRole=null/);
  assert.match(transition,/hideFeatureWorkspaces\(\);\s*hideMerchantWorkspace\(\)/);
  assert.match(transition,/renderProfileTransition\(role\);\s*publishProfileState\(\)/);

  const switching=block(shell,'async function enableOrSwitch','function hideMerchantWorkspace');
  assert.ok(switching.indexOf('beginProfileTransition(role)')<switching.indexOf('await profileApi'));
  assert.match(switching,/if\(!profileTransitionIsCurrent\(transition\)\)return/);
  assert.doesNotMatch(switching,/renderDrawer\(\)/);
});

test('destination skeleton is stable non-interactive and Android-sized',()=>{
  assert.match(shell,/dataset\.profileTransition=target/);
  assert.match(shell,/hub\.setAttribute\('aria-busy','true'\)/);
  assert.match(shell,/Previous profile actions are closed/);
  assert.match(shell,/class="hubGrid profileTransitionGrid" aria-hidden="true"/);
  assert.match(css,/\.profileTransitionGrid\{pointer-events:none\}/);
  assert.match(css,/\.profileTransitionHub\{min-height:calc\(100dvh - 84px\)\}/);
  assert.match(css,/@media\(max-width:420px\)\{\.profileTransitionHub/);
});

test('navigation epochs stop stale role and bootstrap responses from remounting',()=>{
  assert.match(shell,/let navigationEpoch = 0/);
  assert.match(shell,/const refreshNavigationEpoch=navigationEpoch/);
  assert.match(shell,/if\(refreshNavigationEpoch!==navigationEpoch\)return bootstrap\.profile/);
  for(const role of ['customer','courier','service_provider']){
    assert.ok(shell.includes(`isNavigationCurrent(requestNavigationEpoch,'${role}')`),role+' Home must reject an old navigation epoch');
  }
  assert.match(accounting,/stateIsCurrent=window\.BusinessLifeShell\?\.isProfileStateCurrent/);
  assert.match(accounting,/if\(typeof stateIsCurrent==='function'&&!stateIsCurrent\(state\)\)return/);
});

test('active-role UI path requests the compact canonical response',()=>{
  const switching=block(shell,'async function enableOrSwitch','function hideMerchantWorkspace');
  assert.match(switching,/profileApi\('\/api\/me\/active-role'/);
  assert.match(switching,/headers:\{'X-BL-Profile-Switch':'compact'\}/);
  assert.match(switching,/mergeActiveRoleResponse\(nextSnapshot,switched,role\)/);
  assert.match(switching,/event:'profile_transition',role,server_ms:/);

  for(const source of [auth,unified]){
    const route=block(source,"app.patch('/api/me/active-role'","app.put('/api/profiles/:role'");
    assert.match(route,/UPDATE accounts SET active_role=\$1,updated_at=NOW\(\).*RETURNING active_role,updated_at/);
    assert.match(route,/req\.get\('x-bl-profile-switch'\)/);
    assert.match(route,/return res\.json\(\{ok:true,active_role:/);
    assert.ok(route.indexOf("req.get('x-bl-profile-switch')")<route.lastIndexOf('profileSnapshot(req.accountId)'));
  }
});

test('Admin navigation uses the same immediate destination boundary',()=>{
  const admin=block(shell,'function beginAdminNavigation','function mergeActiveRoleResponse');
  assert.match(admin,/activeSurface='transition';\s*activeRole=null/);
  assert.match(admin,/renderProfileTransition\('admin'\)/);
  assert.match(admin,/publishProfileState\(\);\s*window\.location\.assign\('\/admin'\)/);
  assert.equal((shell.match(/addEventListener\('click',beginAdminNavigation\)/g)||[]).length,2);
});

test('guided onboarding schedules synchronous rendering through a real Promise and reports failures',()=>{
  const scheduler=block(onboarding,'function scheduleRender','function scheduleRefresh');
  assert.doesNotMatch(scheduler,/renderGuide\(\)\.catch/);
  assert.match(scheduler,/Promise\.resolve\(\)\.then\(\(\)=>renderGuide\(\)\)/);
  assert.match(scheduler,/console\.error\('Guided onboarding render:',error\)/);
});

test('isolated Preview acceptance verifies compact switching denial and exact deployed assets',()=>{
  assert.match(qa,/PROFILE_LIFECYCLE_ATOMIC_V1_WAVE='profile_lifecycle_atomic_v1'/);
  assert.match(qa,/runProfileLifecycleAtomicV1Acceptance/);
  assert.match(qa,/'X-BL-Profile-Switch':'compact'/);
  assert.match(qa,/compact_payload_bytes:switchPayloadBytes/);
  assert.match(qa,/cross_role_denial:true/);
  assert.match(qa,/atomic_transition_asset:true/);
  assert.match(qa,/stale_response_guard:true/);
  assert.match(qa,/onboarding_scheduler_safe:true/);
  assert.match(qa,/android_css_contract:true/);
});
