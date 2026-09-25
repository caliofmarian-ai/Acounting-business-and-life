import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=read('server-auth.js');
const orders=read('server-orders.js');
const accounting=read('server-v03.js');
const hardening=read('server-auth-hardening.js');
const qa=read('qa-acceptance.js');
const workflow=read('.github/workflows/admin-runtime.yml');

test('Account/Auth is embedded beneath Orders and localhost 3207 is retired',()=>{
  assert.match(auth,/export async function startEmbeddedAccountAuth\(\)/);
  assert.match(auth,/export async function stopEmbeddedAccountAuth\(\)/);
  assert.match(auth,/Business & Life Account\/Auth mounted in-process/);
  assert.match(auth,/directExecution/);
  assert.match(auth,/Business & Life account server listening on/);
  assert.match(orders,/accountAuthFetch,startEmbeddedAccountAuth,stopEmbeddedAccountAuth/);
  assert.match(orders,/authApp=await startEmbeddedAccountAuth\(\)/);
  assert.match(orders,/return authApp\(req,res,next\)/);
  assert.doesNotMatch(orders,/INTERNAL_AUTH_PORT/);
  assert.doesNotMatch(orders,/\|\|\s*3207/);
  assert.doesNotMatch(orders,/127\.0\.0\.1:3207/);
  assert.doesNotMatch(orders,/spawn\(process\.execPath,\['server-auth\.js'\]/);
});

test('Account/Auth remains standalone-capable after legacy Accounting boundary retirement',()=>{
  assert.match(auth,/export async function startEmbeddedAccountAuth\(\)/);
  assert.doesNotMatch(auth,/server-v03\.js/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
  assert.doesNotMatch(auth,/spawn\(process\.execPath/);
  assert.match(accounting,/ensureLegacyAccountingBaseSchema/);
  assert.match(accounting,/Accounting app v0\.3 listening on/);
});

test('Account/Auth fetch contract is fail-closed for policy protected APIs',()=>{
  assert.match(auth,/export function isAccountAuthOwnedPath/);
  assert.match(auth,/pathname==='\/api\/me'/);
  assert.match(auth,/pathname\.startsWith\('\/api\/auth\/'\)/);
  assert.match(auth,/pathname\.startsWith\('\/api\/profiles\/'\)/);
  assert.match(auth,/pathname\.startsWith\('\/api\/context\/'\)/);
  assert.match(auth,/ACCOUNT_AUTH_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(auth,/pathname\.startsWith\('\/api\/'\)/);
  assert.match(auth,/resolveAccountToken\(token\)/);
  assert.match(auth,/profileSnapshot\(resolved\.accountId\)/);
});

test('Account/Auth route authority remains on server-auth',()=>{
  for(const marker of [
    "app.post('/api/auth/register'",
    "app.post('/api/auth/login'",
    "app.post('/api/auth/logout'",
    "app.post('/api/auth/password'",
    "app.get('/api/me'",
    "app.patch('/api/me'",
    "app.patch('/api/me/active-role'",
    "app.put('/api/profiles/:role'",
    "app.post('/api/profiles/customer/activate'",
    "app.patch('/api/courier'",
    "app.get('/api/context/:role'",
    "app.get('/api/growth/referral'",
    "app.post('/api/growth/referral-analytics/account'",
    "app.post('/api/growth/referral-analytics/public'"
  ])assert.ok(auth.includes(marker),`missing Account/Auth marker: ${marker}`);
});

test('Account/Auth no longer contains legacy Accounting proxy authority',()=>{
  assert.doesNotMatch(auth,/pipeToAccounting/);
  assert.doesNotMatch(auth,/signLegacyToken/);
  assert.doesNotMatch(auth,/Merchant accounting access is not available for this account/);
  assert.doesNotMatch(auth,/Multi-business accounting isolation is being migrated/);
  assert.match(auth,/app\.use\('\/api',\(req,res\)=>/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('Account/Auth no longer reconstructs bodies for a legacy Accounting HTTP boundary',()=>{
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(auth,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.doesNotMatch(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.doesNotMatch(auth,/http\.request/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('root composition begins at Account/Auth and Orders decorates it in-process',()=>{
  assert.match(auth,/href="\/shell\.css"/);
  assert.match(auth,/src="\/shell\.js"/);
  assert.match(auth,/src="\/auth-ui\.js"/);
  assert.match(orders,/accountAuthFetch\(path,options\)/);
  assert.match(orders,/href="\/orders\.css"/);
  assert.match(orders,/src="\/orders-ui\.js"/);
});

test('Auth Hardening remains a separate higher-level authority',()=>{
  for(const marker of [
    "app.post('/api/auth/forgot-password'",
    "app.post('/api/auth/reset-password'",
    "app.post('/api/auth/email-verification/request'",
    "app.post('/api/auth/email-verification/verify'",
    "app.post('/api/auth/sessions/revoke-others'",
    "app.get('/api/auth/identities'",
    "app.get('/api/auth/google/start'",
    "app.post('/api/auth/oauth/handoff'"
  ])assert.ok(hardening.includes(marker),`missing Auth Hardening marker: ${marker}`);
  assert.match(hardening,/startEmbeddedIncidents/);
});

test('Account/Auth V14 runtime acceptance is wired into canonical QA',()=>{
  assert.match(qa,/ACCOUNT_AUTH_RUNTIME_V14_WAVE='account_auth_runtime_v14'/);
  assert.match(qa,/runAccountAuthRuntimeV14Acceptance/);
  assert.match(qa,/config\.wave===ACCOUNT_AUTH_RUNTIME_V14_WAVE/);
  assert.match(qa,/accounting_unauthorized_gate:true/);
  assert.match(qa,/accounting_nonmerchant_gate:true/);
  assert.match(qa,/active_role_mutation:true/);
});

test('Admin Runtime Contract watches Account/Auth changes on PR and main',()=>{
  const count=(workflow.match(/- 'server-auth\.js'/g)||[]).length;
  assert.equal(count,2);
});
