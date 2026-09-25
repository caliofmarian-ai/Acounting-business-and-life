import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const governance=read('public/profile-governance-ui.js');
const loader=read('public/mobile-feature-loader.js');
const qa=read('qa-acceptance.js');

test('Profile Selector baseline uses one composite authenticated bootstrap request',()=>{
  const start=shell.indexOf('async function refreshProfile');
  const end=shell.indexOf('function onShellVisibility',start);
  const block=shell.slice(start,end);
  assert.match(block,/profileApi\('\/api\/session\/bootstrap'\)/);
  assert.doesNotMatch(block,/profileApi\('\/api\/me'\)/);
  assert.doesNotMatch(block,/profileApi\('\/api\/admin\/me'\)/);
  assert.match(block,/renderAccountHome\(\)/);
  assert.match(block,/publishProfileState\(\)/);
});

test('Account Home defers governance context until Manage Profiles intent',()=>{
  assert.doesNotMatch(loader,/loadDrawerFeatures\(\)/);
  assert.match(loader,/async function ensureGovernance\(\)/);
  assert.match(governance,/window\.BusinessLifeProfileState\?\.snapshot/);
  assert.match(governance,/const mePromise=govMe\?Promise\.resolve\(govMe\):gapi\('\/api\/me'\)/);
  assert.match(governance,/Promise\.all\(\[mePromise,gapi\('\/api\/governance\/state'\),gapi\('\/api\/governance\/territories'\)\]\)/);
  const settings=shell.slice(shell.indexOf("async function openAccountSettings"),shell.indexOf("function closeAccountSettings"));
  assert.match(settings,/BusinessLifeFeatureLoader\?\.ensureGovernance/);
  assert.match(settings,/governance_intent_start/);
  assert.match(settings,/governance_intent_ready/);
});

test('QA-only selector timing trace is explicit and does not alter default UX',()=>{
  assert.match(shell,/new URLSearchParams\(location\.search\)\.get\('perf'\) === '1'/);
  assert.match(shell,/BusinessLifePerformanceTrace/);
  assert.match(shell,/profile_bootstrap_start/);
  assert.match(shell,/profile_bootstrap_end/);
  assert.match(shell,/account_home_rendered/);
  assert.match(shell,/profile_state_published/);
  assert.match(shell,/account_home_settled/);
  assert.match(shell,/renders: \{ account_home:0, drawer:0 \}/);
});

test('canonical QA baseline probe records request count timing payload and duplicate-path evidence',()=>{
  assert.match(qa,/PROFILE_SELECTOR_BASELINE_WAVE='profile_selector_baseline_v1'/);
  assert.match(qa,/client_api_request_count_first_open:3/);
  assert.match(qa,/duplicate_client_api_paths:\[\]/);
  assert.match(qa,/critical_data_ready_ms/);
  assert.match(qa,/full_data_settled_ms/);
  assert.match(qa,/bootstrap_payload_bytes/);
  assert.match(qa,/governance_state_payload_bytes/);
  assert.match(qa,/territories_payload_bytes/);
  assert.match(qa,/browser_render_metrics_required:true/);
});

test('post-optimization selector acceptance models one cold-start API and deferred Governance',()=>{
  assert.match(qa,/PROFILE_SELECTOR_RUNTIME_WAVE='profile_selector_runtime_v1'/);
  assert.match(qa,/client_api_request_count_first_open:1/);
  assert.match(qa,/client_api_paths_first_open:\['\/api\/session\/bootstrap'\]/);
  assert.match(qa,/deferred_governance_request_count:2/);
  assert.match(qa,/governance_deferred_until_profile_management:true/);
});
