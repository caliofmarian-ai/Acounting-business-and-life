import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('microbusiness-readiness-core.js');
const server=read('server-profile-governance.js');
const admin=read('public/admin-console.js');
const legacy=read('public/profile-governance-ui.js');

test('server exposes and enforces one canonical commerce decision policy',()=>{
  assert.match(core,/export function microbusinessReadinessReviewStatus/);
  assert.match(core,/export function microbusinessCommerceReviewPolicy/);
  assert.match(server,/decision_policy:decisionPolicy/);
  assert.match(server,/microbusinessCommerceReviewPolicy\(/);
  assert.match(server,/if\(!decisionPolicy\.can_grant_commerce\)/);
  assert.match(server,/READINESS_EVIDENCE_INCOMPLETE/);
  assert.match(server,/READINESS_PROFILE_AUTHORIZATION_REQUIRED/);
});

test('dedicated Admin UI keeps Limited and Full disabled until every evidence field is complete',()=>{
  assert.match(admin,/function commerceDraftReviewStatus/);
  assert.match(admin,/function syncCommerceDecisionControls/);
  assert.match(admin,/limited\.disabled=!status\.can_grant_commerce/);
  assert.match(admin,/full\.disabled=!status\.can_grant_commerce/);
  assert.match(admin,/Limited and Full remain locked until every required evidence item is complete/);
  assert.match(admin,/official source \/ authority/);
  assert.match(admin,/evidence \/ record reference/);
  assert.match(admin,/reviewer explanation/);
  assert.match(admin,/Readiness only is always available as the safe decision/);
});

test('commerce review progress updates live and server rejection does not rebuild or erase reviewer inputs',()=>{
  assert.match(admin,/addEventListener\('input',sync\)/);
  assert.match(admin,/commerceReviewProgressText/);
  assert.match(admin,/commerceReviewProgressBar/);
  const submit=admin.slice(admin.indexOf('form.onsubmit=async e=>',admin.indexOf('async function openAdminCommerceReadiness')),admin.indexOf('\n  }catch\(error\)\{showError',admin.indexOf('async function openAdminCommerceReadiness')));
  assert.match(submit,/error\.payload\?\.decision_policy/);
  assert.match(submit,/commerceServerBlockersHtml/);
  assert.match(submit,/syncCommerceDecisionControls\(readiness,p\)/);
  assert.doesNotMatch(submit,/openAdminCommerceReadiness\([^\n]*\)\s*;?\s*}\s*catch/);
});

test('legacy Super Admin readiness surface follows the same fail-closed interaction contract',()=>{
  assert.match(legacy,/function govCommerceDraftStatus/);
  assert.match(legacy,/function syncGovCommerceControls/);
  assert.match(legacy,/limited\.disabled=!status\.canGrant/);
  assert.match(legacy,/full\.disabled=!status\.canGrant/);
  assert.match(legacy,/Limited and Full stay locked until every required evidence item is complete/);
  assert.match(legacy,/error\.payload\?\.decision_policy\?\.blockers/);
});
