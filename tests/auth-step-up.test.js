import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../auth-session-core.js',import.meta.url),'utf8');
const auth=readFileSync(new URL('../server-auth.js',import.meta.url),'utf8');
const hardening=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');
const payments=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const settings=readFileSync(new URL('../public/profile-settings-ui.js',import.meta.url),'utf8');

test('step-up state is stored per revocable session with a short validity window',()=>{
  assert.match(core,/AUTH_STEP_UP_TTL_MS=10\*60\*1000/);
  assert.match(auth,/step_up_verified_at TIMESTAMPTZ/);
  assert.match(auth,/ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS step_up_verified_at TIMESTAMPTZ/);
  assert.match(core,/markV2SessionStepUp/);
  assert.match(core,/resolveV2SessionStepUp/);
  assert.match(core,/session_id=\$1 AND account_id=\$2/);
});

test('fresh primary and Google sessions start with recent authentication evidence',()=>{
  assert.match(auth,/createV2Session\(pool,TOKEN_SECRET,accountId,\{stepUpVerified:true\}\)/);
  const start=hardening.indexOf('async function createSession');
  const end=hardening.indexOf('async function optionalV2',start);
  const block=hardening.slice(start,end);
  assert.match(block,/stepUpVerified:true/);
});

test('password step-up is rate limited, audited and never returns the password',()=>{
  const start=hardening.indexOf("app.post('/api/auth/step-up/password'");
  const end=hardening.indexOf("app.post('/api/auth/sessions/revoke-others'",start);
  const block=hardening.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/throttled\(req,throttleKey,5,15\*60_000\)/);
  assert.match(block,/step_up_rate_limited/);
  assert.match(block,/step_up_failed/);
  assert.match(block,/step_up_succeeded/);
  assert.match(block,/markV2SessionStepUp/);
  assert.doesNotMatch(block,/res\.json\([^)]*password/);
});

test('Google-only accounts receive a safe fallback instead of bypassing reauthentication',()=>{
  assert.match(hardening,/STEP_UP_PASSWORD_UNAVAILABLE/);
  assert.match(hardening,/Sign in again with your identity provider/);
});

test('account payout destination writes require a recently verified session',()=>{
  assert.match(payments,/async function requireMoneyStepUp/);
  assert.match(payments,/resolveV2SessionStepUp\(pool,TOKEN_SECRET,raw\)/);
  assert.match(payments,/STEP_UP_REQUIRED/);
  for(const marker of [
    "app.post('/api/settings/account-money/destinations'",
    "app.patch('/api/settings/account-money/destinations/:id'",
    "app.post('/api/settings/account-money/destinations/:id/default-payout'"
  ]){
    const start=payments.indexOf(marker);
    const end=payments.indexOf('});',start);
    const block=payments.slice(start,end);
    assert.ok(start>=0,marker+' missing');
    assert.match(block,/requireMoneyStepUp\(req\)/,marker+' must require step-up');
  }
});

test('Money Banking reauthentication UI does not persist the current password',()=>{
  assert.match(settings,/id="accountStepUpPassword" type="password" autocomplete="current-password"/);
  assert.match(settings,/\/api\/auth\/step-up\/password/);
  assert.match(settings,/input\.value=''/);
  assert.match(settings,/Identity confirmed for sensitive banking changes/);
  const stepStart=settings.indexOf('async function saveAccountStepUp');
  const stepEnd=settings.indexOf('async function refreshAccountStepUp',stepStart);
  const block=settings.slice(stepStart,stepEnd);
  assert.doesNotMatch(block,/localStorage\.setItem|sessionStorage\.setItem/);
});
