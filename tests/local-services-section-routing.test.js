import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const shellCss=read('public/shell.css');
const ui=read('public/services-ui.js');
const server=read('server-services.js');

test('Local Services primary navigation is exactly Home Services Jobs Money',()=>{
  assert.match(shell,/function renderServiceProviderHub\(/);
  assert.match(shell,/if\(role==='service_provider'\)return renderServiceProviderHub\(\)/);
  const start=shell.indexOf('<nav class="serviceProviderPrimaryNav"');
  const end=shell.indexOf('</nav>',start);
  assert.ok(start>=0&&end>start);
  const nav=shell.slice(start,end);
  for(const label of ['Home','Services','Jobs','Money'])assert.match(nav,new RegExp('<strong>'+label+'<\\/strong>'));
  for(const oldTopLevel of ['Public Profile','Qualifications &amp; CV','Requests &amp; Quotes','Reviews','Profile Settings'])assert.doesNotMatch(nav,new RegExp(oldTopLevel));
  const hubsStart=shell.indexOf('const HUBS = {');
  const hubsEnd=shell.indexOf('};',hubsStart);
  assert.doesNotMatch(shell.slice(hubsStart,hubsEnd),/service_provider\s*:/);
});

test('profile qualifications quotes jobs and reviews remain canonical contextual sections',()=>{
  for(const section of ['Profile','Services','Qualifications','Quotes','Jobs','Reviews']){
    assert.match(shell,new RegExp('data-service-provider-section="'+section+'"'));
    assert.match(ui,new RegExp(section));
  }
  assert.match(shell,/openServiceProviderSection\(button\.dataset\.serviceProviderSection\)/);
  assert.match(ui,/openProviderWorkspace\(b\.dataset\.serviceProviderSection\)/);
  assert.match(ui,/BusinessLifeServices=Object\.freeze\(\{openDirectory,openCustomerJobs,openProviderWorkspace\}\)/);
});

test('provider workspace uses the selected canonical section instead of creating a second lifecycle',()=>{
  assert.match(ui,/PROVIDER_SECTION_META/);
  assert.match(ui,/svcProviderSection=normalized/);
  assert.match(ui,/normalized==='Profile'/);
  assert.match(ui,/normalized==='Services'/);
  assert.match(ui,/normalized==='Qualifications'/);
  assert.match(ui,/normalized==='Reviews'/);
  assert.match(ui,/normalized==='Jobs'\?await enrichJobPayments\(mine\):mine/);
  assert.match(ui,/providerJobsPanel\(enriched,normalized\)/);
  assert.doesNotMatch(ui,/profileEditor\(data\)\+servicesEditor\(data\)\+credentialsEditor\(data\)/);
});

test('Jobs keeps requests and work separated by real service-job lifecycle states',()=>{
  assert.match(ui,/quoteStates=new Set\(\['requested','provider_reviewing','quoted'\]\)/);
  assert.match(ui,/jobStates=new Set\(\['accepted','scheduled','in_progress','completed','cancelled','disputed'\]\)/);
  assert.match(ui,/\['accepted','scheduled'\]\.includes\(j\.status\)/);
  assert.match(ui,/openProviderWorkspace\(svcProviderSection\)/);
});

test('Reviews remain backed by published verified Customer-confirmed job reviews',()=>{
  assert.match(server,/FROM service_reviews r/);
  assert.match(server,/r\.moderation_status='published'/);
  assert.match(server,/reviewer_name/);
  assert.match(server,/reviews:reviews\.rows/);
  assert.match(ui,/providerReviewsPanel/);
  assert.match(ui,/No published verified reviews yet/);
  assert.match(ui,/customer-confirmed completed service job/);
});

test('returning from a detailed Local Services workspace preserves the contextual panel',()=>{
  assert.match(shell,/let serviceProviderHubPanel='home'/);
  assert.match(shell,/serviceProviderHubPanel=target/);
  assert.match(shell,/setServiceProviderHubPanel\(hub,serviceProviderHubPanel,\{scroll:false\}\)/);
});

test('Local Services navigation loads detailed data only when a canonical section is opened',()=>{
  const decorateStart=ui.indexOf('async function decorateSvc');
  const decorateEnd=ui.indexOf('function observeSvc',decorateStart);
  assert.ok(decorateStart>=0&&decorateEnd>decorateStart);
  assert.doesNotMatch(ui.slice(decorateStart,decorateEnd),/await loadCategories\(\)/);
  const shellStart=shell.indexOf('function openServiceProviderSection');
  const shellEnd=shell.indexOf('function renderRoleHub',shellStart);
  assert.ok(shellStart>=0&&shellEnd>shellStart);
  assert.doesNotMatch(shell.slice(shellStart,shellEnd),/setInterval\s*\(/);
  assert.doesNotMatch(ui,/setInterval\s*\(/);
});

test('Local Services Money reuses the canonical evidence-based profile Money workspace',()=>{
  assert.match(shell,/openProfileMoney\('service_provider'\)/);
  assert.match(shell,/data-service-provider-nav="money"/);
  assert.match(read('profile-money-core.js'),/netAllocations\(pool,'service_provider_net',accountId\)/);
  assert.match(read('public/profile-money-ui.js'),/Customer payment evidence comes from verified Payment Intents/);
  assert.match(read('public/profile-money-ui.js'),/Service Provider payout remains a separate settlement state/);
});

test('Profile Settings stays separate from the four daily Local Services destinations',()=>{
  assert.match(shell,/serviceProviderSettingsLink/);
  assert.match(shell,/openProfileSettingsForRole\('service_provider'\)/);
  const start=shell.indexOf('<nav class="serviceProviderPrimaryNav"');
  const end=shell.indexOf('</nav>',start);
  assert.doesNotMatch(shell.slice(start,end),/Profile Settings/);
});

test('Local Services four-destination shell is mobile safe',()=>{
  assert.match(shellCss,/\.serviceProviderPrimaryNav\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(shellCss,/\.serviceProviderPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(shellCss,/\.serviceProviderContextList>button\{[^}]*min-height:64px/);
  assert.match(shellCss,/@media\(max-width:420px\)\{\.serviceProviderActionGrid\{grid-template-columns:1fr\}/);
});
