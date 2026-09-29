import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=read('server-auth.js');
const ui=read('public/auth-ui.js');
const hardeningUi=read('public/auth-hardening-ui.js');
const notifications=read('server-notifications.js');
const notificationCore=read('notification-core.js');
const cookie=read('session-cookie-core.js');
const qa=read('qa-acceptance.js');

test('public registration stores a short-lived intent instead of an account row',()=>{
  assert.match(auth,/CREATE TABLE IF NOT EXISTS account_registration_intents/);
  assert.match(auth,/registration_pending:true/);
  assert.match(auth,/account_created:false/);
  assert.match(auth,/DELETE FROM account_registration_intents WHERE LOWER\(email\)=\$1/);
  assert.match(auth,/NOW\(\)\+\(\$11\*INTERVAL '1 hour'\)/);
  assert.match(auth,/if\(companyTest\|\|qaBypass\)/);
});

test('email is checked immediately for syntax and a deliverable DNS domain',()=>{
  assert.match(auth,/resolveMx\(domain\)/);
  assert.match(auth,/resolve4\(domain\)/);
  assert.match(auth,/resolve6\(domain\)/);
  assert.match(auth,/EMAIL_DOMAIN_NOT_DELIVERABLE/);
  assert.match(auth,/app\.post\('\/api\/auth\/email\/preflight'/);
  assert.match(ui,/setTimeout\(\(\)=>runEmailPreflight\(email\).*?,450\)/s);
  assert.match(ui,/id="authEmailStatus"/);
  assert.match(ui,/id="authCreateButton" disabled/);
});

test('mailbox ownership is required before a real account is inserted',()=>{
  const registerStart=auth.indexOf("app.post('/api/auth/register'");
  const verifyStart=auth.indexOf("app.post('/api/auth/registration/verify'");
  assert.ok(registerStart>=0&&verifyStart>registerStart);
  const publicRegistration=auth.slice(registerStart,verifyStart);
  assert.match(publicRegistration,/INSERT INTO account_registration_intents/);
  const intentMarker=publicRegistration.indexOf('INSERT INTO account_registration_intents');
  const accountMarker=publicRegistration.indexOf('INSERT INTO accounts');
  assert.ok(accountMarker>=0&&accountMarker<intentMarker,'direct account insert is limited to QA/company bypass before public intent flow');
  const verifyBlock=auth.slice(verifyStart,auth.indexOf("app.post('/api/auth/login'",verifyStart));
  assert.match(verifyBlock,/SELECT \* FROM account_registration_intents/);
  assert.match(verifyBlock,/token_hash=\$1 AND expires_at>NOW\(\)/);
  assert.match(verifyBlock,/email_verified_at,auth_status,account_mode,test_role/);
  assert.match(verifyBlock,/NOW\(\),'active','personal',NULL/);
  assert.match(verifyBlock,/DELETE FROM account_registration_intents WHERE id=\$1/);
});

test('verification delivery failure cannot leave a member account behind',()=>{
  assert.match(auth,/REGISTRATION_EMAIL_DELIVERY_FAILED/);
  assert.match(auth,/DELETE FROM account_registration_intents WHERE id=\$1/);
  assert.match(notificationCore,/export async function sendDirectSecurityEmail/);
  assert.match(notifications,/email\.bounced/);
  assert.match(notifications,/DELETE FROM account_registration_intents WHERE provider_reference=\$1/);
});

test('registration UI states clearly that no account exists before email verification',()=>{
  assert.match(ui,/No account is created until you verify it/);
  assert.match(ui,/No Business & Life account has been created yet/);
  assert.match(ui,/Only then will your account be created/);
  assert.match(ui,/registration_pending/);
  assert.match(hardeningUi,/registration_verify_token/);
  assert.match(hardeningUi,/\/api\/auth\/registration\/verify/);
});

test('registration verification is a bootstrap route and replay is fail-closed',()=>{
  assert.match(cookie,/'\/api\/auth\/registration\/verify'/);
  assert.match(auth,/This registration link is invalid or has expired/);
  assert.match(auth,/token_hash TEXT NOT NULL UNIQUE/);
});

test('Email Ownership V2 has an isolated Preview runtime acceptance wave',()=>{
  assert.match(qa,/EMAIL_OWNERSHIP_V2_WAVE='email_ownership_v2'/);
  assert.match(qa,/runEmailOwnershipV2Acceptance/);
  assert.match(qa,/definitely-not-real\.invalid/);
  assert.match(qa,/registration_pending!==true/);
  assert.match(qa,/accounts row before inbox verification/);
  assert.match(qa,/preview_registration_verify_url/);
  assert.match(qa,/account_registration_intents/);
  assert.match(qa,/replay denial/);
  assert.match(qa,/config\.wave===EMAIL_OWNERSHIP_V2_WAVE/);
});

test('normal login accepts active accounts only',()=>{
  assert.match(auth,/const loginStateAllowed=account&&account\.auth_status==='active'/);
});
