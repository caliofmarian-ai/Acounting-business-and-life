import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const guide=read('public/guided-onboarding.js');
const guideCss=read('public/guided-onboarding.css');
const auth=read('public/auth-ui.js');
const hardening=read('public/auth-hardening-ui.js');
const hardeningCss=read('public/auth-hardening.css');
const shell=read('public/shell.js');
const core=read('guided-onboarding-core.js');

test('coachmark measures viewport, target and coach before contextual top/bottom placement',()=>{
  assert.match(guide,/COACH_TARGET_GAP=14/);
  assert.match(guide,/target\.getBoundingClientRect\(\)/);
  assert.match(guide,/coach\.getBoundingClientRect\(\)/);
  assert.match(guide,/window\.visualViewport/);
  assert.match(guide,/preferred=.*\?'top':'bottom'/);
  assert.match(guide,/coach\.dataset\.placement=placement/);
  assert.match(guideCss,/guidedSafeAreaProbe/);
  assert.match(guideCss,/safe-area-inset-top/);
  assert.match(guideCss,/safe-area-inset-bottom/);
});

test('coachmark enforces target gap and compact fallback without hiding the real target',()=>{
  assert.match(guide,/rectsOverlapWithGap/);
  assert.match(guide,/coach\.dataset\.noOverlap/);
  assert.match(guide,/COMPACT_BREAKPOINT=420/);
  assert.match(guide,/classList\.add\('compact','guidedCoachScroll'\)/);
  assert.match(guideCss,/guidedCoach\.compact/);
  assert.match(guideCss,/-webkit-line-clamp:3/);
  assert.match(guide,/data-guide-more/);
  assert.match(guideCss,/\.guidedSpotlight[^}]*pointer-events:none/);
  assert.match(guideCss,/\.guidedCoach[^}]*pointer-events:auto/);
});

test('auto-scroll remeasures without introducing a scroll/rerender loop and respects reduced motion',()=>{
  assert.match(guide,/target\.scrollIntoView\(\{block:'center'/);
  assert.match(guide,/await nextAnimationFrame\(\);await nextAnimationFrame\(\)/);
  assert.match(guide,/reducedMotion\(\)\?'auto':'smooth'/);
  const lifecycle=guide.slice(guide.indexOf('function bindLifecycle()'));
  assert.match(lifecycle,/scheduleCoachReposition/);
  assert.doesNotMatch(lifecycle,/addEventListener\('scroll',[^\n]*scheduleRender/);
  assert.match(guideCss,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Security access uses fixed section order and no default password form',()=>{
  const order=['accountProtectionMount','accountPasswordMount','accountSensitiveActionMount','accountSessionsMount'].map(x=>shell.indexOf(x));
  assert.ok(order.every(x=>x>=0));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);
  const decorator=auth.slice(auth.indexOf('function decorateDrawer()'),auth.indexOf('function showExpiredSessionLogin()'));
  assert.match(decorator,/passwordSummaryCard/);
  assert.match(decorator,/Password set/);
  assert.match(decorator,/No password set/);
  assert.doesNotMatch(decorator,/securityForm/);
  assert.doesNotMatch(decorator,/name="current_password"/);
});

test('Change or Set password opens an on-demand responsive dialog with confirmation validation',()=>{
  assert.match(auth,/function openPasswordDialog\(\)/);
  assert.match(auth,/role="dialog" aria-modal="true"/);
  assert.match(auth,/name="confirm_password"/);
  assert.match(auth,/New password and confirmation must match/);
  assert.match(auth,/currentProfile\.account\.has_password/);
  assert.match(auth,/hasPassword\?'Change password':'Set password'/);
  assert.match(auth,/hasPassword\?'<label>Current password/);
  assert.match(hardeningCss,/passwordChangeBackdrop/);
  assert.match(hardeningCss,/@media\(min-width:650px\)[^{]*\{\.passwordChangeBackdrop\{align-items:center/);
  assert.match(hardeningCss,/@media\(max-width:419px\)/);
});

test('Forgot password stays a separate dedicated recovery flow and Sign out stays in Sessions',()=>{
  assert.match(auth,/openPasswordRecovery/);
  assert.match(hardening,/\/api\/auth\/forgot-password/);
  assert.match(hardening,/openPasswordRecovery\(email=''/);
  assert.match(hardening,/authSessionsCard/);
  assert.match(hardening,/id="signOutCurrent"/);
  assert.match(hardening,/Manage signed-in access separately from your password/);
  assert.doesNotMatch(auth,/logoutSecurity/);
});

test('Complete account targets Verify email before geography and never requires a local password',()=>{
  const target=guide.slice(guide.indexOf('function missingAccountTarget()'),guide.indexOf('function profileOnboardingSubstep'));
  assert.match(target,/if\(!facts\.email_verified\)/);
  assert.match(target,/#sendVerify/);
  assert.match(target,/if\(!facts\.area_assigned\)/);
  assert.match(target,/#accountGeographyForm/);
  assert.doesNotMatch(target,/password/i);
  assert.doesNotMatch(core,/has_password/);
});
