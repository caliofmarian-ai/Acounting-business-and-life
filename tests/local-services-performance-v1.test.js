import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const services=read('server-services.js');
const payments=read('server-payments.js');
const money=read('profile-money-core.js');

function providerHomeBlock(){
  const start=shell.indexOf('const SERVICE_PROVIDER_HOME_CACHE_MS');
  const end=shell.indexOf('function renderServiceProviderHub',start);
  return shell.slice(start,end>start?end:undefined);
}

test('Local Services Home loads three slim critical surfaces in parallel',()=>{
  const block=providerHomeBlock();
  assert.match(block,/Promise\.allSettled\(\[/);
  assert.match(block,/profileApi\('\/api\/service-provider\/me\?view=home'\)/);
  assert.match(block,/profileApi\('\/api\/services\/jobs\/mine\?view=provider_home'\)/);
  assert.match(block,/profileApi\('\/api\/profile-money\/service_provider\?view=home'\)/);
  assert.doesNotMatch(block,/profileApi\('\/api\/service-provider\/me'\),/);
  assert.doesNotMatch(block,/profileApi\('\/api\/profile-money\/service_provider'\),/);
});

test('Service Provider Home profile excludes credentials reviews portfolio and private media',()=>{
  assert.match(services,/async function privateProfileHome/);
  const start=services.indexOf('async function privateProfileHome');
  const end=services.indexOf("app.get('/health'",start);
  const block=services.slice(start,end);
  assert.match(block,/detail_mode:'home'/);
  assert.match(block,/s\.active=TRUE/);
  assert.doesNotMatch(block,/profile_credentials|service_portfolio|service_reviews|cv_private_data_url|profile_image_data_url/);
});

test('Service Provider Home jobs are provider-scoped and exclude closed confirmed history',()=>{
  const start=services.indexOf("app.get('/api/services/jobs/mine'");
  const end=services.indexOf("app.post('/api/service-provider/jobs/:id/quote'",start);
  const block=services.slice(start,end);
  assert.match(block,/String\(req\.query\.view\|\|''\)==='provider_home'/);
  assert.match(block,/j\.provider_account_id=\$1/);
  assert.match(block,/Service Provider profile required/);
  assert.match(block,/NOT\(j\.status='completed' AND j\.customer_confirmed_at IS NOT NULL\)/);
  assert.match(block,/LIMIT 20/);
  assert.match(block,/String\(req\.query\.view\|\|''\)==='home'/);
});

test('Service Provider Money Home preserves allocation authority and defers deep history and banking',()=>{
  assert.match(payments,/serviceProviderMoneyHomeSnapshot/);
  assert.match(payments,/role==='service_provider'&&String\(req\.query\.view\|\|''\)==='home'/);
  const start=money.indexOf('async function serviceProviderMoneyHomeSummary');
  const end=money.indexOf('export async function serviceProviderMoneySnapshot',start);
  const block=money.slice(start,end);
  assert.match(block,/netAllocations\(pool,'service_provider_net',accountId\)/);
  assert.match(block,/Completed job value is a commercial amount, not proof that money was received/);
  assert.doesNotMatch(block,/recent_jobs|ORDER BY created_at DESC LIMIT 40/);
  const routeStart=payments.indexOf("app.get('/api/profile-money/:role'");
  const routeEnd=payments.indexOf("app.post('/api/profile-money/",routeStart);
  const route=payments.slice(routeStart,routeEnd);
  const fast=route.indexOf("role==='service_provider'&&String(req.query.view||'')==='home'");
  const deep=route.indexOf('const [snapshot,accounts,preferences,budgets,profileLedger,accountMoney]');
  assert.ok(fast>=0&&deep>fast);
});

test('explicit Local Services profile and Money intent keep the full detail paths available',()=>{
  assert.match(services,/res\.json\(await privateProfile\(Number\(me\.account\.id\)\)\)/);
  assert.match(money,/export async function serviceProviderMoneySnapshot/);
  assert.match(money,/ORDER BY created_at DESC LIMIT 40/);
  assert.match(payments,/profileMoneySnapshot\(pool,role,me\.account\.id\)/);
});
