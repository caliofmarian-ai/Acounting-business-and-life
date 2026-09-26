import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const guide=read('public/guided-onboarding.js');
const guideCss=read('public/guided-onboarding.css');
const security=read('public/auth-hardening-ui.js');
const securityCss=read('public/auth-hardening.css');
const authServer=read('server-auth-hardening.js');

test('coachmark uses contextual top/bottom placement with target separation',()=>{
  assert.match(guide,/function applyCoachGeometry\(target\)/);
  assert.match(guide,/const targetRect=target\.getBoundingClientRect\(\),gap=14/);
  assert.match(guide,/const preferred=center>=viewportCenter\?'top':'bottom'/);
  assert.match(guide,/guidedCoachTop/);
  assert.match(guide,/guidedCoachBottom/);
  assert.match(guide,/wouldOverlap/);
  assert.match(guide,/altOverlap/);
});

test('coachmark accounts for visual viewport and safe-area insets',()=>{
  assert.match(guide,/window\.visualViewport/);
  assert.match(guide,/safe-area-inset-top/);
  assert.match(guide,/safe-area-inset-bottom/);
  assert.match(guide,/targetIsComfortablyVisible/);
  assert.match(guide,/scrollIntoView\(\{block:'center'/);
});

test('scroll and resize only reposition existing guide geometry without a render loop',()=>{
  const start=guide.indexOf("function bindLifecycle()");
  const block=guide.slice(start,guide.indexOf("async function boot()",start));
  assert.match(block,/const reposition=\(\)=>\{if\(overlay&&!missionCenterOpen&&currentSpotlightTarget\)positionGuide\(currentSpotlightTarget,\{scroll:false\}\)\}/);
  assert.match(block,/window\.addEventListener\('scroll',reposition/);
  assert.match(block,/window\.visualViewport\?\.addEventListener\('resize',reposition/);
  assert.doesNotMatch(block,/scroll'.*scheduleRender|resize'.*scheduleRender/s);
});

test('small screens have compact coachmark fallback and reduced-motion support',()=>{
  assert.match(guide,/guidedCoachCompact/);
  assert.match(guideCss,/\.guidedCoachCompact/);
  assert.match(guideCss,/@media\(max-width:420px\)/);
  assert.match(guideCss,/-webkit-line-clamp:3/);
  assert.match(guideCss,/prefers-reduced-motion:reduce/);
});

test('Security & access renders compact password summary instead of an inline password form',()=>{
  const start=security.indexOf("async function decorateSecurity()");
  const block=security.slice(start,security.indexOf("function watchDrawer()",start));
  assert.match(block,/PASSWORD/);
  assert.match(block,/Password set/);
  assert.match(block,/No password set/);
  assert.match(block,/authChangePassword/);
  assert.match(block,/authForgotPassword/);
  assert.doesNotMatch(block,/stepUpSecurityForm/);
  assert.doesNotMatch(block,/Confirm current password<input/);
});

test('Change password and Set password open an explicit responsive dialog',()=>{
  assert.match(security,/function openPasswordDialog\(account\)/);
  assert.match(security,/Current password/);
  assert.match(security,/New password/);
  assert.match(security,/Confirm new password/);
  assert.match(security,/Passwords do not match/);
  assert.match(security,/\/api\/auth\/password/);
  assert.match(securityCss,/\.authSecurityDialogBackdrop/);
  assert.match(securityCss,/align-items:flex-end/);
  assert.match(securityCss,/@media\(min-width:650px\)\{\.authSecurityDialogBackdrop\{align-items:center/);
});

test('Forgot password is a separate recovery action',()=>{
  assert.match(security,/function openPasswordRecoveryDialog\(account\)/);
  assert.match(security,/\/api\/auth\/forgot-password/);
  assert.match(security,/Send reset instructions/);
});

test('Sessions are visually and behaviorally separate from password management',()=>{
  const start=security.indexOf("async function decorateSecurity()");
  const block=security.slice(start,security.indexOf("function watchDrawer()",start));
  assert.match(block,/SESSIONS/);
  assert.match(block,/Signed-in sessions/);
  assert.match(block,/authSignOutCurrent/);
  assert.match(block,/revokeOthers/);
  assert.match(block,/signOutCurrentAccount/);
});

test('authenticated password endpoint verifies current password or recent identity',()=>{
  const start=authServer.indexOf("app.post('/api/auth/password'");
  const block=authServer.slice(start,authServer.indexOf("app.post('/api/auth/sessions/revoke-others'",start));
  assert.match(block,/passwordOkay\(newPassword\)/);
  assert.match(block,/Current password is required/);
  assert.match(block,/verifyPassword\(currentPassword/);
  assert.match(block,/resolveV2SessionStepUp/);
  assert.match(block,/RECENT_AUTH_REQUIRED/);
  assert.match(block,/password_changed/);
  assert.match(block,/password_set/);
  assert.match(block,/session_id<>/);
});

test('Complete your account targets email then identity/geography and never requires password change',()=>{
  const targetStart=guide.indexOf("function missingAccountTarget()");
  const targetBlock=guide.slice(targetStart,guide.indexOf("function profileOnboardingSubstep",targetStart));
  assert.match(targetBlock,/#sendVerify/);
  assert.match(targetBlock,/#shellAddress/);
  assert.match(targetBlock,/#accountGeographyForm/);
  assert.doesNotMatch(targetBlock,/password|authChangePassword/i);

  const stepStart=guide.indexOf("if(step==='complete_account')");
  const stepBlock=guide.slice(stepStart,guide.indexOf("if(step==='area_status')",stepStart));
  assert.match(stepBlock,/email_verified/);
  assert.match(stepBlock,/personal_details_ready/);
  assert.match(stepBlock,/area_assigned/);
  assert.doesNotMatch(stepBlock,/has_password|password/i);
});
