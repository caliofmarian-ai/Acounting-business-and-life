import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const moneyCore=read('profile-money-core.js');

function serviceHomeSlice(){
  const start=shell.indexOf('const SERVICE_PROVIDER_HOME_CACHE_MS');
  const end=shell.indexOf('function renderRoleHub',start);
  assert.ok(start>=0&&end>start);
  return shell.slice(start,end);
}

test('Local Services Home reads only canonical Provider profile Jobs and Money in parallel',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/Promise\.allSettled\(\[/);
  assert.match(home,/profileApi\('\/api\/service-provider\/me\?view=home'\)/);
  assert.match(home,/profileApi\('\/api\/services\/jobs\/mine\?view=provider_home'\)/);
  assert.match(home,/profileApi\('\/api\/profile-money\/service_provider\?view=home'\)/);
  assert.match(home,/Number\(job\.provider_account_id\)===accountId/);
  const loadStart=home.indexOf('async function loadServiceProviderHomeData');
  const loadEnd=home.indexOf('function serviceProviderHomeReadiness',loadStart);
  assert.doesNotMatch(home.slice(loadStart,loadEnd),/\/api\/services\/categories/);
});

test('Local Services Home uses a bounded cache and no polling',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/SERVICE_PROVIDER_HOME_CACHE_MS=20000/);
  assert.match(home,/Date\.now\(\)-serviceProviderHomeCache\.loadedAt<SERVICE_PROVIDER_HOME_CACHE_MS/);
  assert.doesNotMatch(home,/setInterval\s*\(/);
  assert.match(home,/serviceProviderHomeRefresh/);
  assert.match(home,/data-service-provider-home-retry/);
});

test('profile readiness uses factual visibility and active services without inventing credential status',()=>{
  const home=serviceHomeSlice();
  const start=home.indexOf('function serviceProviderHomeReadiness');
  const end=home.indexOf('function serviceProviderHomeJobPriority',start);
  const readiness=home.slice(start,end);
  assert.match(readiness,/roleProfile\('service_provider'\)/);
  assert.match(readiness,/visibility==='private'/);
  assert.match(readiness,/visibility==='relationship_only'/);
  assert.match(readiness,/!services\.length/);
  assert.match(readiness,/Public and ready for requests/);
  assert.doesNotMatch(readiness,/credential|licensed|verified/i);
});

test('Home separates Provider action states from states waiting on the Customer',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/new Set\(\['requested','provider_reviewing','accepted','scheduled','in_progress','disputed'\]\)/);
  assert.match(home,/job\.status==='quoted'\|\|\(job\.status==='completed'&&!job\.customer_confirmed_at\)/);
  assert.match(home,/Waiting on Customer/);
  assert.match(home,/No Provider action is required until the Customer responds/);
  assert.match(home,/The Customer still needs to confirm completion/);
  assert.match(home,/data-service-provider-home-section/);
});

test('Home Money separates Customer payment receivable from service_provider_net settlement',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/summary\.confirmed_job_value/);
  assert.match(home,/summary\.payments/);
  assert.match(home,/payments\.confirmed_customer_payments/);
  assert.match(home,/payments\.outstanding_receivables/);
  assert.match(home,/receivable_job_count/);
  assert.match(home,/Separate service_provider_net allocation evidence/);
  assert.match(moneyCore,/serviceProviderPaymentEvidence\(pool,accountId\)/);
  assert.match(moneyCore,/netAllocations\(pool,'service_provider_net',accountId\)/);
  assert.match(moneyCore,/Completed job value is a commercial amount, not proof that money was received/);
});

test('unknown partial Home sources are explicit and never converted into fake zero',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/failures\.length===3/);
  assert.match(home,/Some Home information is unavailable/);
  assert.match(home,/Jobs unavailable/);
  assert.match(home,/No job count has been assumed/);
  assert.match(home,/Money summary unavailable/);
  assert.match(home,/No amount has been assumed/);
  assert.match(home,/value==null\|\|!Number\.isFinite\(Number\(value\)\)\?'Unavailable'/);
});

test('Home only loads when the Local Services Home panel is active',()=>{
  const home=serviceHomeSlice();
  assert.match(home,/if\(destination==='home'\)loadServiceProviderHome\(hub\)/);
  assert.match(home,/if\(serviceProviderHubPanel==='home'\)loadServiceProviderHome\(hub\)/);
  assert.match(home,/setServiceProviderHubPanel\(hub,serviceProviderHubPanel,\{scroll:false\}\)/);
});

test('V2A navigation remains exactly Home Services Jobs Money and Settings stays separate',()=>{
  const start=shell.indexOf('<nav class="serviceProviderPrimaryNav"');
  const end=shell.indexOf('</nav>',start);
  assert.ok(start>=0&&end>start);
  const nav=shell.slice(start,end);
  for(const label of ['Home','Services','Jobs','Money'])assert.match(nav,new RegExp('<strong>'+label+'<\\/strong>'));
  assert.doesNotMatch(nav,/Profile Settings/);
  assert.match(shell,/serviceProviderSettingsLink/);
});

test('Local Services Home is Android-first and protects primary actions',()=>{
  assert.match(css,/\.serviceProviderHomeToolbar button\{[^}]*min-height:44px/);
  assert.match(css,/\.serviceProviderReadiness button\{[^}]*min-height:44px/);
  assert.match(css,/\.serviceProviderHomeWorkRow\{[^}]*min-height:62px/);
  assert.match(css,/\.serviceProviderPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(css,/@media\(max-width:420px\)\{\.serviceProviderHomeSection/);
  assert.match(css,/\.serviceProviderHomeWorkCopy\{[^}]*min-width:0/);
});
